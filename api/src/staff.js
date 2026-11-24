// Programa de staff (2026-11-23): Helper → Moderator Jr → Moderator.
// Solicitudes (formulario), vínculo Discord + Roblox, rango sincronizado con el juego (kind "staffset")
// y con Discord (bot), tareas mensuales con evidencias, ascensos, staff antiguo (fecha límite de
// vínculo), reportes del juego y métricas de actividad.
import { randomBytes } from "node:crypto";
import { Fail, audit, monthOf, monthStartMs, getDiscordUser, weekOf, weekStartMs } from "./creators.js";
import { RANK_KEYS, rankIndex, RANK_BY_KEY, TASKS, TASK_BY_KEY, QUESTIONS } from "./staffProgram.js";
import { getStaffSettings } from "./staffSettings.js";
import { discordMinutesByDay } from "./discordActivity.js";

const DAY = 86_400_000;
const OFFSET_MS = -5 * 3_600_000;
const SYSTEM = { id: "system", name: "Sistema", role: "system" };
const newId = () => randomBytes(12).toString("hex");
const dayKey = (ms) => new Date(ms + OFFSET_MS).toISOString().slice(0, 10);
const hourKey = (ms) => new Date(ms + OFFSET_MS).toISOString().slice(0, 13);
const dateCol = (ms) => new Date(ms + OFFSET_MS).toISOString().slice(0, 10).split("-").reverse().join("/");
const prevMonth = (m) => { const [y, mo] = m.split("-").map(Number); return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, "0")}`; };
const nextMonth = (m) => { const [y, mo] = m.split("-").map(Number); return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`; };
const clean = (v, max) => (typeof v === "string" ? v.normalize("NFKC").replace(/\r/g, "").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ").trim().slice(0, max) : "");
const httpUrl = (v) => { const s = clean(v, 400); try { const u = new URL(s); return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : ""; } catch { return ""; } };

export const STAFF_NOTICES = ["staff_welcome", "staff_promoted", "staff_demoted", "staff_task_warning", "staff_removed", "staff_link_reminder", "staff_removal_warning"];

// ---------- Cola hacia el juego ----------
function queueStaffSet(db, userId, rank, now) {
  if (!userId) return null;
  db.prepare("UPDATE rewards SET status = 'cancelled' WHERE user_id = ? AND kind = 'staffset' AND status = 'pending'").run(userId);
  const id = newId();
  db.prepare("INSERT INTO rewards (id, user_id, tier, source, day, created_at, kind, pack) VALUES (?, ?, 'staff', 'creator', ?, ?, 'staffset', ?)")
    .run(id, userId, dayKey(now), now, rank);
  return id;
}
function queueStaffNotice(db, { robloxUserId, discordId = null, kind, param = "", actor = SYSTEM.name }, now) {
  if (!robloxUserId || !STAFF_NOTICES.includes(kind)) return null;
  const id = newId();
  const p = String(param ?? "").replace(/[^A-Za-z0-9/ -]/g, "").slice(0, 24);
  db.prepare("INSERT INTO rewards (id, user_id, tier, source, day, created_at, kind, pack, period) VALUES (?, ?, 'staff', 'creator', ?, ?, 'notice', ?, ?)")
    .run(id, robloxUserId, dayKey(now), now, kind, p);
  db.prepare("INSERT INTO notices (roblox_user_id, discord_id, kind, param, reward_id, actor, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(robloxUserId, discordId, kind, p, id, actor, now);
  return id;
}

// ---------- Quién es quién ----------
export const getStaff = (db, discordId) => db.prepare("SELECT * FROM staff WHERE discord_id = ?").get(String(discordId)) || null;
const activeStaff = (s) => s && s.link_status === "approved" && RANK_KEYS.includes(s.rank);
const nameOf = (db, id) => {
  const u = db.prepare("SELECT username, global_name FROM discord_users WHERE id = ?").get(String(id));
  return u ? (u.global_name ? `${u.global_name} (@${u.username})` : `@${u.username}`) : `#${id}`;
};

// Roles efectivos para el panel. El rango de la página manda; el de Discord solo vale para el staff
// antiguo que aún no vinculó y solo hasta la fecha límite.
export function withStaffRoles(db, cfg, user, now = Date.now()) {
  if (!user) return null;
  const s = getStaff(db, user.id);
  let rank = activeStaff(s) ? s.rank : null;
  const legacy = !rank && user.roles.staffDiscord && now < cfg.staff.linkDeadline ? user.roles.staffDiscord : null;
  rank = rank || legacy;
  const r = user.roles;
  const moderator = r.admin || r.moderator || rank === "Moderator";
  const modjr = moderator || rank === "ModeratorJr";
  return {
    ...user,
    roles: { ...r, moderator, modjr, helper: modjr || rank === "Helper", staffRank: rank, staffLinked: activeStaff(s), staffLegacy: Boolean(legacy) },
  };
}
const actorRankIdx = (actor) => (actor.role === "admin" ? 9 : rankIndex(actor.staffRank) || (actor.role === "moderator" ? 3 : 0));

// ---------- Solicitud de Helper ----------
export function myStaffApplication(db, discordId) {
  const a = db.prepare("SELECT * FROM staff_applications WHERE discord_id = ? ORDER BY id DESC LIMIT 1").get(String(discordId));
  return a ? { ...a, answers: JSON.parse(a.answers) } : null;
}

export function submitStaffApplication(db, discordId, body, now = Date.now()) {
  const s = getStaff(db, discordId);
  if (activeStaff(s)) throw new Fail("already_staff");
  const last = myStaffApplication(db, discordId);
  if (last && (last.status === "pending" || last.status === "contacted")) throw new Fail("already_pending");
  if (last && last.status === "rejected" && now - (last.reviewed_at || last.created_at) < 14 * DAY) throw new Fail("wait_after_reject");
  const userId = Number(body?.robloxUserId);
  if (!Number.isSafeInteger(userId) || userId <= 0) throw new Fail("pick_account");
  const p = db.prepare("SELECT user_id, name, played FROM players WHERE user_id = ?").get(userId);
  if (!p || !p.played) throw new Fail("must_play");
  if (db.prepare("SELECT 1 FROM staff WHERE roblox_user_id = ? AND link_status = 'approved' AND rank != 'None' AND discord_id != ?").get(userId, String(discordId))) throw new Fail("roblox_taken");
  const answers = {};
  for (const q of QUESTIONS) {
    let v = body?.answers?.[q.key];
    if (q.type === "yesno") v = v === "si" || v === "no" ? v : "";
    else v = clean(v, q.type === "long" ? 1200 : 200);
    if (q.required && !v) throw Object.assign(new Fail("missing_answer"), { field: q.key });
    if (q.required && q.type === "long" && v.length < 10) throw Object.assign(new Fail("answer_short"), { field: q.key });
    answers[q.key] = v;
  }
  if (body?.age13 !== true) throw new Fail("age_required");
  const info = db.prepare("INSERT INTO staff_applications (discord_id, roblox_user_id, roblox_name, answers, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(String(discordId), userId, p.name, JSON.stringify(answers), now);
  return { ok: true, id: Number(info.lastInsertRowid) };
}

export function staffApplicationsQueue(db) {
  return db.prepare("SELECT * FROM staff_applications WHERE status IN ('pending','contacted') ORDER BY id").all().map((a) => {
    const p = db.prepare("SELECT level, first_seen, last_seen FROM players WHERE user_id = ?").get(a.roblox_user_id);
    return { ...a, answers: JSON.parse(a.answers), user: getDiscordUser(db, a.discord_id), player: p ? { level: p.level, firstSeen: p.first_seen, lastSeen: p.last_seen } : null };
  });
}

// ---------- Rango ----------
// Pone el rango de un miembro (o "None" = fuera del staff). Devuelve el trabajo de roles de Discord.
export function setStaffRank(db, actor, discordId, rank, why = null, now = Date.now()) {
  const s = getStaff(db, discordId);
  if (!s || s.link_status !== "approved") return null;
  if (rank !== "None" && !RANK_KEYS.includes(rank)) throw new Fail("bad_rank");
  const before = s.rank;
  if (before === rank) return null;
  db.prepare("UPDATE staff SET rank = ?, rank_changed_at = ?, strikes = CASE WHEN ? = 'None' THEN 0 ELSE strikes END WHERE discord_id = ?").run(rank, now, rank, s.discord_id);
  queueStaffSet(db, s.roblox_user_id, rank, now);
  const kind = rank === "None" ? "staff_removed" : !RANK_KEYS.includes(before) ? "staff_welcome" : rankIndex(rank) > rankIndex(before) ? "staff_promoted" : "staff_demoted";
  const param = rank === "None" ? (why || "") : RANK_BY_KEY[rank].name;
  queueStaffNotice(db, { robloxUserId: s.roblox_user_id, discordId: s.discord_id, kind, param, actor: actor.name }, now);
  audit(db, actor, `staff.${kind.replace("staff_", "")}`, `${s.roblox_name} (${s.roblox_user_id})`, { de: before, a: rank, motivo: why });
  return { discordId: s.discord_id, staffRank: rank, reason: `staff ${before} → ${rank}` };
}

function canManage(actor, fromRank, toRank) {
  if (actor.role === "admin") return true;
  // Solo el Admin pone o quita Moderators.
  if (fromRank === "Moderator" || toRank === "Moderator") return false;
  return actorRankIdx(actor) >= 3;
}

export function reviewStaffApplication(db, actor, body, now = Date.now()) {
  if (actorRankIdx(actor) < 3) throw new Fail("forbidden", 403);
  const a = db.prepare("SELECT * FROM staff_applications WHERE id = ?").get(Number(body?.id));
  if (!a) throw new Fail("not_found", 404);
  if (a.discord_id === String(actor.id)) throw new Fail("own_item", 403);
  const status = { approve: "approved", reject: "rejected", contacted: "contacted" }[body?.action];
  if (!status) throw new Fail("bad_action");
  if (a.status === "approved" || a.status === "rejected") throw new Fail("already_reviewed");
  const note = clean(body?.note, 500) || null;
  db.prepare("UPDATE staff_applications SET status = ?, reviewed_by = ?, reviewed_at = ?, review_note = ? WHERE id = ?").run(status, actor.name, now, note, a.id);
  let job = null;
  if (status === "approved") {
    const taken = db.prepare("SELECT 1 FROM staff WHERE roblox_user_id = ? AND link_status = 'approved' AND rank != 'None' AND discord_id != ?").get(a.roblox_user_id, a.discord_id);
    if (taken) throw new Fail("roblox_taken");
    const p = db.prepare("SELECT name, display_name FROM players WHERE user_id = ?").get(a.roblox_user_id) || { name: a.roblox_name, display_name: a.roblox_name };
    db.prepare(`INSERT INTO staff (discord_id, roblox_user_id, roblox_name, roblox_display, rank, link_status, joined_at, reviewed_by, reviewed_at)
      VALUES (?, ?, ?, ?, 'None', 'approved', ?, ?, ?)
      ON CONFLICT(discord_id) DO UPDATE SET roblox_user_id = excluded.roblox_user_id, roblox_name = excluded.roblox_name, roblox_display = excluded.roblox_display,
        rank = 'None', link_status = 'approved', joined_at = excluded.joined_at, strikes = 0, eval_month = NULL, warn_month = NULL,
        reviewed_by = excluded.reviewed_by, reviewed_at = excluded.reviewed_at`)
      .run(a.discord_id, a.roblox_user_id, p.name, p.display_name, now, actor.name, now);
    job = setStaffRank(db, actor, a.discord_id, "Helper", null, now);
  }
  audit(db, actor, `staffapp.${body.action}`, nameOf(db, a.discord_id), { id: a.id, roblox: `${a.roblox_name} (${a.roblox_user_id})`, note });
  return { ok: true, status, job };
}

export function changeStaffRank(db, actor, body, now = Date.now()) {
  const s = getStaff(db, body?.discordId);
  if (!activeStaff(s) && body?.rank !== "None") throw new Fail("not_found", 404);
  if (s.discord_id === String(actor.id)) throw new Fail("own_item", 403);
  const rank = String(body?.rank || "");
  if (!canManage(actor, s.rank, rank)) throw new Fail("admin_only", 403);
  const job = setStaffRank(db, actor, s.discord_id, rank, rank === "None" ? "manual" : null, now);
  if (!job) throw new Fail("same_rank");
  return { ok: true, job };
}

// ---------- Ascensos ----------
export function requestPromotion(db, actor, body, now = Date.now(), cfg = null) {
  const s = getStaff(db, body?.discordId || actor.id);
  if (!activeStaff(s)) throw new Fail("not_found", 404);
  const to = RANK_KEYS[rankIndex(s.rank)]; // siguiente
  if (!to) throw new Fail("max_rank");
  if (db.prepare("SELECT 1 FROM staff_promotions WHERE discord_id = ? AND status = 'pending'").get(s.discord_id)) throw new Fail("already_pending");
  // Lo pide el propio miembro o alguien de un rango superior.
  const self = s.discord_id === String(actor.id);
  if (!self && actorRankIdx(actor) <= rankIndex(s.rank)) throw new Fail("forbidden", 403);
  // El propio miembro tiene que cumplir los requisitos; un rango superior puede proponerlo igual.
  if (self && cfg) {
    const st = promotionStatus(db, getStaffSettings(db, cfg), s, now);
    if (!st.eligible) throw Object.assign(new Fail("not_eligible"), { field: st.checks.find((c) => !c.ok)?.label });
  }
  const reason = clean(body?.reason, 600);
  if (reason.length < 10) throw new Fail("request_short");
  db.prepare("INSERT INTO staff_promotions (discord_id, from_rank, to_rank, requested_by, requested_id, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(s.discord_id, s.rank, to, actor.name, String(actor.id), reason, now);
  return { ok: true, to };
}

export function reviewPromotion(db, actor, body, now = Date.now()) {
  const p = db.prepare("SELECT * FROM staff_promotions WHERE id = ?").get(Number(body?.id));
  if (!p || p.status !== "pending") throw new Fail("not_found", 404);
  if (p.discord_id === String(actor.id)) throw new Fail("own_item", 403);
  if (!canManage(actor, p.from_rank, p.to_rank)) throw new Fail("admin_only", 403);
  const action = body?.action;
  if (action !== "approve" && action !== "reject") throw new Fail("bad_action");
  const note = clean(body?.note, 500) || null;
  db.prepare("UPDATE staff_promotions SET status = ?, reviewed_by = ?, reviewed_at = ?, review_note = ? WHERE id = ?").run(action === "approve" ? "approved" : "rejected", actor.name, now, note, p.id);
  let job = null;
  if (action === "approve") {
    const s = getStaff(db, p.discord_id);
    if (!activeStaff(s) || s.rank !== p.from_rank) throw new Fail("already_reviewed");
    job = setStaffRank(db, actor, p.discord_id, p.to_rank, null, now);
  } else audit(db, actor, "staff.promotion_rejected", nameOf(db, p.discord_id), { a: p.to_rank, note });
  return { ok: true, job };
}

// ---------- Staff antiguo: vincular cuenta ----------
// Quien ya tiene un rol de staff en Discord elige su Roblox. Si el juego ya vio esa cuenta con una
// etiqueta de staff, se confirma sola; si no, la confirma un Moderator o el Admin.
export function requestStaffLink(db, cfg, user, body, now = Date.now()) {
  const rank = user.roles.staffDiscord;
  if (!rank) throw new Fail("not_staff");
  const cur = getStaff(db, user.id);
  if (activeStaff(cur)) throw new Fail("already_linked");
  if (now >= cfg.staff.linkDeadline) throw new Fail("link_deadline");
  const userId = Number(body?.userId);
  const p = Number.isSafeInteger(userId) ? db.prepare("SELECT user_id, name, display_name, played, staff_tier FROM players WHERE user_id = ?").get(userId) : null;
  if (!p || !p.played) throw new Fail("must_play");
  if (db.prepare("SELECT 1 FROM staff WHERE roblox_user_id = ? AND link_status = 'approved' AND rank != 'None' AND discord_id != ?").get(userId, String(user.id))) throw new Fail("roblox_taken");
  const auto = (p.staff_tier || 0) >= 1;
  db.prepare(`INSERT INTO staff (discord_id, roblox_user_id, roblox_name, roblox_display, rank, link_status, legacy, joined_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?)
    ON CONFLICT(discord_id) DO UPDATE SET roblox_user_id = excluded.roblox_user_id, roblox_name = excluded.roblox_name, roblox_display = excluded.roblox_display,
      rank = excluded.rank, link_status = excluded.link_status, legacy = 1`)
    .run(String(user.id), p.user_id, p.name, p.display_name, auto ? "None" : rank, auto ? "approved" : "pending", now);
  let job = null;
  if (auto) {
    job = setStaffRank(db, { id: user.id, name: nameOf(db, user.id), role: "staff" }, user.id, rank, null, now);
    db.prepare("UPDATE staff_legacy_discord SET status = 'linked' WHERE discord_id = ?").run(String(user.id));
    db.prepare("UPDATE staff_legacy_game SET status = 'linked', updated_at = ? WHERE roblox_user_id = ?").run(now, p.user_id);
  }
  return { ok: true, auto, rank, roblox: { userId: p.user_id, name: p.name }, job };
}

export function reviewStaffLink(db, actor, body, now = Date.now()) {
  const s = getStaff(db, body?.discordId);
  if (!s || s.link_status !== "pending") throw new Fail("not_found", 404);
  if (s.discord_id === String(actor.id)) throw new Fail("own_item", 403);
  if (!canManage(actor, s.rank, s.rank)) throw new Fail("admin_only", 403);
  const action = body?.action;
  if (action === "reject") {
    db.prepare("DELETE FROM staff WHERE discord_id = ?").run(s.discord_id);
    audit(db, actor, "staff.link_rejected", nameOf(db, s.discord_id), { roblox: `${s.roblox_name} (${s.roblox_user_id})` });
    return { ok: true, job: null };
  }
  if (action !== "approve") throw new Fail("bad_action");
  const rank = s.rank;
  db.prepare("UPDATE staff SET link_status = 'approved', rank = 'None', reviewed_by = ?, reviewed_at = ? WHERE discord_id = ?").run(actor.name, now, s.discord_id);
  const job = setStaffRank(db, actor, s.discord_id, rank, null, now);
  db.prepare("UPDATE staff_legacy_discord SET status = 'linked' WHERE discord_id = ?").run(s.discord_id);
  db.prepare("UPDATE staff_legacy_game SET status = 'linked', updated_at = ? WHERE roblox_user_id = ?").run(now, s.roblox_user_id);
  return { ok: true, job };
}

// ---------- Actividad que manda el juego (dentro del tx de /game/pull) ----------
// p = { userId, name, staffTier, duty, staffActions }, prevSeen = last_seen anterior de ese jugador.
export function handleGameStaff(db, cfg, p, prevSeen, now = Date.now()) {
  const tier = Number.isInteger(p.staffTier) ? p.staffTier : null;
  if (tier != null) db.prepare("UPDATE players SET staff_tier = ? WHERE user_id = ?").run(tier, p.userId);
  const linked = db.prepare("SELECT * FROM staff WHERE roblox_user_id = ? AND link_status = 'approved' AND rank != 'None'").get(p.userId);
  if (!(tier > 0) && !linked) return;
  // Tiempo conectado desde el pull anterior (máx. 150 s: si hubo un hueco largo no se cuenta).
  const gap = prevSeen ? now - prevSeen : 0;
  const secs = gap > 0 && gap <= 150_000 ? Math.round(gap / 1000) : 0;
  const a = p.staffActions || {};
  const num = (v) => Math.max(0, Math.min(500, Math.floor(Number(v) || 0)));
  db.prepare(`INSERT INTO staff_days (day, user_id, seconds, duty_seconds, actions, sanctions, helps) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(day, user_id) DO UPDATE SET seconds = seconds + excluded.seconds, duty_seconds = duty_seconds + excluded.duty_seconds,
      actions = actions + excluded.actions, sanctions = sanctions + excluded.sanctions, helps = helps + excluded.helps`)
    .run(dayKey(now), p.userId, secs, p.duty ? secs : 0, num(a.total), num(a.sanctions), num(a.helps));
  if (secs) db.prepare("INSERT INTO staff_hours (hour, user_id, seconds) VALUES (?, ?, ?) ON CONFLICT(hour, user_id) DO UPDATE SET seconds = seconds + excluded.seconds").run(hourKey(now), p.userId, secs);
  // Staff antiguo en el juego (etiqueta sin vincular en la página).
  if (tier > 0 && !linked) {
    const row = db.prepare("SELECT * FROM staff_legacy_game WHERE roblox_user_id = ?").get(p.userId);
    const pendingRemoval = db.prepare("SELECT 1 FROM rewards WHERE user_id = ? AND kind = 'staffset' AND pack = 'None' AND status = 'pending'").get(p.userId);
    if (pendingRemoval) return;
    if (now >= cfg.staff.linkDeadline) {
      queueStaffSet(db, p.userId, "None", now);
      queueStaffNotice(db, { robloxUserId: p.userId, kind: "staff_removed", param: "link" }, now);
      db.prepare(`INSERT INTO staff_legacy_game (roblox_user_id, name, staff_tier, status, notified_at, updated_at) VALUES (?, ?, ?, 'removed', ?, ?)
        ON CONFLICT(roblox_user_id) DO UPDATE SET status = 'removed', staff_tier = excluded.staff_tier, updated_at = excluded.updated_at`).run(p.userId, p.name, tier, now, now);
      audit(db, SYSTEM, "staff.legacy_removed", `${p.name} (${p.userId})`, { rango: RANK_KEYS[tier - 1] });
    } else if (!row) {
      db.prepare("INSERT INTO staff_legacy_game (roblox_user_id, name, staff_tier, status, notified_at, updated_at) VALUES (?, ?, ?, 'notified', ?, ?)").run(p.userId, p.name, tier, now, now);
      queueStaffNotice(db, { robloxUserId: p.userId, kind: "staff_link_reminder", param: dateCol(cfg.staff.linkDeadline - 1) }, now);
    }
  }
}

export function recordPullHour(db, jobId, players, now = Date.now()) {
  db.prepare("INSERT INTO pull_hours (hour, job_id, players) VALUES (?, ?, ?) ON CONFLICT(hour, job_id) DO UPDATE SET players = MAX(players, excluded.players)")
    .run(hourKey(now), jobId, players);
}

// Miembros de Discord con rol de staff (lista del bot). Antes de la fecha límite se anotan como
// pendientes; después, a quien no vinculó se le quitan los roles.
export function syncDiscordStaff(db, cfg, members, now = Date.now()) {
  const jobs = [];
  for (const m of members) {
    const s = getStaff(db, m.id);
    const st = cfg.discord.staffRoles;
    const rank = m.roles.includes(st.Moderator) ? "Moderator" : m.roles.includes(st.ModeratorJr) ? "ModeratorJr" : "Helper";
    if (activeStaff(s)) {
      // Vinculado: Discord debe tener solo el rol de su rango.
      const want = st[s.rank];
      if (!m.roles.includes(want) || m.roles.some((r) => r !== want)) jobs.push({ discordId: m.id, staffRank: s.rank, reason: "sincronizar rango" });
      continue;
    }
    db.prepare(`INSERT INTO staff_legacy_discord (discord_id, username, rank, seen_at, status) VALUES (?, ?, ?, ?, 'pending')
      ON CONFLICT(discord_id) DO UPDATE SET username = excluded.username, rank = excluded.rank, seen_at = excluded.seen_at`)
      .run(m.id, m.globalName || m.username, rank, now);
    if (now >= cfg.staff.linkDeadline && !(s && s.link_status === "pending")) {
      jobs.push({ discordId: m.id, staffRank: "None", reason: "no vinculó su cuenta antes de la fecha límite" });
      db.prepare("UPDATE staff_legacy_discord SET status = 'removed', removed_at = ? WHERE discord_id = ?").run(now, m.id);
    }
  }
  return jobs;
}

// ---------- Tareas ----------
function monthRange(month) {
  const start = monthStartMs(month);
  const end = monthStartMs(nextMonth(month));
  return { start, end, d0: dayKey(start), d1: dayKey(end - 1) };
}

// ---------- Cuota semanal (juego + Discord) ----------
// Semana = lunes 00:00 a domingo 23:59 (UTC-5). Se cumple si: juego + crédito de Discord ≥ horas
// y el juego llega al mínimo. Con mucha actividad en Discord el juego que se pide baja, nunca por
// debajo de minGameHours. Una excusa aprobada para esa semana la da por cumplida.
const round1 = (v) => Math.round(v * 10) / 10;
export function weekStatus(db, settings, s, week, now = Date.now()) {
  const start = weekStartMs(week), end = weekStartMs(week + 1);
  const d0 = dayKey(start), d1 = dayKey(end - 1);
  const rank = RANK_KEYS.includes(s.rank) ? s.rank : "Helper";
  const q = settings.weekly[rank];
  const gameSecs = s.roblox_user_id ? db.prepare("SELECT COALESCE(SUM(seconds),0) AS v FROM staff_days WHERE user_id = ? AND day BETWEEN ? AND ?").get(s.roblox_user_id, d0, d1).v : 0;
  const dmin = Object.values(discordMinutesByDay(db, settings, s.discord_id, d0, d1)).reduce((x, y) => x + y, 0);
  const game = gameSecs / 3600, credit = dmin / 60;
  const requiredGame = Math.max(q.minGameHours, q.hours - credit);
  const excused = Boolean(db.prepare("SELECT 1 FROM staff_excuses WHERE discord_id = ? AND scope = 'week' AND period = ? AND status = 'approved'").get(s.discord_id, d0));
  const met = excused || (game + 1e-9 >= requiredGame && game + credit + 1e-9 >= q.hours);
  return {
    week, start: d0, end: d1, ended: now >= end, current: now >= start && now < end,
    gameHours: round1(game), discordHours: round1(credit), totalHours: round1(game + credit),
    targetHours: q.hours, minGameHours: q.minGameHours, requiredGameHours: round1(requiredGame),
    missingGameHours: round1(Math.max(0, requiredGame - game)), missingHours: round1(Math.max(0, q.hours - game - credit)),
    met, excused,
  };
}
// Semanas que cuentan para un mes: las que empiezan (lunes) dentro de ese mes.
function weeksOfMonth(month) {
  const start = monthStartMs(month), end = monthStartMs(nextMonth(month));
  const out = [];
  for (let w = weekOf(start); weekStartMs(w) < end; w++) if (weekStartMs(w) >= start) out.push(w);
  return out;
}

export function taskProgress(db, s, month, settings) {
  const { start, end, d0, d1 } = monthRange(month);
  const days = s.roblox_user_id ? db.prepare(`SELECT COALESCE(SUM(seconds),0) AS secs, COALESCE(SUM(duty_seconds),0) AS duty, COALESCE(SUM(sanctions),0) AS sanctions,
    COALESCE(SUM(actions),0) AS actions, COALESCE(SUM(helps),0) AS helps FROM staff_days WHERE user_id = ? AND day BETWEEN ? AND ?`).get(s.roblox_user_id, d0, d1) : {};
  // Días activos: ≥ 10 min en el juego o (si está activado) ≥ 10 min de actividad en Discord.
  const gameDays = s.roblox_user_id ? db.prepare("SELECT day FROM staff_days WHERE user_id = ? AND day BETWEEN ? AND ? AND seconds >= 600").all(s.roblox_user_id, d0, d1).map((r) => r.day) : [];
  const dByDay = discordMinutesByDay(db, settings, s.discord_id, d0, d1);
  const activeDays = new Set(gameDays);
  if (settings.discord.countsForDays) for (const [d, m] of Object.entries(dByDay)) if (m >= 10) activeDays.add(d);
  const discordMsgs = db.prepare("SELECT COALESCE(SUM(messages),0) AS n FROM staff_discord_days WHERE discord_id = ? AND day BETWEEN ? AND ?").get(s.discord_id, d0, d1).n;
  const reportsFiled = s.roblox_user_id ? db.prepare("SELECT COUNT(*) AS n FROM reports WHERE reporter_id = ? AND created_at >= ? AND created_at < ?").get(s.roblox_user_id, start, end).n : 0;
  const reviews = db.prepare(`SELECT COUNT(*) AS n FROM audit WHERE actor_id = ? AND ts >= ? AND ts < ? AND (action LIKE 'evidence.%' OR action LIKE 'application.%'
    OR action LIKE 'bonus.%' OR action LIKE 'link.%' OR action LIKE 'report.%' OR action LIKE 'staffev.%' OR action LIKE 'staffapp.%' OR action LIKE 'excuse.%')`).get(s.discord_id, start, end).n;
  const ev = Object.fromEntries(db.prepare("SELECT task, COALESCE(SUM(approved),0) AS v, SUM(status = 'pending') AS p FROM staff_evidence WHERE discord_id = ? AND month = ? GROUP BY task")
    .all(s.discord_id, month).map((r) => [r.task, r]));
  const weeks = weeksOfMonth(month).map((w) => weekStatus(db, settings, s, w));
  const auto = {
    weeks: weeks.filter((w) => w.met).length,
    duty: Math.floor(((days.duty || 0) / 3600) * 10) / 10,
    days: activeDays.size,
    moderation: (days.sanctions || 0) + reportsFiled,
    reviews,
  };
  const rank = RANK_KEYS.includes(s.rank) ? s.rank : "Helper";
  const tasks = TASKS.map((t) => {
    // La meta de semanas nunca pasa de las semanas que tiene el mes.
    let target = settings.targets[t.key]?.[rank] ?? t.targets[rank] ?? 0;
    if (t.key === "weeks") target = Math.min(target, weeks.length);
    const value = t.track === "auto" ? auto[t.key] : ev[t.key]?.v || 0;
    return { key: t.key, name: t.name, unit: t.unit, track: t.track, optional: !!t.optional, target, value, pending: ev[t.key]?.p || 0, done: target === 0 || value >= target };
  }).filter((t) => t.target > 0);
  const required = tasks.filter((t) => !t.optional);
  const doneCount = required.filter((t) => t.done).length;
  const excuse = db.prepare("SELECT id, reason, reviewed_by AS reviewedBy FROM staff_excuses WHERE discord_id = ? AND scope = 'month' AND period = ? AND status = 'approved'").get(s.discord_id, month) || null;
  return {
    month, tasks, weeks, required: required.length, done: doneCount, complete: doneCount === required.length || Boolean(excuse), excused: Boolean(excuse), excuse,
    percent: required.length ? Math.round(required.reduce((a, t) => a + Math.min(1, t.value / t.target), 0) / required.length * 100) : 100,
    activity: { actions: days.actions || 0, helps: days.helps || 0, sanctions: days.sanctions || 0, reportsFiled, gameHours: round1((days.secs || 0) / 3600), discordHours: round1(Object.values(dByDay).reduce((x, y) => x + y, 0) / 60), discordMessages: discordMsgs },
  };
}

export function addStaffEvidence(db, discordId, body, now = Date.now()) {
  const s = getStaff(db, discordId);
  if (!activeStaff(s)) throw new Fail("not_staff", 403);
  const t = TASK_BY_KEY[body?.task];
  if (!t || t.track !== "evidence") throw new Fail("bad_task");
  const amount = Math.floor(Number(body?.amount));
  if (!(amount >= 1 && amount <= 500)) throw new Fail("bad_amount");
  const url = httpUrl(body?.url);
  const file = typeof body?.file === "string" && /^[a-f0-9]{32}\.(png|jpg|webp)$/.test(body.file) ? body.file : null;
  if (!url && !file) throw new Fail("need_proof");
  const note = clean(body?.note, 600);
  if (note.length < 5) throw new Fail("note_short");
  const recent = db.prepare("SELECT COUNT(*) AS n FROM staff_evidence WHERE discord_id = ? AND created_at > ?").get(s.discord_id, now - DAY).n;
  if (recent >= 15) throw new Fail("too_many", 429);
  // Hasta 3 días después de fin de mes se puede subir al mes anterior.
  const month = body?.month === "previous" && now < monthStartMs(monthOf(now)) + 3 * DAY ? prevMonth(monthOf(now)) : monthOf(now);
  const info = db.prepare("INSERT INTO staff_evidence (discord_id, task, month, amount, url, file, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(s.discord_id, t.key, month, amount, url || null, file, note, now);
  return { ok: true, id: Number(info.lastInsertRowid), month };
}

export function reviewStaffEvidence(db, actor, body, now = Date.now()) {
  const e = db.prepare("SELECT * FROM staff_evidence WHERE id = ?").get(Number(body?.id));
  if (!e) throw new Fail("not_found", 404);
  if (e.discord_id === String(actor.id)) throw new Fail("own_item", 403);
  if (e.status !== "pending") throw new Fail("already_reviewed");
  const owner = getStaff(db, e.discord_id);
  // Revisa alguien de rango superior al dueño (ModJr revisa Helpers; Moderator revisa Jr; Admin a todos).
  if (actorRankIdx(actor) <= rankIndex(owner?.rank)) throw new Fail("forbidden", 403);
  const note = clean(body?.note, 500) || null;
  if (body?.action === "reject") {
    if (!note) throw new Fail("note_required");
    db.prepare("UPDATE staff_evidence SET status = 'rejected', approved = 0, reviewed_by = ?, reviewed_id = ?, reviewed_at = ?, review_note = ? WHERE id = ?").run(actor.name, String(actor.id), now, note, e.id);
  } else if (body?.action === "approve") {
    const approved = body?.amount == null ? e.amount : Math.floor(Number(body.amount));
    if (!(approved >= 0 && approved <= 500)) throw new Fail("bad_amount");
    db.prepare("UPDATE staff_evidence SET status = 'approved', approved = ?, reviewed_by = ?, reviewed_id = ?, reviewed_at = ?, review_note = ? WHERE id = ?").run(approved, actor.name, String(actor.id), now, note, e.id);
  } else throw new Fail("bad_action");
  audit(db, actor, `staffev.${body.action}`, nameOf(db, e.discord_id), { id: e.id, tarea: e.task, pide: e.amount, suma: body?.action === "approve" ? (body?.amount ?? e.amount) : 0, note });
  return { ok: true };
}

export function staffEvidenceQueue(db, actor) {
  return db.prepare("SELECT e.*, s.rank, s.roblox_name FROM staff_evidence e JOIN staff s ON s.discord_id = e.discord_id WHERE e.status = 'pending' ORDER BY e.id").all()
    .filter((e) => actorRankIdx(actor) > rankIndex(e.rank) && e.discord_id !== String(actor.id))
    .map((e) => ({ ...e, user: getDiscordUser(db, e.discord_id) }));
}

// Cierre de mes y avisos (cada 15 min junto con los creadores).
// Al llegar al tope de meses sin cumplir no sale al instante: tiene excuseDays para presentar una
// excusa. Si se la aprueban se le quita esa falta y sigue; si no, sale del staff.
export function evaluateStaff(db, cfg, now = Date.now()) {
  const settings = getStaffSettings(db, cfg);
  const R = settings.rules;
  const out = { removed: 0, warnings: 0, removalWarnings: 0, roleJobs: [] };
  const m = monthOf(now);
  const prev = prevMonth(m);
  const closeAt = monthStartMs(m) + R.graceDays * DAY;
  const dayOfMonth = Number(dayKey(now).slice(8, 10));
  for (let s of db.prepare("SELECT * FROM staff WHERE link_status = 'approved' AND rank != 'None'").all()) {
    // 1) Cerrar el mes anterior (solo si estuvo el mes completo).
    if (now >= closeAt && s.eval_month !== prev) {
      const fullMonth = s.joined_at <= monthStartMs(prev) && (!s.legacy || (s.reviewed_at || s.joined_at) <= monthStartMs(prev));
      let strikes = s.strikes;
      if (fullMonth) {
        const p = taskProgress(db, s, prev, settings);
        strikes = p.complete ? 0 : strikes + 1;
        db.prepare(`INSERT INTO staff_month_results (discord_id, month, percent, complete, excused, strike, evaluated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(discord_id, month) DO UPDATE SET percent = excluded.percent, complete = excluded.complete, excused = excluded.excused, strike = excluded.strike, evaluated_at = excluded.evaluated_at`)
          .run(s.discord_id, prev, p.percent, p.complete ? 1 : 0, p.excused ? 1 : 0, p.complete ? 0 : 1, now);
      }
      db.prepare("UPDATE staff SET eval_month = ?, strikes = ? WHERE discord_id = ?").run(prev, strikes, s.discord_id);
      s = { ...s, eval_month: prev, strikes };
      if (fullMonth && R.failMonthsToRemove > 0 && strikes >= R.failMonthsToRemove && !s.removal_due_at) {
        const due = now + R.excuseDays * DAY;
        db.prepare("UPDATE staff SET removal_due_at = ? WHERE discord_id = ?").run(due, s.discord_id);
        s.removal_due_at = due;
        queueStaffNotice(db, { robloxUserId: s.roblox_user_id, discordId: s.discord_id, kind: "staff_removal_warning", param: dateCol(due) }, now);
        audit(db, SYSTEM, "staff.removal_warning", nameOf(db, s.discord_id), { faltas: strikes, hasta: dateCol(due) });
        out.removalWarnings++;
      }
    }
    // 2) Salida pendiente: se aplica al vencer el plazo si sigue con las faltas (sin excusa aprobada).
    if (s.removal_due_at) {
      const pendingExcuse = db.prepare("SELECT 1 FROM staff_excuses WHERE discord_id = ? AND status = 'pending'").get(s.discord_id);
      if (R.failMonthsToRemove === 0 || s.strikes < R.failMonthsToRemove) {
        db.prepare("UPDATE staff SET removal_due_at = NULL WHERE discord_id = ?").run(s.discord_id);
      } else if (now >= s.removal_due_at && !pendingExcuse) {
        db.prepare("UPDATE staff SET removal_due_at = NULL WHERE discord_id = ?").run(s.discord_id);
        const job = setStaffRank(db, SYSTEM, s.discord_id, "None", "tasks", now);
        if (job) { out.roleJobs.push(job); out.removed++; }
        continue;
      }
    }
    // 3) Aviso a mitad de mes si va por debajo del porcentaje.
    if (dayOfMonth >= R.warnDay && s.warn_month !== m && s.joined_at <= monthStartMs(m)) {
      const p = taskProgress(db, s, m, settings);
      if (!p.complete && p.percent < R.warnPercent) {
        queueStaffNotice(db, { robloxUserId: s.roblox_user_id, discordId: s.discord_id, kind: "staff_task_warning", param: m }, now);
        db.prepare("UPDATE staff SET warn_month = ? WHERE discord_id = ?").run(m, s.discord_id);
        out.warnings++;
      }
    }
  }
  return out;
}

// ---------- Excusas ----------
// Semana: la actual o la anterior (lunes AAAA-MM-DD). Mes: el actual o el anterior mientras no
// pasen excuseDays desde el cierre (o mientras tenga una salida pendiente).
export function submitExcuse(db, cfg, discordId, body, now = Date.now()) {
  const settings = getStaffSettings(db, cfg);
  const s = getStaff(db, discordId);
  if (!activeStaff(s)) throw new Fail("not_staff", 403);
  const scope = body?.scope === "week" ? "week" : body?.scope === "month" ? "month" : null;
  if (!scope) throw new Fail("bad_scope");
  let period;
  if (scope === "week") {
    const w = weekOf(now) - (body?.which === "previous" ? 1 : 0);
    period = dayKey(weekStartMs(w));
  } else {
    const m = monthOf(now);
    if (body?.which === "previous") {
      const limit = monthStartMs(m) + (settings.rules.graceDays + settings.rules.excuseDays) * DAY;
      if (now > limit && !(s.removal_due_at && s.eval_month === prevMonth(m))) throw new Fail("excuse_late");
      period = prevMonth(m);
    } else period = m;
  }
  const reason = clean(body?.reason, 800);
  if (reason.length < 15) throw new Fail("reason_short");
  if (db.prepare("SELECT 1 FROM staff_excuses WHERE discord_id = ? AND scope = ? AND period = ? AND status IN ('pending','approved')").get(s.discord_id, scope, period)) throw new Fail("already_pending");
  const year = dayKey(now).slice(0, 4);
  const used = db.prepare("SELECT COUNT(*) AS n FROM staff_excuses WHERE discord_id = ? AND status = 'approved' AND substr(period, 1, 4) = ?").get(s.discord_id, year).n;
  if (used >= settings.rules.maxExcusesPerYear) throw new Fail("excuse_limit");
  const info = db.prepare("INSERT INTO staff_excuses (discord_id, scope, period, reason, url, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(s.discord_id, scope, period, reason, httpUrl(body?.url) || null, now);
  return { ok: true, id: Number(info.lastInsertRowid), scope, period };
}

export function excuseQueue(db, actor) {
  return db.prepare("SELECT x.*, s.rank, s.strikes, s.removal_due_at FROM staff_excuses x JOIN staff s ON s.discord_id = x.discord_id WHERE x.status = 'pending' ORDER BY s.removal_due_at IS NULL, x.id").all()
    .filter((x) => actorRankIdx(actor) > rankIndex(x.rank) && x.discord_id !== String(actor.id))
    .map((x) => ({ ...x, user: getDiscordUser(db, x.discord_id) }));
}

export function reviewExcuse(db, cfg, actor, body, now = Date.now()) {
  const settings = getStaffSettings(db, cfg);
  const x = db.prepare("SELECT * FROM staff_excuses WHERE id = ?").get(Number(body?.id));
  if (!x) throw new Fail("not_found", 404);
  if (x.discord_id === String(actor.id)) throw new Fail("own_item", 403);
  if (x.status !== "pending") throw new Fail("already_reviewed");
  const owner = getStaff(db, x.discord_id);
  if (actorRankIdx(actor) <= rankIndex(owner?.rank)) throw new Fail("forbidden", 403);
  const note = clean(body?.note, 500) || null;
  if (body?.action === "reject") {
    if (!note) throw new Fail("note_required");
    db.prepare("UPDATE staff_excuses SET status = 'rejected', reviewed_by = ?, reviewed_id = ?, reviewed_at = ?, review_note = ? WHERE id = ?").run(actor.name, String(actor.id), now, note, x.id);
  } else if (body?.action === "approve") {
    db.prepare("UPDATE staff_excuses SET status = 'approved', reviewed_by = ?, reviewed_id = ?, reviewed_at = ?, review_note = ? WHERE id = ?").run(actor.name, String(actor.id), now, note, x.id);
    // Mes ya cerrado con falta: se quita esa falta (y con ella la salida pendiente si baja del tope).
    if (x.scope === "month") {
      const r = db.prepare("SELECT * FROM staff_month_results WHERE discord_id = ? AND month = ?").get(x.discord_id, x.period);
      if (r && r.strike) {
        db.prepare("UPDATE staff_month_results SET strike = 0, excused = 1 WHERE discord_id = ? AND month = ?").run(x.discord_id, x.period);
        db.prepare("UPDATE staff SET strikes = MAX(0, strikes - 1) WHERE discord_id = ?").run(x.discord_id);
      }
    }
    // Semana excusada en un mes ya cerrado: se vuelve a calcular ese mes.
    if (x.scope === "week") {
      const month = x.period.slice(0, 7);
      const r = db.prepare("SELECT * FROM staff_month_results WHERE discord_id = ? AND month = ?").get(x.discord_id, month);
      if (r && r.strike && owner) {
        if (taskProgress(db, owner, month, settings).complete) {
          db.prepare("UPDATE staff_month_results SET strike = 0, complete = 1 WHERE discord_id = ? AND month = ?").run(x.discord_id, month);
          db.prepare("UPDATE staff SET strikes = MAX(0, strikes - 1) WHERE discord_id = ?").run(x.discord_id);
        }
      }
    }
    // Si ya no llega al tope de faltas, la salida pendiente se cancela.
    const after = getStaff(db, x.discord_id);
    if (after.removal_due_at && (settings.rules.failMonthsToRemove === 0 || after.strikes < settings.rules.failMonthsToRemove)) {
      db.prepare("UPDATE staff SET removal_due_at = NULL WHERE discord_id = ?").run(x.discord_id);
    }
  } else throw new Fail("bad_action");
  audit(db, actor, `excuse.${body.action}`, nameOf(db, x.discord_id), { id: x.id, [x.scope === "week" ? "semana" : "mes"]: x.period, note });
  return { ok: true };
}

// ---------- Ascensos: requisitos ----------
export function promotionStatus(db, settings, s, now = Date.now()) {
  const next = RANK_KEYS[rankIndex(s.rank)];
  if (!next) return { next: null, eligible: false, checks: [] };
  const rule = settings.promotion[next];
  const since = s.rank_changed_at || s.joined_at;
  const days = Math.floor((now - since) / DAY);
  const cur = taskProgress(db, s, monthOf(now), settings);
  const months = db.prepare("SELECT month, complete FROM staff_month_results WHERE discord_id = ? AND evaluated_at >= ? ORDER BY month DESC LIMIT ?").all(s.discord_id, since, Math.max(1, rule.completeMonths));
  let streak = 0;
  for (const r of months) { if (r.complete) streak++; else break; }
  const checks = [
    { label: `${rule.minDays} días en tu rango`, ok: days >= rule.minDays, detail: `llevas ${days}` },
    { label: `${rule.minPercent} % de las tareas de este mes`, ok: cur.percent >= rule.minPercent, detail: `vas en ${cur.percent} %` },
  ];
  if (rule.completeMonths > 0) checks.push({ label: `${rule.completeMonths} mes(es) cumplidos seguidos`, ok: streak >= rule.completeMonths, detail: `tienes ${streak}` });
  if (s.strikes > 0) checks.push({ label: "Sin meses sin cumplir", ok: false, detail: `tienes ${s.strikes}` });
  return { next, eligible: checks.every((c) => c.ok), checks, rule };
}

// ---------- Reportes del juego ----------
export function recordReport(db, body, now = Date.now()) {
  const reporterId = Number(body?.reporterId), targetId = Number(body?.targetId);
  if (!Number.isSafeInteger(reporterId) || !Number.isSafeInteger(targetId) || reporterId <= 0 || targetId <= 0) return { ok: false, error: "bad_request" };
  const reason = clean(body?.reason, 300);
  if (reason.length < 4) return { ok: false, error: "bad_reason" };
  const recent = db.prepare("SELECT COUNT(*) AS n FROM reports WHERE reporter_id = ? AND created_at > ?").get(reporterId, now - 3_600_000).n;
  if (recent >= 30) return { ok: false, error: "slow_down" };
  const info = db.prepare("INSERT INTO reports (reporter_id, reporter_name, target_id, target_name, reason, online, job_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(reporterId, clean(body?.reporterName, 20) || String(reporterId), targetId, clean(body?.targetName, 20) || String(targetId), reason, body?.online ? 1 : 0,
      typeof body?.jobId === "string" ? body.jobId.replace(/[^A-Za-z0-9-]/g, "").slice(0, 64) : null, now);
  return { ok: true, id: Number(info.lastInsertRowid) };
}

export function reportsList(db, status = "open") {
  const rows = status === "all" ? db.prepare("SELECT * FROM reports ORDER BY id DESC LIMIT 200").all() : db.prepare("SELECT * FROM reports WHERE status = ? ORDER BY id DESC LIMIT 200").all(status);
  return rows.map((r) => ({ ...r, previous: db.prepare("SELECT COUNT(*) AS n FROM reports WHERE target_id = ? AND id != ?").get(r.target_id, r.id).n }));
}

export function reviewReport(db, actor, body, now = Date.now()) {
  if (actorRankIdx(actor) < 2) throw new Fail("forbidden", 403);
  const r = db.prepare("SELECT * FROM reports WHERE id = ?").get(Number(body?.id));
  if (!r) throw new Fail("not_found", 404);
  if (r.status !== "open") throw new Fail("already_reviewed");
  const status = { resolve: "resolved", dismiss: "dismissed" }[body?.action];
  if (!status) throw new Fail("bad_action");
  const note = clean(body?.note, 500);
  if (!note) throw new Fail("note_required");
  db.prepare("UPDATE reports SET status = ?, resolved_by = ?, resolved_id = ?, resolved_at = ?, note = ? WHERE id = ?").run(status, actor.name, String(actor.id), now, note, r.id);
  audit(db, actor, `report.${body.action}`, `${r.target_name} (${r.target_id})`, { id: r.id, reportó: r.reporter_name, note });
  return { ok: true };
}

// ---------- Estado de un miembro y panel del staff ----------
export function myStaffState(db, cfg, user, now = Date.now()) {
  const settings = getStaffSettings(db, cfg);
  const s = getStaff(db, user.id);
  const m = monthOf(now);
  const base = { staff: s ? { rank: s.rank, linkStatus: s.link_status, legacy: !!s.legacy, roblox: s.roblox_user_id ? { userId: s.roblox_user_id, name: s.roblox_name } : null, joinedAt: s.joined_at, strikes: s.strikes } : null,
    application: myStaffApplication(db, user.id), discordRank: user.roles.staffDiscord, linkDeadline: cfg.staff.linkDeadline };
  if (!activeStaff(s)) return base;
  return {
    ...base,
    current: taskProgress(db, s, m, settings),
    previous: taskProgress(db, s, prevMonth(m), settings),
    week: weekStatus(db, settings, s, weekOf(now), now),
    promotion: promotionStatus(db, settings, s, now),
    removalDueAt: s.removal_due_at || null,
    excuses: db.prepare("SELECT id, scope, period, reason, status, review_note AS reviewNote, reviewed_by AS reviewedBy, created_at AS createdAt FROM staff_excuses WHERE discord_id = ? ORDER BY id DESC LIMIT 20").all(s.discord_id),
    excuseRules: { days: settings.rules.excuseDays, maxPerYear: settings.rules.maxExcusesPerYear, usedThisYear: db.prepare("SELECT COUNT(*) AS n FROM staff_excuses WHERE discord_id = ? AND status = 'approved' AND substr(period, 1, 4) = ?").get(s.discord_id, dayKey(now).slice(0, 4)).n },
    evidences: db.prepare("SELECT id, task, month, amount, approved, url, file, note, status, review_note AS reviewNote, created_at AS createdAt FROM staff_evidence WHERE discord_id = ? ORDER BY id DESC LIMIT 40").all(s.discord_id),
    promotions: db.prepare("SELECT id, from_rank AS fromRank, to_rank AS toRank, status, reason, review_note AS note, created_at AS createdAt FROM staff_promotions WHERE discord_id = ? ORDER BY id DESC LIMIT 10").all(s.discord_id),
    notices: db.prepare("SELECT kind, param, created_at AS createdAt FROM notices WHERE roblox_user_id = ? AND kind LIKE 'staff_%' ORDER BY id DESC LIMIT 10").all(s.roblox_user_id),
  };
}

export function staffDashboard(db, cfg, now = Date.now()) {
  const settings = getStaffSettings(db, cfg);
  const m = monthOf(now);
  const onlineCut = now - 3 * 60_000;
  const rows = db.prepare(`SELECT s.*, d.username, d.global_name, d.avatar AS d_avatar, p.last_seen, p.level, p.staff_tier FROM staff s
    LEFT JOIN discord_users d ON d.id = s.discord_id LEFT JOIN players p ON p.user_id = s.roblox_user_id ORDER BY s.rank DESC, s.roblox_name`).all();
  const today = dayKey(now);
  const week0 = dayKey(now - 6 * DAY);
  const members = rows.map((s) => {
    const isActive = s.link_status === "approved" && RANK_KEYS.includes(s.rank);
    const prog = isActive ? taskProgress(db, s, m, settings) : null;
    const wk = isActive ? weekStatus(db, settings, s, weekOf(now), now) : null;
    const t = s.roblox_user_id ? db.prepare("SELECT COALESCE(SUM(CASE WHEN day = ? THEN seconds END),0) AS today, COALESCE(SUM(seconds),0) AS week, COALESCE(SUM(duty_seconds),0) AS dutyWeek FROM staff_days WHERE user_id = ? AND day >= ?").get(today, s.roblox_user_id, week0) : {};
    return {
      discordId: s.discord_id, discord: s.global_name ? `${s.global_name} (@${s.username})` : s.username ? `@${s.username}` : `#${s.discord_id}`,
      roblox: s.roblox_user_id ? { userId: s.roblox_user_id, name: s.roblox_name } : null,
      rank: s.rank, linkStatus: s.link_status, legacy: !!s.legacy, joinedAt: s.joined_at, strikes: s.strikes,
      gameRank: s.staff_tier ? RANK_KEYS[s.staff_tier - 1] : s.staff_tier === 0 ? "None" : null,
      online: Boolean(s.last_seen && s.last_seen > onlineCut), lastSeen: s.last_seen, level: s.level,
      hoursToday: Math.round((t.today || 0) / 360) / 10, hoursWeek: Math.round((t.week || 0) / 360) / 10, dutyWeek: Math.round((t.dutyWeek || 0) / 360) / 10,
      progress: prog ? { percent: prog.percent, done: prog.done, required: prog.required, complete: prog.complete, excused: prog.excused, tasks: prog.tasks, activity: prog.activity } : null,
      week: wk, removalDueAt: s.removal_due_at || null,
    };
  });
  const active = members.filter((x) => x.linkStatus === "approved" && RANK_KEYS.includes(x.rank));
  // Cobertura por hora del día (últimos 14 días): minutos promedio de staff conectado vs jugadores.
  const since = hourKey(now - 14 * DAY);
  const staffByHour = Array.from({ length: 24 }, () => 0);
  for (const r of db.prepare("SELECT substr(hour, 12, 2) AS h, SUM(seconds) AS s FROM staff_hours WHERE hour >= ? GROUP BY h").all(since)) staffByHour[Number(r.h)] = Math.round(r.s / 60 / 14);
  const playersByHour = Array.from({ length: 24 }, () => 0);
  for (const r of db.prepare("SELECT substr(hour, 12, 2) AS h, SUM(players) AS p, COUNT(DISTINCT substr(hour, 1, 10)) AS d FROM pull_hours WHERE hour >= ? GROUP BY h").all(since)) playersByHour[Number(r.h)] = Math.round(r.p / Math.max(1, r.d));
  const reports = db.prepare("SELECT SUM(status = 'open') AS open, SUM(status != 'open' AND resolved_at >= ?) AS closedMonth, AVG(CASE WHEN status != 'open' AND resolved_at >= ? THEN resolved_at - created_at END) AS avgMs FROM reports").get(monthStartMs(m), monthStartMs(m));
  const legacyDiscord = db.prepare("SELECT * FROM staff_legacy_discord ORDER BY status, rank DESC").all();
  const legacyGame = db.prepare("SELECT l.*, p.last_seen FROM staff_legacy_game l LEFT JOIN players p ON p.user_id = l.roblox_user_id ORDER BY l.status, l.staff_tier DESC").all();
  return {
    month: m,
    summary: {
      total: active.length, byRank: Object.fromEntries(RANK_KEYS.map((k) => [k, active.filter((x) => x.rank === k).length])),
      online: active.filter((x) => x.online).length,
      complete: active.filter((x) => x.progress?.complete).length,
      atRisk: active.filter((x) => x.progress && !x.progress.complete && x.progress.percent < settings.rules.warnPercent).length,
      weekMet: active.filter((x) => x.week?.met).length,
      discordHoursMonth: Math.round(active.reduce((a, x) => a + (x.progress?.activity.discordHours || 0), 0) * 10) / 10,
      removalsPending: active.filter((x) => x.removalDueAt).length,
      hoursWeek: Math.round(active.reduce((a, x) => a + x.hoursWeek, 0) * 10) / 10,
      reportsOpen: reports.open || 0, reportsClosedMonth: reports.closedMonth || 0, reportAvgHours: reports.avgMs ? Math.round(reports.avgMs / 360_000) / 10 : null,
      pendingLinks: members.filter((x) => x.linkStatus === "pending").length,
      legacyPending: legacyDiscord.filter((x) => x.status === "pending").length + legacyGame.filter((x) => x.status === "notified").length,
      linkDeadline: cfg.staff.linkDeadline,
    },
    coverage: { staffMinutes: staffByHour, players: playersByHour },
    members, legacyDiscord, legacyGame,
    promotions: db.prepare("SELECT * FROM staff_promotions WHERE status = 'pending' ORDER BY id").all().map((p) => {
      const s = getStaff(db, p.discord_id);
      return { ...p, user: getDiscordUser(db, p.discord_id), check: s && activeStaff(s) ? promotionStatus(db, settings, s, now) : null };
    }),
  };
}
