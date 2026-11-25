// Anuncios al canal de Discord del staff (2026-11-24). El bot escribe en cfg.discord.announceChannel y
// menciona al rango que le toca solo cuando hace falta. Cada aviso se activa o desactiva y elige a quién
// mencionar en Ajustes del staff. Si el mismo aviso ya mencionó hace poco (mentionEveryMinutes), sale
// sin mención para no saturar. Sin bot, cae al webhook de moderación (sin menciones). Nunca lanza.
import { getStaffSettings, ANNOUNCE_EVENTS } from "./staffSettings.js";
import { notifyMods, botEnabled } from "./discord.js";

const API = "https://discord.com/api/v10";

export function roleIdsFor(cfg, ranks) {
  const map = { ...cfg.discord.staffRoles, Admin: cfg.discord.roles.admin, Creator: cfg.discord.roles.creator };
  return [...new Set(ranks.map((r) => map[r]).filter((id) => /^\d{5,25}$/.test(String(id || ""))))];
}

function readState(db) {
  try { return JSON.parse(db.prepare("SELECT value FROM settings WHERE key = 'announce_state'").get()?.value || "{}"); } catch { return {}; }
}
function writeState(db, st, now) {
  db.prepare(`INSERT INTO settings (key, value, updated_by, updated_at) VALUES ('announce_state', ?, 'sistema', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).run(JSON.stringify(st), now);
}

// event: clave de ANNOUNCE_EVENTS. text: mensaje (sin menciones). auto: rangos para los avisos con
// mention ["auto"] (p. ej. el rango superior a quien pide algo). users: IDs de Discord a mencionar.
export async function announce(db, cfg, event, { text, auto = [], users = [], embeds, components }, fetchImpl = fetch, now = Date.now()) {
  try {
    const settings = getStaffSettings(db, cfg);
    const ev = settings.announce.events[event];
    if (!ANNOUNCE_EVENTS[event] || !settings.announce.enabled || !ev?.on) return { sent: false, reason: "off" };
    const ranks = ev.mention.flatMap((m) => (m === "auto" ? auto : [m]));
    let roles = roleIdsFor(cfg, ranks);
    const st = readState(db);
    const gap = settings.announce.mentionEveryMinutes * 60_000;
    if (roles.length && st[event] && now - st[event] < gap) roles = [];
    const okUsers = users.filter((u) => /^\d{5,25}$/.test(String(u)));
    const content = `${roles.map((r) => `<@&${r}>`).join(" ")} ${String(text).slice(0, 1700)}`.trim();
    if (!botEnabled(cfg) || !/^\d{5,25}$/.test(String(cfg.discord.announceChannel || ""))) {
      notifyMods(cfg, text, fetchImpl);
      return { sent: false, reason: "no_bot" };
    }
    const r = await fetchImpl(`${API}/channels/${cfg.discord.announceChannel}/messages`, {
      method: "POST",
      headers: { Authorization: `Bot ${cfg.discord.botToken}`, "content-type": "application/json" },
      body: JSON.stringify({ content, allowed_mentions: { parse: [], roles, users: okUsers }, ...(embeds ? { embeds } : {}), ...(components ? { components } : {}) }),
    });
    if (!r.ok) return { sent: false, reason: `http_${r.status}` };
    const msg = await r.json().catch(() => ({}));
    if (roles.length) { st[event] = now; writeState(db, st, now); }
    return { sent: true, mentioned: roles.length > 0, messageId: msg?.id || null };
  } catch (e) {
    return { sent: false, reason: e.message };
  }
}

// Rango que revisa algo de un miembro: el siguiente hacia arriba (un Moderator lo revisa el Admin).
export const reviewerRanks = (rank) => (rank === "Helper" ? ["ModeratorJr", "Moderator"] : rank === "ModeratorJr" ? ["Moderator"] : ["Admin"]);

// Aviso que sale una sola vez (marca en settings.announce_once).
export async function announceOnce(db, cfg, key, event, payload, fetchImpl = fetch, now = Date.now()) {
  let done = {};
  try { done = JSON.parse(db.prepare("SELECT value FROM settings WHERE key = 'announce_once'").get()?.value || "{}"); } catch { done = {}; }
  if (done[key]) return { sent: false, reason: "done" };
  const r = await announce(db, cfg, event, payload, fetchImpl, now);
  if (r.sent || r.reason === "off") {
    done[key] = now;
    db.prepare(`INSERT INTO settings (key, value, updated_by, updated_at) VALUES ('announce_once', ?, 'sistema', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).run(JSON.stringify(done), now);
  }
  return r;
}
