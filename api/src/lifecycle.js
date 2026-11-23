// Ciclo de vida de los creadores (2026-11-23):
//   * Rangos automáticos por vistas semanales (Creator → Active 3k → Viral 3.5k → Star 4.5k → Elite 5k).
//   * Si una semana entera no sube ningún video baja a Creator; aviso 3 días antes por el buzón.
//   * Si son 2 semanas seguidas sin video sale del programa (pierde el rango en el juego y el rol de
//     Discord) y tiene que volver a aplicar (pedido del dueño 2026-11-23).
//   * Avisos al buzón del juego (kind "notice") y cambios de rango (kind "tierset").
//   * Creadores antiguos: tenían el tag en el juego sin pasar por la página. Se les avisa al entrar
//     y, si no aplican en el plazo (o antes de la fecha límite), pierden el rol.
// Todo lo que cambia queda en `notices` (lo ven los moderadores) y en `audit`.
import { randomBytes } from "node:crypto";
import { weekOf, weekStartMs, audit } from "./creators.js";
import { LEVEL_KEYS, levelIndex, rankForViews } from "./program.js";

const DAY = 86_400_000;
const OFFSET_MS = -5 * 3_600_000;
const SYSTEM = { id: "system", name: "Sistema", role: "system" };
const newId = () => randomBytes(12).toString("hex");
const dateCol = (ms) => new Date(ms + OFFSET_MS).toISOString().slice(0, 10).split("-").reverse().join("/");
const todayKey = (ms) => new Date(ms + OFFSET_MS).toISOString().slice(0, 10);

export const NOTICE_KINDS = ["welcome", "promoted", "demotion_warning", "demoted", "removal_warning", "removed_inactive", "legacy_join", "legacy_removed", "removed", "rejected", "tier_set"];
export const INACTIVE_WEEKS_TO_REMOVE = 2;

// ---------- Cola hacia el juego ----------
// Cambia el rango en el juego (exacto). Cancela un cambio anterior aún sin entregar.
export function queueTierSet(db, userId, tierKey, now = Date.now()) {
  if (!userId) return null;
  db.prepare("UPDATE rewards SET status = 'cancelled' WHERE user_id = ? AND kind = 'tierset' AND status = 'pending'").run(userId);
  const id = newId();
  db.prepare("INSERT INTO rewards (id, user_id, tier, source, day, created_at, kind, pack) VALUES (?, ?, 'creator', 'creator', ?, ?, 'tierset', ?)")
    .run(id, userId, todayKey(now), now, tierKey);
  return id;
}

// Correo de aviso al buzón. El texto vive en el juego (WebRewardServiceConfig.CreatorNotices);
// aquí solo va la clave y un parámetro corto (rango o fecha).
export function queueNotice(db, { robloxUserId, discordId = null, kind, param = "", actor = SYSTEM.name }, now = Date.now()) {
  if (!robloxUserId || !NOTICE_KINDS.includes(kind)) return null;
  const id = newId();
  const p = String(param ?? "").replace(/[^A-Za-z0-9/ -]/g, "").slice(0, 24);
  db.prepare("INSERT INTO rewards (id, user_id, tier, source, day, created_at, kind, pack, period) VALUES (?, ?, 'creator', 'creator', ?, ?, 'notice', ?, ?)")
    .run(id, robloxUserId, todayKey(now), now, kind, p);
  db.prepare("INSERT INTO notices (roblox_user_id, discord_id, kind, param, reward_id, actor, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(robloxUserId, discordId, kind, p, id, actor, now);
  return id;
}

// ---------- Rango ----------
export const tierOf = (c) => (c?.tier && (c.tier === "None" || LEVEL_KEYS.includes(c.tier)) ? c.tier : "Creator");

// Pone el rango de un creador aprobado: página + juego + aviso. Devuelve el trabajo de roles de Discord.
// Con tierKey "None" el creador sale del programa: la cuenta deja de estar vinculada, su última
// solicitud queda como "removed" (puede volver a aplicar) y pierde el rango y el rol de Discord.
export function setCreatorTier(db, actor, discordId, tierKey, why, now = Date.now()) {
  const c = db.prepare("SELECT * FROM creators WHERE discord_id = ?").get(String(discordId));
  if (!c || c.link_status !== "approved") return null;
  const before = tierOf(c);
  if (before === tierKey) return null;
  db.prepare("UPDATE creators SET tier = ?, tier_changed_at = ? WHERE discord_id = ?").run(tierKey, now, c.discord_id);
  queueTierSet(db, c.roblox_user_id, tierKey, now);
  const kind = why || (tierKey === "None" ? "removed" : levelIndex(tierKey) > levelIndex(before) ? "promoted" : "tier_set");
  queueNotice(db, { robloxUserId: c.roblox_user_id, discordId: c.discord_id, kind, param: kind === "demoted" || kind === "removed_inactive" ? before : tierKey, actor: actor.name }, now);
  if (tierKey === "None") {
    db.prepare("UPDATE creators SET link_status = 'removed', warn_week = NULL, idle_weeks = 0 WHERE discord_id = ?").run(c.discord_id);
    db.prepare("UPDATE applications SET status = 'removed', review_note = ? WHERE id = (SELECT id FROM applications WHERE discord_id = ? ORDER BY id DESC LIMIT 1) AND status = 'approved'")
      .run(kind === "removed_inactive" ? "Salió del programa: 2 semanas seguidas sin videos." : "Un moderador lo sacó del programa.", c.discord_id);
  }
  audit(db, actor, `tier.${kind}`, `${c.roblox_name} (${c.roblox_user_id})`, { de: before, a: tierKey });
  return { discordId: c.discord_id, tierKey, reason: `${kind}: ${before} → ${tierKey}` };
}

const weekViews = (db, discordId, week) =>
  db.prepare("SELECT COALESCE(SUM(views), 0) AS v FROM evidences WHERE discord_id = ? AND status = 'approved' AND week = ?").get(discordId, week).v;
// "Subió un video" = cualquier evidencia de esa semana que no esté rechazada (aprobada o en revisión).
const weekVideos = (db, discordId, week) =>
  db.prepare("SELECT COUNT(*) AS n FROM evidences WHERE discord_id = ? AND status != 'rejected' AND week = ?").get(discordId, week).n;

// Revisa a todos los creadores aprobados: sube rangos, avisa y baja por inactividad.
// Se llama cada 15 min (startLifecycle) y después de aprobar evidencias.
export function evaluateCreators(db, cfg, now = Date.now()) {
  const out = { changes: [], warnings: 0, roleJobs: [] };
  if (!cfg.creators.autoTiers) return out;
  const w = weekOf(now);
  const ws = weekStartMs(w);
  const warnFrom = ws + (7 - cfg.creators.warnDaysBefore) * DAY;
  const demoteFrom = ws + cfg.creators.demotionGraceHours * 3_600_000;
  const rows = db.prepare("SELECT * FROM creators WHERE link_status = 'approved' AND COALESCE(tier, 'Creator') != 'None'").all();
  for (const c of rows) {
    db.exec("BEGIN IMMEDIATE");
    try {
      let cur = tierOf(c);
      // 1) Cierre de la semana pasada (solo si ya era creador cuando empezó):
      //    sin videos → racha +1; con 2 seguidas sale del programa, con 1 baja a Creator.
      if (now >= demoteFrom && (c.eval_week ?? -1) < w - 1) {
        const wasMember = (c.link_reviewed_at || 0) <= weekStartMs(w - 1);
        let idle = c.idle_weeks || 0;
        if (wasMember) idle = weekVideos(db, c.discord_id, w - 1) === 0 ? idle + 1 : 0;
        db.prepare("UPDATE creators SET eval_week = ?, idle_weeks = ? WHERE discord_id = ?").run(w - 1, idle, c.discord_id);
        if (wasMember && idle >= INACTIVE_WEEKS_TO_REMOVE) {
          const job = setCreatorTier(db, SYSTEM, c.discord_id, "None", "removed_inactive", now);
          if (job) { out.roleJobs.push(job); out.changes.push({ discordId: c.discord_id, from: cur, to: "None" }); }
          db.exec("COMMIT");
          continue;
        }
        if (wasMember && idle >= 1 && levelIndex(cur) > 1) {
          const job = setCreatorTier(db, SYSTEM, c.discord_id, "Creator", "demoted", now);
          if (job) { out.roleJobs.push(job); out.changes.push({ discordId: c.discord_id, from: cur, to: "Creator" }); }
          cur = "Creator";
        }
        c.idle_weeks = idle;
      }
      // 2) Ascenso con las vistas de esta semana o de la pasada.
      const best = rankForViews(Math.max(weekViews(db, c.discord_id, w), weekViews(db, c.discord_id, w - 1)));
      if (levelIndex(best) > levelIndex(cur)) {
        const job = setCreatorTier(db, SYSTEM, c.discord_id, best, "promoted", now);
        if (job) { out.roleJobs.push(job); out.changes.push({ discordId: c.discord_id, from: cur, to: best }); }
        cur = best;
      }
      // 3) Aviso: faltan warnDaysBefore días y esta semana aún no hay video.
      //    Si ya viene de una semana sin video, el aviso es de salida del programa.
      const willLeave = (c.idle_weeks || 0) >= INACTIVE_WEEKS_TO_REMOVE - 1;
      if (now >= warnFrom && (levelIndex(cur) > 1 || willLeave) && c.warn_week !== w && weekVideos(db, c.discord_id, w) === 0) {
        queueNotice(db, { robloxUserId: c.roblox_user_id, discordId: c.discord_id, kind: willLeave ? "removal_warning" : "demotion_warning", param: cur }, now);
        db.prepare("UPDATE creators SET warn_week = ? WHERE discord_id = ?").run(w, c.discord_id);
        out.warnings++;
      }
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
  return out;
}

// ---------- Creadores antiguos (llamado dentro del tx de /game/pull) ----------
// p = { userId, name, creatorTier } que manda el juego. Devuelve true si cambió algo.
export function handleGameCreator(db, cfg, p, now = Date.now()) {
  if (!Number.isInteger(p.creatorTier)) return false;
  db.prepare("UPDATE players SET creator_tier = ? WHERE user_id = ?").run(p.creatorTier, p.userId);
  const approved = db.prepare("SELECT * FROM creators WHERE roblox_user_id = ? AND link_status = 'approved'").get(p.userId);
  const row = db.prepare("SELECT * FROM legacy_creators WHERE roblox_user_id = ?").get(p.userId);
  if (approved) {
    // Aprobados antes de los rangos automáticos: se toma el nivel que ya tienen en el juego.
    if (!approved.tier && p.creatorTier > 0) db.prepare("UPDATE creators SET tier = ? WHERE discord_id = ?").run(LEVEL_KEYS[p.creatorTier - 1] || "Creator", approved.discord_id);
    if (row && row.status !== "approved") db.prepare("UPDATE legacy_creators SET status = 'approved', updated_at = ? WHERE roblox_user_id = ?").run(now, p.userId);
    return false;
  }
  if (p.creatorTier <= 0) return false;
  // Ya se le quitó y el cambio sigue en camino: no repetir.
  const pendingRemoval = db.prepare("SELECT 1 FROM rewards WHERE user_id = ? AND kind = 'tierset' AND pack = 'None' AND status = 'pending'").get(p.userId);
  if (pendingRemoval) return false;
  const app = db.prepare("SELECT status FROM applications WHERE roblox_user_id = ? ORDER BY id DESC LIMIT 1").get(p.userId);
  const applied = app && (app.status === "pending" || app.status === "contacted");
  const cutoff = cfg.creators.legacyDeadline;
  const remove = (reason) => {
    queueTierSet(db, p.userId, "None", now);
    queueNotice(db, { robloxUserId: p.userId, kind: "legacy_removed", param: reason }, now);
    db.prepare(`INSERT INTO legacy_creators (roblox_user_id, name, game_tier, status, notified_at, deadline_at, updated_at, removed_at)
      VALUES (?, ?, ?, 'removed', ?, ?, ?, ?)
      ON CONFLICT(roblox_user_id) DO UPDATE SET name = excluded.name, game_tier = excluded.game_tier, status = 'removed', updated_at = excluded.updated_at, removed_at = excluded.removed_at`)
      .run(p.userId, p.name, p.creatorTier, now, now, now, now);
    audit(db, SYSTEM, "legacy.removed", `${p.name} (${p.userId})`, { motivo: reason, nivel: p.creatorTier });
    return true;
  };
  if (!row) {
    if (applied) {
      db.prepare("INSERT INTO legacy_creators (roblox_user_id, name, game_tier, status, notified_at, deadline_at, updated_at) VALUES (?, ?, ?, 'applied', ?, ?, ?)")
        .run(p.userId, p.name, p.creatorTier, now, Math.min(now + cfg.creators.legacyNoticeDays * DAY, cutoff), now);
      return true;
    }
    if (now >= cutoff) return remove("deadline");
    const deadline = Math.min(now + cfg.creators.legacyNoticeDays * DAY, cutoff);
    db.prepare("INSERT INTO legacy_creators (roblox_user_id, name, game_tier, status, notified_at, deadline_at, updated_at) VALUES (?, ?, ?, 'notified', ?, ?, ?)")
      .run(p.userId, p.name, p.creatorTier, now, deadline, now);
    queueNotice(db, { robloxUserId: p.userId, kind: "legacy_join", param: dateCol(deadline - 1) }, now);
    audit(db, SYSTEM, "legacy.notified", `${p.name} (${p.userId})`, { plazo: dateCol(deadline - 1), nivel: p.creatorTier });
    return true;
  }
  if (applied) {
    if (row.status !== "applied") db.prepare("UPDATE legacy_creators SET status = 'applied', game_tier = ?, updated_at = ? WHERE roblox_user_id = ?").run(p.creatorTier, now, p.userId);
    return false;
  }
  if (app?.status === "rejected") return remove("rejected");
  // Sin solicitud en revisión: pierde el rol al pasar su plazo (o si se lo volvieron a dar sin aprobarlo).
  if (now >= row.deadline_at || row.status === "removed") return remove(row.status === "removed" ? "not_approved" : "deadline");
  return false;
}

// Estado de los antiguos para el panel.
export function legacyList(db) {
  return db.prepare(`
    SELECT l.*, p.display_name, p.last_seen, p.creator_tier,
      (SELECT status FROM applications a WHERE a.roblox_user_id = l.roblox_user_id ORDER BY id DESC LIMIT 1) AS app_status
    FROM legacy_creators l LEFT JOIN players p ON p.user_id = l.roblox_user_id
    ORDER BY CASE l.status WHEN 'notified' THEN 0 WHEN 'applied' THEN 1 WHEN 'removed' THEN 2 ELSE 3 END, l.deadline_at`).all();
}

// Avisos enviados (con su estado de entrega en el juego).
export function noticeList(db, { limit = 200, robloxUserId = null } = {}) {
  const where = robloxUserId ? "WHERE n.roblox_user_id = ?" : "";
  const args = robloxUserId ? [robloxUserId, Math.min(500, limit)] : [Math.min(500, limit)];
  return db.prepare(`
    SELECT n.*, r.status AS delivery, r.delivered_at, p.name AS roblox_name, p.display_name,
      d.username AS discord_username, d.global_name AS discord_global
    FROM notices n
    LEFT JOIN rewards r ON r.id = n.reward_id
    LEFT JOIN players p ON p.user_id = n.roblox_user_id
    LEFT JOIN discord_users d ON d.id = n.discord_id
    ${where} ORDER BY n.id DESC LIMIT ?`).all(...args);
}
