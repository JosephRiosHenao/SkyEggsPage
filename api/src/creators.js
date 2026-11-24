// Programa de creadores: solicitudes, vinculación con Roblox, evidencias, reclamos,
// bonos de Robux, pedidos especiales y registro de acciones (quién hizo qué).
import { randomBytes } from "node:crypto";
import { tx } from "./db.js";
import { PACK_BY_KEY, bestPack, robuxFor, SPECIAL } from "./program.js";
import { trackableSite } from "./views.js";
import { queueTierSet, queueNotice, tierOf } from "./lifecycle.js";

// ---------- Fechas (mismo reloj que el juego: lunes 00:00 UTC-5) ----------
const OFFSET_S = -5 * 3600;
export const weekOf = (ms) => Math.floor((Math.floor((ms / 1000 + OFFSET_S) / 86400) + 3) / 7);
export const weekStartMs = (w) => ((w * 7 - 3) * 86400 - OFFSET_S) * 1000;
export const monthOf = (ms) => new Date(ms + OFFSET_S * 1000).toISOString().slice(0, 7);
export function monthStartMs(m) {
  const [y, mo] = m.split("-").map(Number);
  return Date.UTC(y, mo - 1, 1) - OFFSET_S * 1000;
}
const prevMonth = (m) => { const [y, mo] = m.split("-").map(Number); return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, "0")}`; };
const nextMonth = (m) => { const [y, mo] = m.split("-").map(Number); return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`; };
const dateMs = (d) => Date.parse(`${d}T12:00:00-05:00`);
const todayStr = (ms) => new Date(ms + OFFSET_S * 1000).toISOString().slice(0, 10);
export function weekLabel(w) {
  const f = (ms) => new Date(ms + OFFSET_S * 1000).toISOString().slice(5, 10).split("-").reverse().join("/");
  return `${f(weekStartMs(w))} – ${f(weekStartMs(w) + 6 * 86400_000)}`;
}

class Fail extends Error { constructor(code, status = 400) { super(code); this.code = code; this.status = status; } }
export { Fail };

const str = (v, max) => (typeof v === "string" ? v.normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max) : "");
const textBlock = (v, max) => (typeof v === "string" ? v.normalize("NFKC").replace(/\r/g, "").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ").trim().slice(0, max) : "");
function httpUrl(v) {
  const s = str(v, 400);
  if (!s) return "";
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : "";
  } catch { return ""; }
}
export const PLATFORMS = ["YouTube", "TikTok", "Twitch", "Kick", "Instagram", "Facebook", "Otra"];

// Enlace comparable: sin parámetros de rastreo (?_r=…&_t=…, ?si=…), sin "www." ni "/" final.
export function canonicalUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^(www|m)\./, "").toLowerCase();
    const keep = host.includes("youtube.com") && u.pathname === "/watch" ? `?v=${u.searchParams.get("v") || ""}` : "";
    return `${host}${u.pathname.replace(/\/+$/, "").toLowerCase()}${keep}`;
  } catch { return String(url || ""); }
}
// Redes de una solicitud: tipo válido, enlace http(s), seguidores enteros; sin repetidas (se queda la de más seguidores).
export function cleanPlatforms(list) {
  const out = [];
  for (const p of (Array.isArray(list) ? list : []).slice(0, 12)) {
    const item = {
      type: PLATFORMS.includes(p?.type) ? p.type : "Otra",
      url: httpUrl(p?.url),
      followers: Math.max(0, Math.min(1e9, Math.floor(Number(p?.followers) || 0))),
    };
    if (!item.url) continue;
    const dup = out.find((o) => canonicalUrl(o.url) === canonicalUrl(item.url));
    if (dup) { dup.followers = Math.max(dup.followers, item.followers); continue; }
    out.push(item);
  }
  return out.slice(0, 6);
}
// ¿El enlace es un video suelto en vez del canal? (lo marca el panel para que el moderador lo corrija).
export function looksLikeVideo(url) {
  try {
    const u = new URL(url);
    const h = u.hostname.replace(/^(www|m)\./, "");
    if (h === "youtu.be") return true;
    if (h.endsWith("youtube.com")) return /^\/(shorts|watch|live|embed)\b/.test(u.pathname);
    if (h.endsWith("tiktok.com")) return /\/video\/|\/photo\//.test(u.pathname) || h.startsWith("vm.") || h.startsWith("vt.");
    if (h.endsWith("twitch.tv")) return /^\/videos\/|\/clip\//.test(u.pathname) || h.startsWith("clips.");
    if (h.endsWith("kick.com")) return /\/videos?\/|\/clips?\//.test(u.pathname);
    if (h.endsWith("instagram.com")) return /^\/(p|reel|reels|tv)\//.test(u.pathname);
    if (h.endsWith("facebook.com")) return /\/videos\/|\/reel\/|^\/watch/.test(u.pathname);
  } catch { /* enlace raro */ }
  return false;
}

// ---------- Registro de acciones ----------
export function audit(db, actor, action, target, details) {
  db.prepare("INSERT INTO audit (ts, actor_id, actor_name, actor_role, action, target, details) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(Date.now(), String(actor.id), actor.name, actor.role, action, target == null ? null : String(target), details == null ? null : JSON.stringify(details).slice(0, 2000));
}
export function auditList(db, limit = 150) {
  return db.prepare("SELECT * FROM audit ORDER BY id DESC LIMIT ?").all(Math.min(500, limit))
    .map((r) => ({ ...r, details: r.details ? JSON.parse(r.details) : null }));
}

// ---------- Usuarios de Discord ----------
export function upsertDiscordUser(db, user, roles, now = Date.now()) {
  db.prepare(`
    INSERT INTO discord_users (id, username, global_name, avatar, in_guild, is_admin, is_mod, is_creator, first_login, last_login)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET username = excluded.username, global_name = excluded.global_name, avatar = excluded.avatar,
      in_guild = excluded.in_guild, is_admin = excluded.is_admin, is_mod = excluded.is_mod, is_creator = excluded.is_creator,
      last_login = excluded.last_login
  `).run(String(user.id), str(user.username, 40) || "discord", str(user.global_name, 40) || null, user.avatar || null,
    roles.inGuild ? 1 : 0, roles.admin ? 1 : 0, roles.moderator ? 1 : 0, roles.creator ? 1 : 0, now, now);
  db.prepare("UPDATE discord_users SET staff_discord = ? WHERE id = ?").run(roles.staffDiscord || null, String(user.id));
}
export function getDiscordUser(db, id) {
  const u = db.prepare("SELECT * FROM discord_users WHERE id = ?").get(String(id));
  if (!u) return null;
  return {
    id: u.id, username: u.username, globalName: u.global_name,
    avatar: u.avatar && /^[a-f0-9_]+$/i.test(u.avatar) ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=128` : null,
    roles: { inGuild: !!u.in_guild, admin: !!u.is_admin, moderator: !!u.is_mod, creator: !!u.is_creator, staffDiscord: u.staff_discord || null },
    roblox: linkedRoblox(db, u.id, u.roblox_user_id),
  };
}

// ---------- Cuenta de Roblox del usuario (obligatoria para usar el panel) ----------
// Una cuenta de Roblox por usuario de Discord y viceversa. Solo cuentas que ya jugaron Sky Eggs.
// Si es creador aprobado o staff vinculado, la cuenta queda fija (la cambia un moderador).
export function linkedRoblox(db, discordId, userId) {
  if (userId === undefined) userId = db.prepare("SELECT roblox_user_id FROM discord_users WHERE id = ?").get(String(discordId))?.roblox_user_id;
  if (!userId) return null;
  const p = db.prepare("SELECT name, display_name, level FROM players WHERE user_id = ?").get(userId);
  const locked = Boolean(db.prepare("SELECT 1 FROM creators WHERE discord_id = ? AND link_status = 'approved'").get(String(discordId))
    || db.prepare("SELECT 1 FROM staff WHERE discord_id = ? AND link_status = 'approved' AND rank != 'None'").get(String(discordId)));
  return { userId, name: p?.name || `#${userId}`, displayName: p?.display_name || p?.name || null, level: p?.level ?? null, locked };
}
export function linkAccount(db, discordId, robloxUserId, now = Date.now()) {
  const p = playedPlayer(db, robloxUserId);
  const cur = linkedRoblox(db, discordId);
  if (cur && cur.userId === p.user_id) return { ok: true, roblox: cur };
  if (cur?.locked) throw new Fail("already_linked");
  const other = db.prepare("SELECT id FROM discord_users WHERE roblox_user_id = ? AND id != ?").get(p.user_id, String(discordId));
  if (other) throw new Fail("roblox_taken");
  db.prepare("UPDATE discord_users SET roblox_user_id = ?, roblox_linked_at = ? WHERE id = ?").run(p.user_id, now, String(discordId));
  return { ok: true, roblox: linkedRoblox(db, discordId) };
}
// Un moderador confirmó esta cuenta (creador o staff): pasa a ser la cuenta del usuario aunque otro la hubiera elegido.
export function syncAccount(db, discordId, robloxUserId, now = Date.now()) {
  if (!robloxUserId) return;
  db.prepare("UPDATE discord_users SET roblox_user_id = NULL WHERE roblox_user_id = ? AND id != ?").run(robloxUserId, String(discordId));
  db.prepare("UPDATE discord_users SET roblox_user_id = ?, roblox_linked_at = ? WHERE id = ?").run(robloxUserId, now, String(discordId));
}
const nameOf = (db, id) => {
  const u = db.prepare("SELECT username, global_name FROM discord_users WHERE id = ?").get(String(id));
  return u ? (u.global_name ? `${u.global_name} (@${u.username})` : `@${u.username}`) : `#${id}`;
};

// ---------- Solicitudes para entrar al programa ----------
export function myApplication(db, discordId) {
  const a = db.prepare("SELECT * FROM applications WHERE discord_id = ? ORDER BY id DESC LIMIT 1").get(String(discordId));
  return a ? { ...a, platforms: JSON.parse(a.platforms) } : null;
}

export function submitApplication(db, discordId, body, now = Date.now()) {
  const last = myApplication(db, discordId);
  if (last && (last.status === "pending" || last.status === "contacted")) throw new Fail("already_pending");
  if (last && last.status === "approved" && getCreator(db, discordId)?.link_status === "approved") throw new Fail("already_approved");
  if (last && last.status === "rejected" && now - (last.reviewed_at || last.created_at) < 7 * 86400_000) throw new Fail("wait_after_reject");
  if (body?.age13 !== true) throw new Fail("age_required");
  // La solicitud usa la cuenta de Roblox vinculada al panel (obligatoria); robloxUserId solo si coincide o no hay.
  const linked = linkedRoblox(db, discordId);
  const player = playedPlayer(db, linked ? linked.userId : body?.robloxUserId);
  const email = str(body?.email, 120);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Fail("bad_email");
  const platforms = cleanPlatforms(body?.platforms);
  if (!platforms.length) throw new Fail("need_platform");
  const about = textBlock(body?.about, 1000);
  if (about.length < 20) throw new Fail("about_short");
  const sampleUrl = httpUrl(body?.sampleUrl);
  const info = db.prepare("INSERT INTO applications (discord_id, roblox_name, roblox_user_id, email, platforms, about, sample_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(String(discordId), player.name, player.user_id, email || null, JSON.stringify(platforms), about, sampleUrl || null, now);
  return { ok: true, id: Number(info.lastInsertRowid) };
}

// ---------- Vinculación Discord ↔ Roblox ----------
// Solo cuentas que el juego ya vio conectadas: así sabemos que existen y que juegan.
// El creador elige su cuenta de la lista y un moderador confirma que es la suya.
function playedPlayer(db, userId) {
  userId = Number(userId);
  if (!Number.isSafeInteger(userId) || userId <= 0) throw new Fail("pick_account");
  const p = db.prepare("SELECT user_id, name, display_name, played FROM players WHERE user_id = ?").get(userId);
  if (!p || !p.played) throw new Fail("must_play");
  return p;
}

export function getCreator(db, discordId) {
  return db.prepare("SELECT * FROM creators WHERE discord_id = ?").get(String(discordId)) || null;
}

export function requestLink(db, discordId, userId, now = Date.now()) {
  const player = playedPlayer(db, userId);
  userId = player.user_id;
  const cur = getCreator(db, discordId);
  if (cur && cur.link_status === "approved") throw new Fail("already_linked");
  // Salió del programa: tiene que volver a aplicar (no basta con vincular otra vez).
  if (cur && cur.link_status === "removed") throw new Fail("must_reapply");
  const taken = db.prepare("SELECT discord_id FROM creators WHERE roblox_user_id = ? AND link_status = 'approved'").get(userId);
  if (taken) throw new Fail("roblox_taken");
  db.prepare(`
    INSERT INTO creators (discord_id, roblox_user_id, roblox_name, roblox_display, link_status, link_code, link_requested_at)
    VALUES (?, ?, ?, ?, 'pending', NULL, ?)
    ON CONFLICT(discord_id) DO UPDATE SET roblox_user_id = excluded.roblox_user_id, roblox_name = excluded.roblox_name,
      roblox_display = excluded.roblox_display, link_status = 'pending', link_code = excluded.link_code,
      link_requested_at = excluded.link_requested_at, link_reviewed_by = NULL, link_reviewed_at = NULL, link_note = NULL
  `).run(String(discordId), userId, player.name, player.display_name, now);
  return { ok: true, roblox: { userId, name: player.name, displayName: player.display_name } };
}

// ---------- Evidencias ----------
export function saveUploadName() { return `${randomBytes(16).toString("hex")}`; }

// Hasta cuándo se refrescan las vistas: el último día en que ese video todavía
// cuenta para algún reclamo (plazo de su semana o de su mes, el que termine después).
let cfgGrace = { week: 3, month: 5 };
export function setGrace(cfg) { cfgGrace = { week: cfg.creators?.claimGraceDaysWeek ?? 3, month: cfg.creators?.claimGraceDaysMonth ?? 5 }; }
function trackUntil(g, week, month) {
  return Math.max(weekStartMs(week + 1) + g.week * 86400_000, monthStartMs(nextMonth(month)) + g.month * 86400_000);
}

export function addEvidence(db, discordId, body, now = Date.now()) {
  const recent = db.prepare("SELECT COUNT(*) AS n FROM evidences WHERE discord_id = ? AND created_at > ?").get(String(discordId), now - 86400_000).n;
  if (recent >= 20) throw new Fail("too_many", 429);
  const kind = body?.kind === "live" ? "live" : "video";
  const platform = PLATFORMS.includes(body?.platform) ? body.platform : "Otra";
  const url = httpUrl(body?.url);
  if (!url) throw new Fail("bad_url");
  const publishedOn = str(body?.publishedOn, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(publishedOn) || Number.isNaN(dateMs(publishedOn))) throw new Fail("bad_date");
  const pub = dateMs(publishedOn);
  if (publishedOn > todayStr(now)) throw new Fail("future_date");
  if (now - pub > 45 * 86400_000) throw new Fail("too_old");
  const file = typeof body?.file === "string" && /^[a-f0-9]{32}\.(png|jpg|webp)$/.test(body.file) ? body.file : null;
  if (db.prepare("SELECT 1 FROM evidences WHERE url = ? AND status != 'rejected'").get(url)) throw new Fail("duplicate_url");
  const track = trackableSite(url) ? "auto" : "manual";
  const info = db.prepare(`
    INSERT INTO evidences (discord_id, kind, platform, url, title, published_on, week, month, file, note, created_at, track, track_until)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(String(discordId), kind, platform, url, str(body?.title, 120) || null, publishedOn, weekOf(pub), monthOf(pub), file, textBlock(body?.note, 500) || null, now,
    track, trackUntil(cfgGrace, weekOf(pub), monthOf(pub)));
  return { ok: true, id: Number(info.lastInsertRowid), track };
}

// ---------- Vistas automáticas ----------
export function dueForProbe(db, cfg, now = Date.now(), limit = 20) {
  return db.prepare(`
    SELECT id, url FROM evidences
    WHERE track = 'auto' AND status != 'rejected' AND (track_until IS NULL OR track_until > ?)
      AND (auto_checked_at IS NULL OR auto_checked_at < ?)
    ORDER BY COALESCE(auto_checked_at, 0) LIMIT ?`).all(now, now - cfg.views.refreshHours * 3_600_000, limit);
}

// Guarda el resultado de una lectura. Si la evidencia ya está aprobada y es automática,
// sus vistas pasan a ser las leídas. Tras varios fallos seguidos queda como vistas fijas.
export function applyProbe(db, cfg, id, result, now = Date.now()) {
  const ev = db.prepare("SELECT * FROM evidences WHERE id = ?").get(Number(id));
  if (!ev) return null;
  return tx(db, () => {
    if (result.ok) {
      db.prepare("UPDATE evidences SET auto_views = ?, auto_checked_at = ?, auto_error = NULL, auto_fails = 0, auto_meta = ? WHERE id = ?")
        .run(result.views, now, JSON.stringify(result.meta || {}), ev.id);
      if (ev.status === "approved" && ev.track === "auto") {
        db.prepare("UPDATE evidences SET views = ? WHERE id = ?").run(result.views, ev.id);
        db.prepare("UPDATE bonuses SET views = ?, robux = ? WHERE evidence_id = ? AND status IN ('pending_mod','pending_admin')").run(result.views, robuxFor(result.views), ev.id);
      }
      return { ok: true, views: result.views };
    }
    // "Aún no hay datos" (video recién subido): se guarda el motivo pero no suma fallo.
    if (result.retry) {
      db.prepare("UPDATE evidences SET auto_error = ?, auto_checked_at = ? WHERE id = ?").run(String(result.error || "pendiente").slice(0, 200), now, ev.id);
      return { ok: false, error: result.error, retry: true };
    }
    const fails = (ev.auto_fails || 0) + 1;
    const giveUp = fails >= cfg.views.maxFails;
    db.prepare(`UPDATE evidences SET auto_error = ?, auto_checked_at = ?, auto_fails = ?${giveUp ? ", track = 'manual'" : ""}${giveUp && ev.status === "approved" ? ", recount = 1" : ""} WHERE id = ?`)
      .run(String(result.error || "error").slice(0, 200), now, fails, ev.id);
    return { ok: false, error: result.error, gaveUp: giveUp };
  });
}

export function requestRecount(db, discordId, id) {
  const ev = db.prepare("SELECT * FROM evidences WHERE id = ? AND discord_id = ?").get(Number(id), String(discordId));
  if (!ev) throw new Fail("not_found", 404);
  if (ev.status !== "approved") throw new Fail("not_approved");
  db.prepare("UPDATE evidences SET recount = 1 WHERE id = ?").run(ev.id);
  return { ok: true };
}

// ---------- Progreso y reclamos ----------
function progress(db, discordId, type, key) {
  const col = type === "week" ? "week" : "month";
  const r = db.prepare(`SELECT COALESCE(SUM(views), 0) AS views, COUNT(*) AS videos FROM evidences WHERE discord_id = ? AND status = 'approved' AND ${col} = ?`)
    .get(String(discordId), key);
  const pending = db.prepare(`SELECT COUNT(*) AS n FROM evidences WHERE discord_id = ? AND status = 'pending' AND ${col} = ?`).get(String(discordId), key).n;
  return { views: r.views, videos: r.videos, pending };
}

function periodInfo(db, cfg, discordId, type, key, now) {
  const p = progress(db, discordId, type, key);
  const endMs = type === "week" ? weekStartMs(Number(key) + 1) : monthStartMs(nextMonth(key));
  const startMs = type === "week" ? weekStartMs(Number(key)) : monthStartMs(key);
  const grace = (type === "week" ? cfg.creators.claimGraceDaysWeek : cfg.creators.claimGraceDaysMonth) * 86400_000;
  const claim = db.prepare("SELECT pack, views, videos, created_at AS createdAt FROM claims WHERE discord_id = ? AND period_type = ? AND period_key = ?")
    .get(String(discordId), type, String(key)) || null;
  const best = bestPack(type, p.views, p.videos);
  return {
    type, key: String(key), label: type === "week" ? weekLabel(Number(key)) : key,
    startsAt: startMs, endsAt: endMs, claimUntil: endMs + grace,
    open: now < endMs + grace, current: now < endMs,
    ...p, best: best?.key || null, claim,
  };
}

export function creatorState(db, cfg, discordId, now = Date.now()) {
  const w = weekOf(now);
  const m = monthOf(now);
  const link = getCreator(db, discordId);
  const evidences = db.prepare(`
    SELECT e.*, b.status AS bonus_status, b.robux AS bonus_robux FROM evidences e
    LEFT JOIN bonuses b ON b.evidence_id = e.id
    WHERE e.discord_id = ? ORDER BY e.published_on DESC, e.id DESC LIMIT 60`).all(String(discordId));
  const monthNow = periodInfo(db, cfg, discordId, "month", m, now);
  const monthPrev = periodInfo(db, cfg, discordId, "month", prevMonth(m), now);
  const specials = db.prepare("SELECT * FROM specials WHERE discord_id = ? ORDER BY id DESC LIMIT 12").all(String(discordId));
  const specialMonth = [monthNow, monthPrev].find((p) => p.open && p.views >= SPECIAL.monthlyViews && !specials.some((s) => s.month === p.key));
  return {
    link: link ? {
      status: link.link_status, note: link.link_note,
      roblox: link.roblox_user_id ? { userId: link.roblox_user_id, name: link.roblox_name, displayName: link.roblox_display } : null,
    } : { status: "none" },
    week: { current: periodInfo(db, cfg, discordId, "week", w, now), previous: periodInfo(db, cfg, discordId, "week", w - 1, now) },
    month: { current: monthNow, previous: monthPrev },
    evidences: evidences.map((e) => ({
      id: e.id, kind: e.kind, platform: e.platform, url: e.url, title: e.title, publishedOn: e.published_on,
      week: e.week, month: e.month, file: e.file, note: e.note, status: e.status, views: e.views, recount: !!e.recount,
      reviewNote: e.review_note, reviewedAt: e.reviewed_at, robuxEligible: robuxFor(e.views),
      track: e.track, autoViews: e.auto_views, autoCheckedAt: e.auto_checked_at, autoError: e.auto_error,
      trackUntil: e.track_until, autoMeta: e.auto_meta ? JSON.parse(e.auto_meta) : null,
      bonus: e.bonus_status ? { status: e.bonus_status, robux: e.bonus_robux } : null,
    })),
    claims: db.prepare("SELECT period_type AS type, period_key AS key, pack, views, videos, created_at AS createdAt FROM claims WHERE discord_id = ? ORDER BY id DESC LIMIT 20").all(String(discordId)),
    bonuses: db.prepare("SELECT id, evidence_id AS evidenceId, views, robux, status, created_at AS createdAt, note FROM bonuses WHERE discord_id = ? ORDER BY id DESC LIMIT 30").all(String(discordId)),
    specials: specials.map((s) => ({ id: s.id, month: s.month, views: s.views, request: s.request, status: s.status, note: s.review_note })),
    specialAvailable: specialMonth ? { month: specialMonth.key, views: specialMonth.views } : null,
    // Rango automático: el actual, las vistas de la semana y si esta semana ya hay video.
    rank: link && link.link_status === "approved" ? {
      tier: tierOf(link),
      changedAt: link.tier_changed_at,
      weekViews: Math.max(0, db.prepare("SELECT COALESCE(SUM(views),0) AS v FROM evidences WHERE discord_id = ? AND status = 'approved' AND week = ?").get(String(discordId), w).v),
      weekVideos: db.prepare("SELECT COUNT(*) AS n FROM evidences WHERE discord_id = ? AND status != 'rejected' AND week = ?").get(String(discordId), w).n,
      weekEndsAt: weekStartMs(w + 1),
      warned: link.warn_week === w,
      idleWeeks: link.idle_weeks || 0,
    } : null,
    publicProfile: link ? link.public_profile !== 0 : true,
    notices: link?.roblox_user_id ? db.prepare("SELECT kind, param, created_at AS createdAt FROM notices WHERE roblox_user_id = ? ORDER BY id DESC LIMIT 15").all(link.roblox_user_id) : [],
  };
}

export function setPublicProfile(db, discordId, on) {
  const c = getCreator(db, discordId);
  if (!c || c.link_status !== "approved") throw new Fail("link_required");
  db.prepare("UPDATE creators SET public_profile = ? WHERE discord_id = ?").run(on ? 1 : 0, c.discord_id);
  return { ok: true, publicProfile: !!on };
}

export function claimPack(db, cfg, discordId, body, now = Date.now()) {
  const type = body?.period === "month" ? "month" : "week";
  const which = body?.which === "previous" ? "previous" : "current";
  const link = getCreator(db, discordId);
  if (!link || link.link_status !== "approved") throw new Fail("link_required");
  const key = type === "week" ? (which === "current" ? weekOf(now) : weekOf(now) - 1) : which === "current" ? monthOf(now) : prevMonth(monthOf(now));
  const info = periodInfo(db, cfg, discordId, type, key, now);
  if (!info.open) throw new Fail("period_closed");
  if (info.claim) throw new Fail("already_claimed");
  const pack = info.best && PACK_BY_KEY[info.best];
  if (!pack) throw new Fail("no_pack");
  const gamePeriod = type === "week" ? `w${key}` : `m${String(key).replace("-", "")}`;
  return tx(db, () => {
    const rewardId = randomBytes(12).toString("hex");
    db.prepare("INSERT INTO rewards (id, user_id, tier, source, day, created_at, kind, pack, period) VALUES (?, ?, 'creator', 'creator', ?, ?, 'creator', ?, ?)")
      .run(rewardId, link.roblox_user_id, todayStr(now), now, pack.key, gamePeriod);
    db.prepare("INSERT INTO claims (discord_id, period_type, period_key, pack, views, videos, reward_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(String(discordId), type, String(key), pack.key, info.views, info.videos, rewardId, now);
    return { ok: true, pack: pack.key, period: info.label, roblox: link.roblox_name };
  });
}

export function requestBonus(db, discordId, evidenceId, now = Date.now()) {
  const ev = db.prepare("SELECT * FROM evidences WHERE id = ? AND discord_id = ?").get(Number(evidenceId), String(discordId));
  if (!ev) throw new Fail("not_found", 404);
  if (ev.status !== "approved") throw new Fail("not_approved");
  const robux = robuxFor(ev.views);
  if (!robux) throw new Fail("not_enough_views");
  if (db.prepare("SELECT 1 FROM bonuses WHERE evidence_id = ?").get(ev.id)) throw new Fail("already_requested");
  db.prepare("INSERT INTO bonuses (evidence_id, discord_id, views, robux, created_at) VALUES (?, ?, ?, ?, ?)").run(ev.id, String(discordId), ev.views, robux, now);
  return { ok: true, robux };
}

export function requestSpecial(db, cfg, discordId, body, now = Date.now()) {
  const st = creatorState(db, cfg, discordId, now);
  if (!st.specialAvailable) throw new Fail("not_eligible");
  const request = textBlock(body?.request, 800);
  if (request.length < 10) throw new Fail("request_short");
  db.prepare("INSERT INTO specials (discord_id, month, views, request, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(String(discordId), st.specialAvailable.month, st.specialAvailable.views, request, now);
  return { ok: true };
}

// ---------- Moderación ----------
const withUser = (db, row, key = "discord_id") => ({ ...row, user: getDiscordUser(db, row[key]) });
const withPlayer = (db, row) => {
  const p = row.roblox_user_id ? db.prepare("SELECT level, first_seen, last_seen FROM players WHERE user_id = ?").get(row.roblox_user_id) : null;
  return { ...row, player: p ? { level: p.level, firstSeen: p.first_seen, lastSeen: p.last_seen } : null };
};

export function modQueue(db, actor) {
  const q = {
    applications: db.prepare("SELECT * FROM applications WHERE status IN ('pending','contacted') ORDER BY id").all()
      .map((a) => withPlayer(db, withUser(db, { ...a, platforms: JSON.parse(a.platforms) }))),
    links: db.prepare("SELECT * FROM creators WHERE link_status = 'pending' ORDER BY link_requested_at").all().map((c) => withPlayer(db, withUser(db, c))),
    evidences: db.prepare("SELECT * FROM evidences WHERE status = 'pending' OR (status = 'approved' AND recount = 1) ORDER BY created_at").all()
      .map((e) => withUser(db, { ...e, auto_meta: e.auto_meta ? JSON.parse(e.auto_meta) : null })),
    bonuses: db.prepare(`SELECT b.*, e.url, e.title, e.platform, e.published_on FROM bonuses b JOIN evidences e ON e.id = b.evidence_id
      WHERE b.status IN (${actor.role === "admin" ? "'pending_mod','pending_admin','approved'" : "'pending_mod'"}) ORDER BY b.id`).all().map((b) => withUser(db, b)),
    specials: actor.role === "admin" ? db.prepare("SELECT * FROM specials WHERE status IN ('pending','approved') ORDER BY id").all().map((s) => withUser(db, s)) : [],
  };
  return q;
}

export function modApplications(db, status = "all") {
  const rows = status === "all"
    ? db.prepare("SELECT * FROM applications ORDER BY id DESC LIMIT 100").all()
    : db.prepare("SELECT * FROM applications WHERE status = ? ORDER BY id DESC LIMIT 100").all(status);
  return rows.map((a) => withUser(db, { ...a, platforms: JSON.parse(a.platforms) }));
}

const note = (b) => textBlock(b?.note, 500) || null;

export function reviewApplication(db, actor, body, now = Date.now()) {
  const a = db.prepare("SELECT * FROM applications WHERE id = ?").get(Number(body?.id));
  if (!a) throw new Fail("not_found", 404);
  if (a.discord_id === String(actor.id)) throw new Fail("own_item", 403);
  const action = body?.action;
  const status = { approve: "approved", reject: "rejected", contacted: "contacted" }[action];
  if (!status) throw new Fail("bad_action");
  if (a.status === "approved" || a.status === "rejected") throw new Fail("already_reviewed");
  return tx(db, () => {
    db.prepare("UPDATE applications SET status = ?, reviewed_by = ?, reviewed_at = ?, review_note = ? WHERE id = ?")
      .run(status, actor.name, now, note(body), a.id);
    // Al aprobar, el moderador también confirma que esa es su cuenta de Roblox.
    let linked = false;
    if (status === "approved" && a.roblox_user_id) {
      const taken = db.prepare("SELECT 1 FROM creators WHERE roblox_user_id = ? AND link_status = 'approved' AND discord_id != ?").get(a.roblox_user_id, a.discord_id);
      const p = db.prepare("SELECT name, display_name FROM players WHERE user_id = ?").get(a.roblox_user_id);
      if (!taken && p) {
        approveLink(db, actor, a.discord_id, a.roblox_user_id, p.name, p.display_name, now);
        linked = true;
      }
    }
    // Rechazada: no puede quedar con el rango de creador en el juego (p. ej. un creador antiguo).
    if (status === "rejected" && a.roblox_user_id) {
      const approved = db.prepare("SELECT 1 FROM creators WHERE roblox_user_id = ? AND link_status = 'approved'").get(a.roblox_user_id);
      const p = db.prepare("SELECT creator_tier FROM players WHERE user_id = ?").get(a.roblox_user_id);
      if (!approved && (p?.creator_tier == null || p.creator_tier > 0)) {
        queueTierSet(db, a.roblox_user_id, "None", now);
        if (p?.creator_tier > 0) queueNotice(db, { robloxUserId: a.roblox_user_id, discordId: a.discord_id, kind: "rejected", param: "", actor: actor.name }, now);
      }
    }
    audit(db, actor, `application.${action}`, nameOf(db, a.discord_id), { id: a.id, roblox: `${a.roblox_name}${a.roblox_user_id ? ` (${a.roblox_user_id})` : ""}`, vinculada: linked || null, note: note(body) });
    return { ok: true, status, linked };
  });
}

// Un moderador corrige los datos de una solicitud (en cualquier estado): redes, video de ejemplo y correo.
// Sirve para quitar redes repetidas o cambiar un video suelto por el enlace del canal. Queda en el registro.
export function editApplication(db, actor, body, now = Date.now()) {
  const a = db.prepare("SELECT * FROM applications WHERE id = ?").get(Number(body?.id));
  if (!a) throw new Fail("not_found", 404);
  if (a.discord_id === String(actor.id)) throw new Fail("own_item", 403);
  const platforms = cleanPlatforms(body?.platforms);
  if (!platforms.length) throw new Fail("need_platform");
  const email = str(body?.email, 120);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Fail("bad_email");
  const rawSample = str(body?.sampleUrl, 400);
  const sampleUrl = httpUrl(rawSample);
  if (rawSample && !sampleUrl) throw new Fail("bad_url");
  const before = { platforms: JSON.parse(a.platforms), sample: a.sample_url || "", email: a.email || "" };
  const changes = {};
  const short = (list) => list.map((p) => `${p.type} ${p.url}${p.followers ? ` (${p.followers})` : ""}`).join(" | ");
  if (JSON.stringify(before.platforms) !== JSON.stringify(platforms)) changes.redes = `${short(before.platforms)} → ${short(platforms)}`;
  if (before.sample !== (sampleUrl || "")) changes.video = `${before.sample || "—"} → ${sampleUrl || "—"}`;
  if (before.email !== (email || "")) changes.correo = `${before.email || "—"} → ${email || "—"}`;
  if (!Object.keys(changes).length) throw new Fail("no_changes");
  db.prepare("UPDATE applications SET platforms = ?, sample_url = ?, email = ?, edited_by = ?, edited_at = ? WHERE id = ?")
    .run(JSON.stringify(platforms), sampleUrl || null, email || null, actor.name, now, a.id);
  audit(db, actor, "application.edit", nameOf(db, a.discord_id), { id: a.id, ...changes, note: note(body) });
  return { ok: true, platforms, sampleUrl: sampleUrl || null, email: email || null };
}

// Confirma la cuenta de Roblox. Si es nuevo en el programa (solicitud aprobada) entra en el rango
// más bajo (Creator) en el juego y en la página, con un correo de bienvenida al buzón.
// Si ya tenía rango (p. ej. se vuelve a confirmar su cuenta), lo conserva.
function approveLink(db, actor, discordId, userId, name, display, now, isNew = true) {
  const prev = getCreator(db, discordId);
  db.prepare(`
    INSERT INTO creators (discord_id, roblox_user_id, roblox_name, roblox_display, link_status, link_requested_at, link_reviewed_by, link_reviewed_at)
    VALUES (?, ?, ?, ?, 'approved', ?, ?, ?)
    ON CONFLICT(discord_id) DO UPDATE SET roblox_user_id = excluded.roblox_user_id, roblox_name = excluded.roblox_name,
      roblox_display = excluded.roblox_display, link_status = 'approved', link_code = NULL,
      link_reviewed_by = excluded.link_reviewed_by, link_reviewed_at = excluded.link_reviewed_at, link_note = NULL
  `).run(String(discordId), userId, name, display, now, actor.name, now);
  syncAccount(db, discordId, userId, now);
  const keepTier = !isNew && prev?.tier && prev.tier !== "None";
  const tier = keepTier ? tierOf(prev) : "Creator";
  db.prepare("UPDATE creators SET tier = ?, tier_changed_at = ?, warn_week = NULL WHERE discord_id = ?").run(tier, now, String(discordId));
  queueTierSet(db, userId, tier, now);
  if (isNew) queueNotice(db, { robloxUserId: userId, discordId: String(discordId), kind: "welcome", param: "Creator", actor: actor.name }, now);
  // Si era un creador antiguo, queda aprobado.
  db.prepare("UPDATE legacy_creators SET status = 'approved', updated_at = ? WHERE roblox_user_id = ?").run(now, userId);
}

export function reviewLink(db, actor, body, now = Date.now()) {
  const c = getCreator(db, body?.discordId);
  if (!c || c.link_status !== "pending") throw new Fail("not_found", 404);
  if (c.discord_id === String(actor.id)) throw new Fail("own_item", 403);
  const action = body?.action;
  if (action !== "approve" && action !== "reject") throw new Fail("bad_action");
  return tx(db, () => {
    if (action === "approve") {
      const taken = db.prepare("SELECT 1 FROM creators WHERE roblox_user_id = ? AND link_status = 'approved' AND discord_id != ?").get(c.roblox_user_id, c.discord_id);
      if (taken) throw new Fail("roblox_taken");
      const before = db.prepare("SELECT tier, link_reviewed_at FROM creators WHERE discord_id = ?").get(c.discord_id);
      // Ya era creador (tenía rango) → cambio de cuenta; si no, entra nuevo.
      approveLink(db, actor, c.discord_id, c.roblox_user_id, c.roblox_name, c.roblox_display, now, !(before?.tier && before.tier !== "None"));
      db.prepare("UPDATE creators SET link_note = ? WHERE discord_id = ?").run(note(body), c.discord_id);
    } else {
      db.prepare("UPDATE creators SET link_status = 'rejected', link_reviewed_by = ?, link_reviewed_at = ?, link_note = ? WHERE discord_id = ?")
        .run(actor.name, now, note(body), c.discord_id);
    }
    audit(db, actor, `link.${action}`, nameOf(db, c.discord_id), { roblox: `${c.roblox_name} (${c.roblox_user_id})`, note: note(body) });
    return { ok: true };
  });
}

export function reviewEvidence(db, actor, body, now = Date.now()) {
  const ev = db.prepare("SELECT * FROM evidences WHERE id = ?").get(Number(body?.id));
  if (!ev) throw new Fail("not_found", 404);
  if (ev.discord_id === String(actor.id)) throw new Fail("own_item", 403);
  const action = body?.action;
  if (!["approve", "reject", "update"].includes(action)) throw new Fail("bad_action");
  // mode "auto": usar las vistas leídas y seguir refrescándolas; "fixed": vistas fijas del moderador.
  const auto = body?.mode === "auto" && action !== "reject";
  if (auto && !(ev.track === "auto" || trackableSite(ev.url)) ) throw new Fail("not_trackable");
  if (auto && ev.auto_views == null) throw new Fail("no_auto_views");
  const views = auto ? ev.auto_views : Math.floor(Number(body?.views));
  if (action !== "reject" && !(Number.isFinite(views) && views >= 0 && views <= 1e9)) throw new Fail("bad_views");
  if (action === "update" && ev.status !== "approved") throw new Fail("not_approved");
  if (action !== "update" && ev.status !== "pending") throw new Fail("already_reviewed");
  return tx(db, () => {
    if (action === "reject") {
      db.prepare("UPDATE evidences SET status = 'rejected', reviewed_by = ?, reviewed_at = ?, review_note = ?, recount = 0 WHERE id = ?").run(actor.name, now, note(body), ev.id);
    } else {
      db.prepare("UPDATE evidences SET status = 'approved', views = ?, track = ?, auto_fails = CASE WHEN ? = 'auto' THEN 0 ELSE auto_fails END, reviewed_by = ?, reviewed_at = ?, review_note = COALESCE(?, review_note), recount = 0 WHERE id = ?")
        .run(views, auto ? "auto" : "manual", auto ? "auto" : "manual", actor.name, now, note(body), ev.id);
      // Un bono aún sin aprobar sigue a las vistas nuevas.
      db.prepare("UPDATE bonuses SET views = ?, robux = ? WHERE evidence_id = ? AND status IN ('pending_mod','pending_admin')").run(views, robuxFor(views), ev.id);
    }
    audit(db, actor, `evidence.${action}`, nameOf(db, ev.discord_id), { id: ev.id, url: ev.url, before: ev.views, views: action === "reject" ? null : views, vistas: action === "reject" ? null : auto ? "automáticas" : "fijas", note: note(body) });
    return { ok: true };
  });
}

export function reviewBonus(db, actor, body, now = Date.now()) {
  const b = db.prepare("SELECT * FROM bonuses WHERE id = ?").get(Number(body?.id));
  if (!b) throw new Fail("not_found", 404);
  if (b.discord_id === String(actor.id)) throw new Fail("own_item", 403);
  const action = body?.action;
  const isAdmin = actor.role === "admin";
  let set;
  if (action === "reject") {
    if (b.status === "pending_mod" || (isAdmin && (b.status === "pending_admin" || b.status === "approved"))) set = { status: "rejected" };
  } else if (action === "approve" && b.status === "pending_mod") {
    set = { status: "pending_admin", mod_by: actor.name, mod_id: String(actor.id), mod_at: now };
  } else if (action === "approve" && b.status === "pending_admin") {
    if (!isAdmin) throw new Fail("admin_only", 403);
    if (b.mod_id === String(actor.id)) throw new Fail("needs_other_reviewer", 403); // dos personas distintas
    set = { status: "approved", admin_by: actor.name, admin_at: now };
  } else if (action === "paid" && b.status === "approved") {
    if (!isAdmin) throw new Fail("admin_only", 403);
    set = { status: "paid", paid_by: actor.name, paid_at: now };
  }
  if (!set) throw new Fail("bad_action");
  const cols = Object.keys(set);
  db.prepare(`UPDATE bonuses SET ${cols.map((c) => `${c} = ?`).join(", ")}, note = COALESCE(?, note) WHERE id = ?`).run(...cols.map((c) => set[c]), note(body), b.id);
  audit(db, actor, `bonus.${action}`, nameOf(db, b.discord_id), { id: b.id, robux: b.robux, views: b.views, status: set.status, note: note(body) });
  return { ok: true, status: set.status };
}

export function reviewSpecial(db, actor, body, now = Date.now()) {
  if (actor.role !== "admin") throw new Fail("admin_only", 403);
  const s = db.prepare("SELECT * FROM specials WHERE id = ?").get(Number(body?.id));
  if (!s) throw new Fail("not_found", 404);
  const status = { approve: "approved", reject: "rejected", done: "done" }[body?.action];
  if (!status) throw new Fail("bad_action");
  db.prepare("UPDATE specials SET status = ?, reviewed_by = ?, reviewed_at = ?, review_note = COALESCE(?, review_note) WHERE id = ?").run(status, actor.name, now, note(body), s.id);
  audit(db, actor, `special.${body.action}`, nameOf(db, s.discord_id), { id: s.id, month: s.month, note: note(body) });
  return { ok: true, status };
}

export function creatorsOverview(db, now = Date.now()) {
  const w = weekOf(now), m = monthOf(now);
  return db.prepare(`
    SELECT d.id, d.username, d.global_name, d.is_creator, c.roblox_name, c.roblox_user_id, c.link_status,
      (SELECT COALESCE(SUM(views),0) FROM evidences e WHERE e.discord_id = d.id AND e.status = 'approved' AND e.week = ?) AS week_views,
      (SELECT COALESCE(SUM(views),0) FROM evidences e WHERE e.discord_id = d.id AND e.status = 'approved' AND e.month = ?) AS month_views,
      (SELECT COUNT(*) FROM evidences e WHERE e.discord_id = d.id AND e.status = 'approved' AND e.month = ?) AS month_videos,
      (SELECT pack FROM claims cl WHERE cl.discord_id = d.id ORDER BY cl.id DESC LIMIT 1) AS last_pack
    FROM discord_users d LEFT JOIN creators c ON c.discord_id = d.id
    WHERE d.is_creator = 1 OR c.discord_id IS NOT NULL
    ORDER BY month_views DESC LIMIT 200`).all(w, m, m);
}
