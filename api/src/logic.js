// Reglas del sorteo, premios, códigos y métricas. Sin HTTP: así se puede probar directo.
import { handleGameCreator } from "./lifecycle.js";
import { handleGameStaff, recordPullHour } from "./staff.js";
import { randomInt, randomBytes } from "node:crypto";
import { TIERS, PRIZE_TIERS } from "./config.js";
import { tx } from "./db.js";

// Día (AAAA-MM-DD) con el desfase de Colombia.
export function dayKey(ts, tzOffsetMin) {
  return new Date(ts + tzOffsetMin * 60_000).toISOString().slice(0, 10);
}

// Sorteo con RNG criptográfico del servidor.
export function rollTier(rand = () => randomInt(0, 1_000_000)) {
  let r = rand();
  for (const t of TIERS) {
    if ((r -= t.weight) < 0) return t.key;
  }
  return TIERS[0].key;
}

// Códigos: "SKY" + 10 caracteres sin letras que se confunden (sin 0/O, 1/I/L).
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export function newCode() {
  let s = "SKY";
  for (let i = 0; i < 10; i++) s += ALPHABET[randomInt(0, ALPHABET.length)];
  return s;
}
export function normalizeCode(raw) {
  if (typeof raw !== "string") return "";
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 20);
}
export const CODE_RE = /^SKY[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{10}$/;
export const newId = () => randomBytes(12).toString("hex");

function countToday(db, userId, tier, day) {
  // Los regalos del staff (source 'admin') no cuentan para el tope diario.
  return db.prepare("SELECT COUNT(*) AS n FROM rewards WHERE user_id = ? AND tier = ? AND day = ? AND source != 'admin'").get(userId, tier, day).n;
}

export function remainingToday(db, cfg, userId, now = Date.now()) {
  const day = dayKey(now, cfg.tzOffsetMin);
  const out = {};
  for (const tier of PRIZE_TIERS) out[tier] = Math.max(0, (cfg.maxPerDay[tier] ?? 0) - countToday(db, userId, tier, day));
  return out;
}

// Una tirada. mode = "user" (premio al buzón de userId) o "code" (código para canjear en el juego).
export function doRoll(db, cfg, { mode, userId, visitor }, now = Date.now(), rand) {
  const day = dayKey(now, cfg.tzOffsetMin);
  const tier = rollTier(rand);
  return tx(db, () => {
    let outcome = "none";
    const result = { tier };
    let player = null;
    if (mode === "user") {
      player = db.prepare("SELECT user_id, name, display_name, level FROM players WHERE user_id = ?").get(userId);
      if (!player) throw Object.assign(new Error("unknown_player"), { status: 400 });
    }
    if (PRIZE_TIERS.has(tier)) {
      if (mode === "user") {
        if (countToday(db, userId, tier, day) >= (cfg.maxPerDay[tier] ?? 0)) {
          outcome = "capped";
          result.capped = true;
        } else {
          const id = newId();
          db.prepare("INSERT INTO rewards (id, user_id, tier, source, day, created_at) VALUES (?, ?, ?, 'user', ?, ?)")
            .run(id, userId, tier, day, now);
          outcome = "reward";
          result.reward = {
            kind: "mail",
            needsLevel: cfg.minLevel > 0 && !(player.level >= cfg.minLevel) ? cfg.minLevel : 0,
          };
        }
      } else {
        let code;
        do code = newCode(); while (db.prepare("SELECT 1 FROM codes WHERE code = ?").get(code));
        const expiresAt = now + cfg.codeTtlHours * 3_600_000;
        db.prepare("INSERT INTO codes (code, tier, created_at, expires_at, visitor) VALUES (?, ?, ?, ?, ?)")
          .run(code, tier, now, expiresAt, visitor ?? null);
        outcome = "code";
        result.code = code;
        result.expiresAt = expiresAt;
      }
    }
    db.prepare("INSERT INTO rolls (ts, day, tier, mode, user_id, visitor, outcome) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(now, day, tier, mode, mode === "user" ? userId : null, visitor ?? null, outcome);
    if (mode === "user") result.remaining = remainingToday(db, cfg, userId, now);
    return result;
  });
}

// ---------- Juego ----------

function cleanPlayer(p) {
  if (!p || typeof p !== "object") return null;
  const userId = Number(p.userId);
  if (!Number.isSafeInteger(userId) || userId <= 0) return null;
  const name = typeof p.name === "string" ? p.name.slice(0, 20) : "";
  if (!/^[A-Za-z0-9_]{3,20}$/.test(name)) return null;
  const displayName = typeof p.displayName === "string" && p.displayName.length ? p.displayName.slice(0, 32) : name;
  const level = Number.isFinite(Number(p.level)) ? Math.max(0, Math.min(1e6, Math.floor(Number(p.level)))) : null;
  // Nivel de creador que tiene en el juego (0 = ninguno, 1 = Creator … 5 = Elite). Solo lo manda /pull.
  const ct = Number(p.creatorTier);
  const creatorTier = Number.isInteger(ct) && ct >= 0 && ct <= 5 ? ct : null;
  // Programa de staff: rango (0 = no, 1 Helper, 2 Moderator Jr, 3 Moderator), en servicio y comandos usados.
  const stv = Number(p.staffTier);
  const staffTier = Number.isInteger(stv) && stv >= 0 && stv <= 3 ? stv : null;
  const sa = p.staffActions && typeof p.staffActions === "object" ? p.staffActions : null;
  const staffActions = sa ? { total: Number(sa.total) || 0, sanctions: Number(sa.sanctions) || 0, helps: Number(sa.helps) || 0 } : null;
  return { userId, name, displayName, level, creatorTier, staffTier, afk: p.afk === true, staffActions };
}
const cleanJob = (j) => (typeof j === "string" ? j.replace(/[^A-Za-z0-9-]/g, "").slice(0, 64) : "") || "studio";

function upsertGamePlayer(db, p, day, now) {
  db.prepare(`
    INSERT INTO players (user_id, name, display_name, name_lc, display_lc, played, level, first_seen, last_seen)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET name = excluded.name, display_name = excluded.display_name,
      name_lc = excluded.name_lc, display_lc = excluded.display_lc, played = 1,
      level = COALESCE(excluded.level, players.level), last_seen = excluded.last_seen
  `).run(p.userId, p.name, p.displayName, p.name.toLowerCase(), p.displayName.toLowerCase(), p.level, now, now);
  db.prepare("INSERT OR IGNORE INTO player_days (day, user_id) VALUES (?, ?)").run(day, p.userId);
}

// El servidor de Roblox manda sus jugadores y recibe los premios pendientes de cada uno.
export function gamePull(db, cfg, body, now = Date.now()) {
  const day = dayKey(now, cfg.tzOffsetMin);
  const players = (Array.isArray(body?.players) ? body.players : []).slice(0, 200).map(cleanPlayer).filter(Boolean);
  const jobId = cleanJob(body?.jobId);
  return tx(db, () => {
    db.prepare("INSERT INTO server_days (day, job_id) VALUES (?, ?) ON CONFLICT(day, job_id) DO UPDATE SET pulls = pulls + 1")
      .run(day, jobId);
    const pending = db.prepare("SELECT id, user_id AS userId, tier, source, kind, pack, period FROM rewards WHERE user_id = ? AND status = 'pending' ORDER BY created_at LIMIT 20");
    const rewards = [];
    recordPullHour(db, jobId, players.length, now);
    const seen = db.prepare("SELECT last_seen FROM players WHERE user_id = ?");
    for (const p of players) {
      const prevSeen = seen.get(p.userId)?.last_seen || null;
      upsertGamePlayer(db, p, day, now);
      handleGameStaff(db, cfg, p, prevSeen, now, jobId);
      // Creadores antiguos (aviso / quitar el rol) y nivel actual en el juego.
      if (p.creatorTier != null) handleGameCreator(db, cfg, p, now);
      const lowLevel = cfg.minLevel > 0 && !(p.level >= cfg.minLevel);
      // Por debajo del nivel mínimo solo llegan los regalos del staff y lo del programa de creadores.
      for (const r of pending.all(p.userId)) {
        if (lowLevel && r.source !== "admin" && r.source !== "creator") continue;
        if (r.kind === "pet") { delete r.kind; delete r.pack; delete r.period; }
        rewards.push(r);
      }
    }
    return { rewards };
  });
}

export function gameAck(db, body, now = Date.now()) {
  const ids = (Array.isArray(body?.ids) ? body.ids : []).filter((x) => typeof x === "string" && /^[0-9a-f]{24}$/.test(x)).slice(0, 500);
  const stmt = db.prepare("UPDATE rewards SET status = 'delivered', delivered_at = ? WHERE id = ? AND status = 'pending'");
  return tx(db, () => ({ updated: ids.reduce((n, id) => n + Number(stmt.run(now, id).changes), 0) }));
}

// Canje de un código desde la caja de códigos del juego.
export function gameRedeem(db, cfg, body, now = Date.now()) {
  const p = cleanPlayer(body);
  if (!p) return { ok: false, error: "bad_request" };
  const code = normalizeCode(body?.code);
  if (!CODE_RE.test(code)) return { ok: false, error: "invalid" };
  const day = dayKey(now, cfg.tzOffsetMin);
  return tx(db, () => {
    upsertGamePlayer(db, p, day, now);
    const row = db.prepare("SELECT * FROM codes WHERE code = ?").get(code);
    if (!row) return { ok: false, error: "invalid" };
    if (row.redeemed_by != null) {
      // Reintento del mismo jugador (p. ej. el servidor cayó antes de entregar): devolver el mismo premio.
      if (row.redeemed_by === p.userId) {
        const rw = db.prepare("SELECT id, tier, status, source FROM rewards WHERE id = ?").get(row.reward_id);
        if (rw && rw.status === "pending") return { ok: true, reward: { id: rw.id, userId: p.userId, tier: rw.tier, source: rw.source } };
      }
      return { ok: false, error: "used" };
    }
    if (row.expires_at <= now) return { ok: false, error: "expired" };
    // Los códigos generados en el panel (sorteos, Discord…) no piden nivel ni cuentan para el tope.
    const fromAdmin = row.origin === "admin";
    if (!fromAdmin) {
      if (cfg.minLevel > 0 && !(p.level >= cfg.minLevel)) return { ok: false, error: "level", minLevel: cfg.minLevel };
      if (countToday(db, p.userId, row.tier, day) >= (cfg.maxPerDay[row.tier] ?? 0)) return { ok: false, error: "capped" };
    }
    const source = fromAdmin ? "admin" : "code";
    const id = newId();
    db.prepare("INSERT INTO rewards (id, user_id, tier, source, day, created_at, code) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(id, p.userId, row.tier, source, day, now, code);
    db.prepare("UPDATE codes SET redeemed_by = ?, redeemed_at = ?, reward_id = ? WHERE code = ?").run(p.userId, now, id, code);
    return { ok: true, reward: { id, userId: p.userId, tier: row.tier, source } };
  });
}

// ---------- Acciones del panel ----------
const ALL_TIERS = new Set(TIERS.map((t) => t.key));
const intIn = (v, min, max, def) => {
  const n = Number(v);
  return Number.isInteger(n) ? Math.min(max, Math.max(min, n)) : def;
};

// Códigos míticos o legendarios para sorteos. Un solo uso cada uno.
export function adminCreateCodes(db, body, now = Date.now()) {
  const tier = body?.tier;
  if (!PRIZE_TIERS.has(tier)) return { ok: false, error: "bad_tier" };
  const count = intIn(body?.count, 1, 50, 1);
  const days = intIn(body?.days, 1, 30, 7);
  const expiresAt = now + days * 86_400_000;
  const codes = tx(db, () => {
    const out = [];
    const exists = db.prepare("SELECT 1 FROM codes WHERE code = ?");
    const ins = db.prepare("INSERT INTO codes (code, tier, created_at, expires_at, visitor, origin) VALUES (?, ?, ?, ?, 'admin', 'admin')");
    for (let i = 0; i < count; i++) {
      let code;
      do code = newCode(); while (exists.get(code));
      ins.run(code, tier, now, expiresAt);
      out.push(code);
    }
    return out;
  });
  return { ok: true, tier, codes, expiresAt };
}

export function adminListCodes(db, now = Date.now(), limit = 60) {
  return db.prepare(`
    SELECT c.code, c.tier, c.created_at AS createdAt, c.expires_at AS expiresAt, c.redeemed_at AS redeemedAt,
           c.redeemed_by AS redeemedBy, p.name, p.display_name AS displayName
    FROM codes c LEFT JOIN players p ON p.user_id = c.redeemed_by
    WHERE c.origin = 'admin' ORDER BY c.created_at DESC LIMIT ?`).all(limit)
    .map((r) => ({ ...r, status: r.redeemedBy != null ? "redeemed" : r.expiresAt <= now ? "expired" : "active" }));
}

// Regalo directo: N tiradas de mascota de una rareza al buzón del jugador. No cuenta para el tope.
export function adminGift(db, cfg, body, now = Date.now()) {
  const userId = Number(body?.userId);
  if (!Number.isSafeInteger(userId) || userId <= 0) return { ok: false, error: "bad_user" };
  const tier = body?.tier;
  if (!ALL_TIERS.has(tier)) return { ok: false, error: "bad_tier" };
  const count = intIn(body?.count, 1, 10, 1);
  const player = db.prepare("SELECT user_id, name, display_name, played FROM players WHERE user_id = ?").get(userId);
  if (!player) return { ok: false, error: "unknown_player" };
  const day = dayKey(now, cfg.tzOffsetMin);
  const ids = tx(db, () => {
    const ins = db.prepare("INSERT INTO rewards (id, user_id, tier, source, day, created_at) VALUES (?, ?, ?, 'admin', ?, ?)");
    const out = [];
    for (let i = 0; i < count; i++) { const id = newId(); ins.run(id, userId, tier, day, now); out.push(id); }
    return out;
  });
  return { ok: true, sent: ids.length, tier, player: { userId, name: player.name, displayName: player.display_name, played: Boolean(player.played) } };
}

// ---------- Visitas ----------
export function recordVisit(db, cfg, visitor, now = Date.now()) {
  db.prepare("INSERT INTO visits (day, visitor) VALUES (?, ?) ON CONFLICT(day, visitor) DO UPDATE SET hits = hits + 1")
    .run(dayKey(now, cfg.tzOffsetMin), visitor);
}

// ---------- Métricas para el panel ----------
export function metrics(db, cfg, days = 30, now = Date.now()) {
  days = Math.max(1, Math.min(180, days | 0));
  const today = dayKey(now, cfg.tzOffsetMin);
  const dayList = [];
  for (let i = days - 1; i >= 0; i--) dayList.push(dayKey(now - i * 86_400_000, cfg.tzOffsetMin));
  const from = dayList[0];
  const tiers = TIERS.map((t) => t.key);

  const byTier = (sql, ...args) => {
    const o = Object.fromEntries(tiers.map((t) => [t, 0]));
    for (const r of db.prepare(sql).all(...args)) o[r.tier] = r.n;
    return o;
  };
  const one = (sql, ...args) => db.prepare(sql).get(...args).n;

  const series = Object.fromEntries(dayList.map((d) => [d, { day: d, rolls: Object.fromEntries(tiers.map((t) => [t, 0])), visitors: 0, servers: 0, players: 0, rewards: 0, codes: 0 }]));
  for (const r of db.prepare("SELECT day, tier, COUNT(*) AS n FROM rolls WHERE day >= ? GROUP BY day, tier").all(from)) if (series[r.day]) series[r.day].rolls[r.tier] = r.n;
  for (const r of db.prepare("SELECT day, COUNT(*) AS n FROM visits WHERE day >= ? GROUP BY day").all(from)) if (series[r.day]) series[r.day].visitors = r.n;
  for (const r of db.prepare("SELECT day, COUNT(*) AS n FROM server_days WHERE day >= ? GROUP BY day").all(from)) if (series[r.day]) series[r.day].servers = r.n;
  for (const r of db.prepare("SELECT day, COUNT(*) AS n FROM player_days WHERE day >= ? GROUP BY day").all(from)) if (series[r.day]) series[r.day].players = r.n;
  for (const r of db.prepare("SELECT day, COUNT(*) AS n FROM rewards WHERE day >= ? GROUP BY day").all(from)) if (series[r.day]) series[r.day].rewards = r.n;
  const codeDay = `strftime('%Y-%m-%d', (created_at + ${cfg.tzOffsetMin * 60_000}) / 1000, 'unixepoch')`;
  for (const r of db.prepare(`SELECT ${codeDay} AS day, COUNT(*) AS n FROM codes WHERE created_at >= ? GROUP BY 1`).all(now - days * 86_400_000)) if (series[r.day]) series[r.day].codes = r.n;

  return {
    generatedAt: now,
    today,
    days,
    limits: { maxPerDay: cfg.maxPerDay, minLevel: cfg.minLevel, codeTtlHours: cfg.codeTtlHours },
    rolls: {
      total: one("SELECT COUNT(*) AS n FROM rolls"),
      today: one("SELECT COUNT(*) AS n FROM rolls WHERE day = ?", today),
      byTierAll: byTier("SELECT tier, COUNT(*) AS n FROM rolls GROUP BY tier"),
      byTierToday: byTier("SELECT tier, COUNT(*) AS n FROM rolls WHERE day = ? GROUP BY tier", today),
      byTierRange: byTier("SELECT tier, COUNT(*) AS n FROM rolls WHERE day >= ? GROUP BY tier", from),
      byMode: Object.fromEntries(db.prepare("SELECT mode, COUNT(*) AS n FROM rolls GROUP BY mode").all().map((r) => [r.mode, r.n])),
      cappedTotal: one("SELECT COUNT(*) AS n FROM rolls WHERE outcome = 'capped'"),
    },
    connections: {
      visitorsToday: one("SELECT COUNT(*) AS n FROM visits WHERE day = ?", today),
      visitorsRange: one("SELECT COUNT(DISTINCT visitor) AS n FROM visits WHERE day >= ?", from),
      serversToday: one("SELECT COUNT(*) AS n FROM server_days WHERE day = ?", today),
      playersToday: one("SELECT COUNT(*) AS n FROM player_days WHERE day = ?", today),
      playersKnown: one("SELECT COUNT(*) AS n FROM players WHERE played = 1"),
      lastServerPull: db.prepare("SELECT MAX(last_seen) AS t FROM players WHERE played = 1").get().t ?? null,
    },
    codes: {
      issued: one("SELECT COUNT(*) AS n FROM codes"),
      redeemed: one("SELECT COUNT(*) AS n FROM codes WHERE redeemed_by IS NOT NULL"),
      expired: one("SELECT COUNT(*) AS n FROM codes WHERE redeemed_by IS NULL AND expires_at <= ?", now),
      active: one("SELECT COUNT(*) AS n FROM codes WHERE redeemed_by IS NULL AND expires_at > ?", now),
      byTier: byTier("SELECT tier, COUNT(*) AS n FROM codes GROUP BY tier"),
      fromAdmin: one("SELECT COUNT(*) AS n FROM codes WHERE origin = 'admin'"),
    },
    rewards: {
      pending: one("SELECT COUNT(*) AS n FROM rewards WHERE status = 'pending'"),
      delivered: one("SELECT COUNT(*) AS n FROM rewards WHERE status = 'delivered'"),
      deliveredToday: one("SELECT COUNT(*) AS n FROM rewards WHERE status = 'delivered' AND delivered_at >= ?", Date.parse(`${today}T00:00:00Z`) - cfg.tzOffsetMin * 60_000),
      byTier: byTier("SELECT tier, COUNT(*) AS n FROM rewards GROUP BY tier"),
      bySource: Object.fromEntries(db.prepare("SELECT source, COUNT(*) AS n FROM rewards GROUP BY source").all().map((r) => [r.source, r.n])),
      recent: db.prepare(`
        SELECT r.id, r.user_id AS userId, p.name, p.display_name AS displayName, r.tier, r.source, r.status,
               r.created_at AS createdAt, r.delivered_at AS deliveredAt, r.code
        FROM rewards r LEFT JOIN players p ON p.user_id = r.user_id
        ORDER BY r.created_at DESC LIMIT 30`).all(),
      topUsers: db.prepare(`
        SELECT r.user_id AS userId, p.name, p.display_name AS displayName,
               SUM(r.tier = 'mythic') AS mythic, SUM(r.tier = 'legendary') AS legendary, COUNT(*) AS total
        FROM rewards r LEFT JOIN players p ON p.user_id = r.user_id
        WHERE r.day >= ? GROUP BY r.user_id ORDER BY total DESC LIMIT 10`).all(dayList[Math.max(0, dayList.length - 7)]),
    },
    series: dayList.map((d) => series[d]),
  };
}
