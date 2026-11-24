// Lista pública de creadores (carrusel de la página) y panel de información para el staff.
import { weekOf, monthOf, weekStartMs, weekLabel } from "./creators.js";
import { tierOf, legacyList } from "./lifecycle.js";
import { LEVELS, LEVEL_KEYS, levelIndex } from "./program.js";
import { avatars } from "./roblox.js";

const LEVEL_BY_KEY = Object.fromEntries(LEVELS.map((l) => [l.key, l]));
const parse = (s) => { try { return JSON.parse(s); } catch { return []; } };

// Redes de la última solicitud aprobada (o la última enviada) de ese usuario de Discord.
function applicationOf(db, discordId) {
  return db.prepare("SELECT id, platforms, sample_url, email FROM applications WHERE discord_id = ? ORDER BY (status = 'approved') DESC, id DESC LIMIT 1").get(discordId);
}
function platformsOf(db, discordId) {
  const a = applicationOf(db, discordId);
  return a ? parse(a.platforms).filter((p) => p && /^https?:\/\//.test(p.url)) : [];
}

// ---------- Público ----------
let publicCache = { at: 0, body: null };
export async function publicCreators(db, cfg, fetchImpl, now = Date.now()) {
  if (publicCache.body && now - publicCache.at < 10 * 60_000) return publicCache.body;
  const rows = db.prepare(`
    SELECT c.discord_id, c.roblox_user_id, c.roblox_name, c.roblox_display, c.tier
    FROM creators c WHERE c.link_status = 'approved' AND COALESCE(c.tier, 'Creator') != 'None' AND c.public_profile != 0`).all();
  let pics = new Map();
  try { pics = await avatars(rows.map((r) => r.roblox_user_id).slice(0, 100), { fetchImpl, timeoutMs: cfg.robloxTimeoutMs }); } catch { /* sin fotos */ }
  const creators = rows.map((r) => {
    const tier = tierOf(r);
    const lv = LEVEL_BY_KEY[tier] || LEVELS[0];
    return {
      name: r.roblox_display || r.roblox_name,
      username: r.roblox_name,
      userId: r.roblox_user_id,
      avatar: pics.get(r.roblox_user_id) || null,
      tier, tierName: lv.name, tierEmoji: lv.emoji, tierColor: lv.color,
      // Solo red, enlace y seguidores (lo que el creador puso como público en su solicitud).
      platforms: platformsOf(db, r.discord_id).map((p) => ({ type: p.type, url: p.url, followers: p.followers || 0 })),
    };
  }).sort((a, b) => levelIndex(b.tier) - levelIndex(a.tier) || a.name.localeCompare(b.name));
  publicCache = { at: now, body: { creators, updatedAt: now } };
  return publicCache.body;
}
export function clearPublicCache() { publicCache = { at: 0, body: null }; }

// ---------- Staff ----------
const sumViews = (db, discordId, col, key) =>
  db.prepare(`SELECT COALESCE(SUM(views),0) AS v, COUNT(*) AS n FROM evidences WHERE discord_id = ? AND status = 'approved' AND ${col} = ?`).get(discordId, key);

export function creatorsDashboard(db, cfg, now = Date.now()) {
  const w = weekOf(now), m = monthOf(now);
  const rows = db.prepare(`
    SELECT c.*, d.username, d.global_name, d.avatar AS d_avatar, d.is_creator, p.level, p.last_seen, p.first_seen, p.creator_tier
    FROM creators c
    LEFT JOIN discord_users d ON d.id = c.discord_id
    LEFT JOIN players p ON p.user_id = c.roblox_user_id
    ORDER BY c.link_status = 'approved' DESC, c.roblox_name`).all();
  const creators = rows.map((c) => {
    const id = c.discord_id;
    const wk = sumViews(db, id, "week", w), pw = sumViews(db, id, "week", w - 1), mo = sumViews(db, id, "month", m);
    const total = db.prepare("SELECT COALESCE(SUM(views),0) AS v, COUNT(*) AS n FROM evidences WHERE discord_id = ? AND status = 'approved'").get(id);
    const last = db.prepare("SELECT MAX(published_on) AS d FROM evidences WHERE discord_id = ? AND status != 'rejected'").get(id).d;
    const pending = db.prepare("SELECT COUNT(*) AS n FROM evidences WHERE discord_id = ? AND status = 'pending'").get(id).n;
    const weekVideos = db.prepare("SELECT COUNT(*) AS n FROM evidences WHERE discord_id = ? AND status != 'rejected' AND week = ?").get(id, w).n;
    const robux = db.prepare("SELECT COALESCE(SUM(CASE WHEN status = 'paid' THEN robux END),0) AS paid, COALESCE(SUM(CASE WHEN status IN ('pending_mod','pending_admin','approved') THEN robux END),0) AS open FROM bonuses WHERE discord_id = ?").get(id);
    const claims = db.prepare("SELECT COUNT(*) AS n, (SELECT pack FROM claims WHERE discord_id = ? ORDER BY id DESC LIMIT 1) AS last FROM claims WHERE discord_id = ?").get(id, id);
    const tier = c.link_status === "approved" ? tierOf(c) : null;
    const next = tier && tier !== "None" ? LEVELS[levelIndex(tier)] : null; // siguiente rango
    return {
      discordId: id, discord: c.global_name ? `${c.global_name} (@${c.username})` : c.username ? `@${c.username}` : `#${id}`,
      discordAvatar: c.d_avatar && /^[a-f0-9_]+$/i.test(c.d_avatar) ? `https://cdn.discordapp.com/avatars/${id}/${c.d_avatar}.png?size=64` : null,
      roblox: c.roblox_user_id ? { userId: c.roblox_user_id, name: c.roblox_name, displayName: c.roblox_display } : null,
      linkStatus: c.link_status, tier, gameTier: c.creator_tier == null ? null : LEVEL_KEYS[c.creator_tier - 1] || "None",
      tierChangedAt: c.tier_changed_at, publicProfile: c.public_profile !== 0,
      level: c.level, lastSeen: c.last_seen, firstSeen: c.first_seen,
      platforms: platformsOf(db, id),
      application: (() => { const a = applicationOf(db, id); return a ? { id: a.id, sampleUrl: a.sample_url, email: a.email } : null; })(),
      weekViews: wk.v, weekVideos, prevWeekViews: pw.v, monthViews: mo.v, monthVideos: mo.n,
      totalViews: total.v, totalVideos: total.n, lastVideo: last, pendingEvidences: pending,
      robuxPaid: robux.paid, robuxOpen: robux.open, claims: claims.n, lastPack: claims.last,
      warned: c.warn_week === w, idleWeeks: c.idle_weeks || 0,
      atRisk: Boolean(tier && tier !== "None" && weekVideos === 0 && (levelIndex(tier) > 1 || (c.idle_weeks || 0) >= 1)),
      next: next ? { key: next.key, name: next.name, minWeekViews: next.minWeekViews, missing: Math.max(0, next.minWeekViews - wk.v) } : null,
    };
  });
  const approved = creators.filter((c) => c.linkStatus === "approved" && c.tier !== "None");
  // Serie de 8 semanas: vistas aprobadas y videos de todos los creadores.
  const weeks = [];
  for (let i = 7; i >= 0; i--) {
    const k = w - i;
    const r = db.prepare("SELECT COALESCE(SUM(views),0) AS v, COUNT(*) AS n, COUNT(DISTINCT discord_id) AS c FROM evidences WHERE status = 'approved' AND week = ?").get(k);
    weeks.push({ week: k, label: weekLabel(k), views: r.v, videos: r.n, creators: r.c, startsAt: weekStartMs(k) });
  }
  const platforms = db.prepare("SELECT platform, COUNT(*) AS videos, COALESCE(SUM(views),0) AS views FROM evidences WHERE status = 'approved' AND month = ? GROUP BY platform ORDER BY views DESC").all(m);
  const byTier = Object.fromEntries(LEVEL_KEYS.map((k) => [k, approved.filter((c) => c.tier === k).length]));
  const legacy = legacyList(db);
  return {
    now, week: { key: w, label: weekLabel(w), endsAt: weekStartMs(w + 1) }, month: m,
    summary: {
      creators: approved.length, byTier,
      weekViews: approved.reduce((s, c) => s + c.weekViews, 0),
      monthViews: approved.reduce((s, c) => s + c.monthViews, 0),
      weekVideos: approved.reduce((s, c) => s + c.weekVideos, 0),
      atRisk: approved.filter((c) => c.atRisk).length,
      pendingEvidences: creators.reduce((s, c) => s + c.pendingEvidences, 0),
      robuxPaid: creators.reduce((s, c) => s + c.robuxPaid, 0),
      legacy: { total: legacy.length, notified: legacy.filter((l) => l.status === "notified").length, applied: legacy.filter((l) => l.status === "applied").length, removed: legacy.filter((l) => l.status === "removed").length },
      legacyDeadline: cfg.creators.legacyDeadline,
    },
    weeks, platforms, creators,
  };
}

// Detalle de un creador: evidencias, historial semanal y avisos.
export function creatorDetail(db, discordId, now = Date.now()) {
  const c = db.prepare("SELECT * FROM creators WHERE discord_id = ?").get(String(discordId));
  if (!c) return null;
  const w = weekOf(now);
  const history = [];
  for (let i = 7; i >= 0; i--) {
    const r = db.prepare("SELECT COALESCE(SUM(CASE WHEN status = 'approved' THEN views END),0) AS v, SUM(status != 'rejected') AS n FROM evidences WHERE discord_id = ? AND week = ?").get(c.discord_id, w - i);
    history.push({ week: w - i, label: weekLabel(w - i), views: r.v, videos: r.n || 0 });
  }
  return {
    history,
    evidences: db.prepare("SELECT id, kind, platform, url, title, published_on AS publishedOn, status, views, track FROM evidences WHERE discord_id = ? ORDER BY published_on DESC, id DESC LIMIT 40").all(c.discord_id),
    claims: db.prepare("SELECT period_type AS type, period_key AS key, pack, views, created_at AS createdAt FROM claims WHERE discord_id = ? ORDER BY id DESC LIMIT 20").all(c.discord_id),
    notices: c.roblox_user_id ? db.prepare(`SELECT n.kind, n.param, n.actor, n.created_at AS createdAt, r.status AS delivery, r.delivered_at AS deliveredAt
      FROM notices n LEFT JOIN rewards r ON r.id = n.reward_id WHERE n.roblox_user_id = ? ORDER BY n.id DESC LIMIT 30`).all(c.roblox_user_id) : [],
  };
}

// ---------- Staff público (/staff/): quién es, su rango y si está conectado ----------
// Avatar, nombres de Roblox y rango; "en línea" si el juego lo vio en los últimos 3 min. joinUrl abre
// el juego en su servidor (solo si está en línea y conocemos el servidor). Nada de Discord ni horas.
let staffCache = { at: 0, body: null, pics: new Map(), picsAt: 0 };
const PLACE_ID = 77372347150746;
export async function publicStaff(db, cfg, fetchImpl, now = Date.now()) {
  if (staffCache.body && now - staffCache.at < 60_000) return staffCache.body;
  const rows = db.prepare(`SELECT s.roblox_user_id, s.roblox_name, s.roblox_display, s.rank, p.last_seen, p.job_id
    FROM staff s LEFT JOIN players p ON p.user_id = s.roblox_user_id
    WHERE s.link_status = 'approved' AND s.rank != 'None' AND s.public_profile != 0 AND s.roblox_user_id IS NOT NULL`).all();
  if (now - staffCache.picsAt > 30 * 60_000) {
    try { staffCache.pics = await avatars(rows.map((r) => r.roblox_user_id).slice(0, 100), { fetchImpl, timeoutMs: cfg.robloxTimeoutMs }); staffCache.picsAt = now; } catch { /* sin fotos */ }
  }
  const ORDER = { Moderator: 3, ModeratorJr: 2, Helper: 1 };
  const staff = rows.map((r) => {
    const online = Boolean(r.last_seen && now - r.last_seen < 3 * 60_000);
    const job = online && r.job_id && /^[A-Za-z0-9-]{8,64}$/.test(r.job_id) ? r.job_id : null;
    const ago = r.last_seen ? now - r.last_seen : null;
    return {
      name: r.roblox_display || r.roblox_name, username: r.roblox_name, userId: r.roblox_user_id,
      avatar: staffCache.pics.get(r.roblox_user_id) || null, rank: r.rank, online,
      // Aproximado a propósito: "hoy", "esta semana"…
      seen: online ? "now" : ago == null ? null : ago < 86_400_000 ? "today" : ago < 7 * 86_400_000 ? "week" : "older",
      joinUrl: job ? `https://www.roblox.com/games/start?placeId=${PLACE_ID}&gameInstanceId=${encodeURIComponent(job)}` : null,
    };
  }).sort((a, b) => Number(b.online) - Number(a.online) || ORDER[b.rank] - ORDER[a.rank] || a.name.localeCompare(b.name));
  staffCache = { ...staffCache, at: now, body: { staff, online: staff.filter((x) => x.online).length, updatedAt: now } };
  return staffCache.body;
}
