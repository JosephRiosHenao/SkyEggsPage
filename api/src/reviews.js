// Tarjetas de revisión en el canal del staff (2026-11-24).
// Cada solicitud, evidencia o excusa que necesita a alguien del staff se publica como un mensaje con
// embed (quién, qué, contexto y quién la puede resolver), menciones al rango que le toca y botones:
//   fila 1 (enlaces): 🧭 Abrir en el panel · enlace del caso (prueba, video, perfil de Roblox)
//   fila 2 (acciones): ✅ Aprobar · ❌ Rechazar · 👀 Lo reviso yo / Liberar · 🔎 Ver detalles
// Aprobar y Rechazar abren un formulario (nota, cantidad o vistas) y usan la MISMA lógica que el panel,
// con las mismas reglas de quién puede resolver cada tipo. Al resolverse (en Discord o en el panel) el
// mensaje se EDITA solo: color, «Aprobado por …», cuándo y cuánto tardó, y sin botones de acción.
// sweepReviews cierra las tarjetas cuyo caso ya no está pendiente (retirado o resuelto por otro camino).
import { announce, reviewerRanks } from "./announce.js";
import { editMessage, interactionsEnabled, linkButton, actionButton, row, ephemeral, safe, short, REPLY } from "./bot.js";
import { botEnabled } from "./discord.js";
import { withStaffRoles, actorRankIdx, taskProgress } from "./staff.js";
import { getDiscordUser } from "./creators.js";
import { TASK_BY_KEY, QUESTIONS, rankIndex } from "./staffProgram.js";
import { getStaffSettings } from "./staffSettings.js";
import { avatars } from "./roblox.js";
import { youtubeId } from "./views.js";

// Texto de campos: deja los enlaces markdown, solo neutraliza menciones masivas.
const clean = (v, max) => String(v ?? "").replace(/@(everyone|here)/gi, "@​$1").slice(0, max);
// Texto del usuario como cita (cada línea con «> »).
const quote = (v, max) => { const t = safe(v, max).trim(); return t ? t.split("\n").map((l) => `> ${l}`).join("\n") : ""; };
const ts = (ms, style = "R") => `<t:${Math.floor(ms / 1000)}:${style}>`;

const RN = { Helper: "Helper", ModeratorJr: "Moderator Jr", Moderator: "Moderator" };
const PANEL = (cfg) => `${cfg.siteUrl}/creadores/panel/`;
const LINK = (label, url) => `[${label}](${url})`;
const PROFILE = (uid) => `https://www.roblox.com/users/${uid}/profile`;
const ROBLOX = (name, uid) => (uid ? LINK(`@${name}`, PROFILE(uid)) : `@${name || "—"}`);
const PLATFORM_EMOJI = { YouTube: "📺", TikTok: "🎵", Twitch: "🟣", Kick: "🟩", Instagram: "📸", Facebook: "📘" };
const QUESTION_LABEL = Object.fromEntries(QUESTIONS.map((q) => [q.key, q.label]));

function person(db, discordId) {
  const u = getDiscordUser(db, discordId);
  const name = u ? (u.globalName ? `${u.globalName} (@${u.username})` : `@${u.username}`) : `#${discordId}`;
  return { id: String(discordId), name, icon: u?.avatar || null };
}
function player(db, uid) {
  return uid ? db.prepare("SELECT * FROM players WHERE user_id = ?").get(Number(uid)) || null : null;
}
const lastSeen = (p) => (p?.played && p.last_seen ? ts(p.last_seen) : "Nunca entró al juego");
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
function duration(ms) {
  const min = Math.max(1, Math.round(ms / 60000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), d = Math.floor(h / 24);
  return d >= 1 ? `${d} d ${h % 24} h` : `${h} h ${min % 60} min`;
}

// ---------- Quién puede resolver cada tipo (mismas reglas que staff.js / creators.js) ----------
const ABOVE = { Helper: "Moderator Jr, Moderator o Admin", ModeratorJr: "Moderator o Admin", Moderator: "Solo el Admin" };
export function resolverLabel(kind, p) {
  if (kind === "staff_evidence" || kind === "staff_excuse") return ABOVE[p.ownerRank] || "Solo el Admin";
  if (kind === "staff_link") return p.ownerRank === "Moderator" ? "Solo el Admin" : "Moderator o Admin";
  return "Moderator o Admin";
}
// Devuelve null si puede, o el motivo: own_item | forbidden | no_staff.
export function canResolve(kind, p, actor) {
  if (!actor || !actor.role) return "no_staff";
  if (p.owner && String(p.owner) === String(actor.id)) return "own_item";
  const idx = actorRankIdx(actor);
  let ok = false;
  if (kind === "staff_evidence" || kind === "staff_excuse") ok = idx > rankIndex(p.ownerRank);
  else if (kind === "staff_link") ok = actor.role === "admin" || (p.ownerRank !== "Moderator" && idx >= 3);
  else if (kind === "staff_application") ok = idx >= 3;
  else ok = actor.role === "admin" || actor.role === "moderator"; // creadores: moderadores y Admin
  return ok ? null : "forbidden";
}

// Actor a partir de quien tocó el botón (igual que staffActor del panel: Roblox vinculado obligatorio).
export function discordActor(db, cfg, discordId) {
  const u = withStaffRoles(db, cfg, getDiscordUser(db, discordId));
  if (!u) return { error: "Entra una vez al panel con Discord para poder revisar desde aquí." };
  if (!u.roblox) return { error: "Vincula tu cuenta de Roblox en el panel para poder revisar." };
  const r = u.roles;
  const role = r.admin ? "admin" : r.moderator ? "moderator" : r.modjr ? "modjr" : r.helper ? "helper" : null;
  return { id: String(u.id), name: u.globalName ? `${u.globalName} (@${u.username})` : `@${u.username}`, role, staffRank: r.staffRank };
}

// ---------- Tipos ----------
// build(db, cfg, ref) → { summary, p } (p se guarda como JSON para redibujar la tarjeta) o null.
// state(db, ref) → { status: pending|contacted|approved|rejected|gone, by, note } para el barrido.
// refKey: campo del cuerpo que espera la revisión del panel. form: campos extra al aprobar.
const byId = (table) => (db, ref) => {
  const r = db.prepare(`SELECT status, reviewed_by, review_note FROM ${table} WHERE id = ?`).get(Number(ref));
  return r ? { status: r.status, by: r.reviewed_by, note: r.review_note } : { status: "gone" };
};

const KINDS = {
  staff_evidence: {
    event: "staff_evidence", refKey: "id", state: byId("staff_evidence"),
    build(db, cfg, ref) {
      const e = db.prepare("SELECT e.*, s.rank, s.roblox_name, s.roblox_user_id FROM staff_evidence e JOIN staff s ON s.discord_id = e.discord_id WHERE e.id = ?").get(Number(ref));
      if (!e) return null;
      const who = person(db, e.discord_id), rank = RN[e.rank] || e.rank, task = TASK_BY_KEY[e.task];
      const taskName = task?.name || e.task;
      let progress = "—";
      try {
        const owner = db.prepare("SELECT * FROM staff WHERE discord_id = ?").get(e.discord_id);
        const t = taskProgress(db, owner, e.month, getStaffSettings(db, cfg)).tasks.find((x) => x.key === e.task);
        if (t) {
          const after = t.value + Number(e.amount || 0);
          progress = `${t.value}${t.min ? ` de ${t.min} (cuota)` : ""}${t.goal > t.min ? ` · meta ${t.goal}` : ""}\nSi se aprueba: **${after}**${t.min ? (after >= t.min ? " ✅ cumple la cuota" : ` (faltan ${t.min - after})`) : ""}`;
        }
      } catch { /* sin progreso */ }
      const proof = e.url ? LINK("Abrir la prueba", e.url) : e.file ? "📎 Captura adjunta (ábrela en el panel)" : "Sin prueba";
      return {
        summary: `🧾 ${who.name} (${rank}) subió una evidencia de **${taskName}**.`,
        p: {
          title: `🧾 Evidencia: ${taskName}`, color: 0x38bdf8, hash: "staff-revision", footer: "Tareas del staff",
          owner: e.discord_id, ownerRank: e.rank, author: { name: `${who.name} · ${rank}`, icon: who.icon }, robloxId: e.roblox_user_id,
          description: quote(e.note, 900),
          fields: [
            { name: "Pide sumar", value: `${e.amount}${task?.unit ? ` ${task.unit}` : ""}`, inline: true },
            { name: "Mes", value: e.month, inline: true },
            { name: "Rango", value: rank, inline: true },
            { name: "📈 Progreso del mes en esta tarea", value: progress },
            { name: "Prueba", value: proof },
          ],
          link: e.url ? { label: "Ver prueba", url: e.url, emoji: "📎" } : null,
          amount: e.amount,
          details: `Evidencia #${e.id} de ${who.name} (${rank})\nTarea: ${taskName}\nMes: ${e.month}\nPide sumar: ${e.amount}\nPrueba: ${e.url || (e.file ? "captura en el panel" : "—")}\n\nNota:\n${e.note || "—"}`,
          auto: reviewerRanks(e.rank),
        },
      };
    },
  },
  staff_excuse: {
    event: "staff_excuse", refKey: "id", state: byId("staff_excuses"),
    build(db, cfg, ref) {
      const x = db.prepare("SELECT x.*, s.rank, s.strikes, s.roblox_user_id FROM staff_excuses x JOIN staff s ON s.discord_id = x.discord_id WHERE x.id = ?").get(Number(ref));
      if (!x) return null;
      const who = person(db, x.discord_id), rank = RN[x.rank] || x.rank;
      const when = x.scope === "week" ? `semana del ${x.period}` : `mes ${x.period}`;
      const past = db.prepare("SELECT COUNT(*) AS n FROM staff_excuses WHERE discord_id = ? AND status = 'approved' AND id != ?").get(x.discord_id, x.id).n;
      return {
        summary: `📝 ${who.name} (${rank}) presentó una **excusa** (${when}).`,
        p: {
          title: `📝 Excusa: ${when}`, color: 0xf59e0b, hash: "staff-excusas-revision", footer: "Excusas del staff",
          owner: x.discord_id, ownerRank: x.rank, author: { name: `${who.name} · ${rank}`, icon: who.icon }, robloxId: x.roblox_user_id,
          description: quote(x.reason, 900),
          fields: [
            { name: "Periodo", value: x.scope === "week" ? `Semana del ${x.period}` : `Mes ${x.period}`, inline: true },
            { name: "Rango", value: rank, inline: true },
            { name: "Faltas acumuladas", value: String(x.strikes || 0), inline: true },
            { name: "Excusas aprobadas antes", value: String(past), inline: true },
            ...(x.url ? [{ name: "Prueba", value: LINK("Abrir", x.url), inline: true }] : []),
            { name: "Si se aprueba", value: x.scope === "month" ? "Se le quita la falta de ese mes." : "Esa semana no cuenta en su cuota." },
          ],
          link: x.url ? { label: "Ver prueba", url: x.url, emoji: "📎" } : null,
          details: `Excusa #${x.id} de ${who.name} (${rank})\nPeriodo: ${when}\nFaltas: ${x.strikes || 0} · excusas aprobadas antes: ${past}\n\n${x.reason}`,
          auto: reviewerRanks(x.rank),
        },
      };
    },
  },
  staff_link: {
    event: "staff_link", refKey: "discordId",
    state(db, ref) {
      const s = db.prepare("SELECT link_status, reviewed_by FROM staff WHERE discord_id = ?").get(String(ref));
      if (!s) return { status: "gone" };
      return { status: s.link_status === "pending" ? "pending" : "approved", by: s.reviewed_by };
    },
    build(db, cfg, ref) {
      const s = db.prepare("SELECT * FROM staff WHERE discord_id = ? AND link_status = 'pending'").get(String(ref));
      if (!s) return null;
      const who = person(db, s.discord_id), rank = RN[s.rank] || s.rank, pl = player(db, s.roblox_user_id);
      const inGame = db.prepare("SELECT 1 FROM staff_legacy_game WHERE roblox_user_id = ?").get(s.roblox_user_id) || (pl?.staff_tier > 0);
      const inDiscord = db.prepare("SELECT 1 FROM staff_legacy_discord WHERE discord_id = ?").get(s.discord_id);
      return {
        summary: `🔗 ${who.name} (${rank}) pidió vincular la cuenta de Roblox ${ROBLOX(s.roblox_name, s.roblox_user_id)}.`,
        p: {
          title: "🔗 Staff antiguo: confirmar cuenta de Roblox", color: 0x10b981, hash: "staff-solicitudes", footer: "Vinculación de staff",
          owner: s.discord_id, ownerRank: s.rank, author: { name: `${who.name} · ${rank}`, icon: who.icon }, robloxId: s.roblox_user_id,
          hint: "Confirma con esa persona que la cuenta de Roblox es suya antes de aprobar. Al aprobar recibe su rango en el juego y en Discord.",
          fields: [
            { name: "Rango a confirmar", value: rank, inline: true },
            { name: "Roblox", value: ROBLOX(s.roblox_name, s.roblox_user_id), inline: true },
            { name: "Nivel", value: pl?.level != null ? String(pl.level) : "—", inline: true },
            { name: "Staff en el juego", value: inGame ? "✅ Sí" : "⚠️ No aparece", inline: true },
            { name: "Rol en Discord", value: inDiscord ? "✅ Sí" : "⚠️ No aparece", inline: true },
            { name: "Última vez en el juego", value: lastSeen(pl), inline: true },
          ],
          link: s.roblox_user_id ? { label: "Perfil de Roblox", url: PROFILE(s.roblox_user_id), emoji: "🎮" } : null,
          details: `Discord: ${who.name} (${s.discord_id})\nRoblox: @${s.roblox_name} (${s.roblox_user_id})\nRango: ${rank}\nStaff en el juego: ${inGame ? "sí" : "no"} · rol en Discord: ${inDiscord ? "sí" : "no"}`,
        },
      };
    },
  },
  staff_application: {
    event: "staff_application", refKey: "id", state: byId("staff_applications"),
    build(db, cfg, ref) {
      const a = db.prepare("SELECT * FROM staff_applications WHERE id = ?").get(Number(ref));
      if (!a) return null;
      const who = person(db, a.discord_id), pl = player(db, a.roblox_user_id);
      const answers = (() => { try { return JSON.parse(a.answers); } catch { return {}; } })();
      const before = db.prepare("SELECT COUNT(*) AS n FROM staff_applications WHERE discord_id = ? AND id != ?").get(a.discord_id, a.id).n;
      const why = answers.help_experience || Object.values(answers).find((v) => typeof v === "string" && v.length > 40) || "";
      return {
        summary: `🛟 Nueva solicitud de **Helper** de ${who.name}.`,
        p: {
          title: "🛟 Solicitud para ser Helper", color: 0x38bdf8, hash: "staff-solicitudes", footer: "Solicitudes de Helper",
          owner: a.discord_id, ownerRank: null, author: { name: who.name, icon: who.icon }, robloxId: a.roblox_user_id,
          description: why ? `**Experiencia ayudando:**\n${quote(why, 700)}` : "Revisa sus respuestas con «Ver detalles».",
          fields: [
            { name: "Roblox", value: ROBLOX(a.roblox_name, a.roblox_user_id), inline: true },
            { name: "Nivel en el juego", value: pl?.level != null ? String(pl.level) : "—", inline: true },
            { name: "Última vez en el juego", value: lastSeen(pl), inline: true },
            { name: "Zona horaria", value: safe(answers.timezone || "—", 100), inline: true },
            { name: "¿Fue staff antes?", value: safe(answers.prior_staff || "—", 100), inline: true },
            { name: "Solicitudes anteriores", value: String(before), inline: true },
          ],
          link: a.roblox_user_id ? { label: "Perfil de Roblox", url: PROFILE(a.roblox_user_id), emoji: "🎮" } : null,
          details: `Solicitud #${a.id} de ${who.name}\nRoblox: @${a.roblox_name} (${a.roblox_user_id})\n\n` + Object.entries(answers).map(([k, v]) => `**${QUESTION_LABEL[k] || k}**\n${v || "—"}`).join("\n\n"),
        },
      };
    },
  },
  creator_application: {
    event: "creator_application", refKey: "id", state: byId("applications"),
    build(db, cfg, ref) {
      const a = db.prepare("SELECT * FROM applications WHERE id = ?").get(Number(ref));
      if (!a) return null;
      const who = person(db, a.discord_id);
      let platforms = [];
      try { platforms = JSON.parse(a.platforms) || []; } catch { /* sin redes */ }
      const followers = platforms.reduce((n, x) => n + (Number(x.followers) || 0), 0);
      const uid = a.roblox_user_id || db.prepare("SELECT roblox_user_id FROM discord_users WHERE id = ?").get(a.discord_id)?.roblox_user_id;
      const pl = player(db, uid);
      const before = db.prepare("SELECT COUNT(*) AS n FROM applications WHERE discord_id = ? AND id != ?").get(a.discord_id, a.id).n;
      const redes = platforms.slice(0, 6).map((x) => `${PLATFORM_EMOJI[x.type] || "🔗"} ${x.type}: ${LINK(String(x.url).replace(/^https?:\/\//, "").slice(0, 60), x.url)}${x.followers ? ` · ${short(x.followers)} seg.` : ""}`).join("\n") || "—";
      return {
        summary: `🎬 Nueva solicitud para ser **creador** de ${who.name}.`,
        p: {
          title: `🎬 Solicitud de creador: ${a.roblox_name}`, color: 0xff6fae, hash: "mod-solicitudes", footer: "Solicitudes de creador",
          owner: a.discord_id, ownerRank: null, author: { name: who.name, icon: who.icon }, robloxId: uid || null,
          description: quote(a.about, 700),
          fields: [
            { name: "Roblox", value: uid ? ROBLOX(a.roblox_name, uid) : `@${a.roblox_name}`, inline: true },
            { name: "Seguidores en total", value: followers ? short(followers) : "—", inline: true },
            { name: "Nivel en el juego", value: pl?.level != null ? String(pl.level) : "—", inline: true },
            { name: "Redes", value: redes },
            ...(a.sample_url ? [{ name: "Video de ejemplo", value: LINK("Abrir", a.sample_url), inline: true }] : []),
            { name: "Solicitudes anteriores", value: String(before), inline: true },
          ],
          link: a.sample_url ? { label: "Video de ejemplo", url: a.sample_url, emoji: "🎬" } : null,
          details: `Solicitud #${a.id} de ${who.name}\nRoblox: @${a.roblox_name}\nCorreo: ${a.email || "—"}\n\nRedes:\n${platforms.map((x) => `• ${x.type}: ${x.url}${x.followers ? ` (${x.followers})` : ""}`).join("\n") || "—"}\n\n${a.about}`,
        },
      };
    },
  },
  creator_evidence: {
    event: "creator_evidence", refKey: "id", state: byId("evidences"),
    build(db, cfg, ref) {
      const e = db.prepare("SELECT * FROM evidences WHERE id = ?").get(Number(ref));
      if (!e) return null;
      const who = person(db, e.discord_id);
      const kind = e.kind === "live" ? "directo" : "video";
      const c = db.prepare("SELECT tier, roblox_user_id FROM creators WHERE discord_id = ?").get(e.discord_id);
      const approved = db.prepare("SELECT COUNT(*) AS n FROM evidences WHERE discord_id = ? AND status = 'approved'").get(e.discord_id).n;
      const yt = youtubeId(e.url);
      return {
        summary: `📹 ${who.name} subió un ${kind} de **${e.platform}** para anotar las vistas.`,
        p: {
          title: `📹 ${e.title ? safe(e.title, 200) : `Nuevo ${kind} de ${e.platform}`}`, color: 0xff8a3d, hash: "mod-evidencias", footer: "Videos de creadores",
          owner: e.discord_id, ownerRank: null, author: { name: `${who.name}${c?.tier && c.tier !== "None" ? ` · ${c.tier}` : ""}`, icon: who.icon },
          robloxId: yt ? null : c?.roblox_user_id || null, image: yt ? `https://i.ytimg.com/vi/${yt}/hqdefault.jpg` : null,
          description: e.note ? quote(e.note, 500) : null,
          fields: [
            { name: "Plataforma", value: `${PLATFORM_EMOJI[e.platform] || "🔗"} ${e.platform} · ${kind}`, inline: true },
            { name: "Publicado", value: e.published_on, inline: true },
            { name: "Vistas leídas", value: e.auto_views != null ? `${short(e.auto_views)} (automático)` : "Aún sin leer", inline: true },
            { name: "Videos aprobados", value: String(approved), inline: true },
            { name: "Enlace", value: LINK("Abrir el video", e.url) },
          ],
          link: { label: "Ver el video", url: e.url, emoji: "▶️" },
          details: `Evidencia #${e.id} de ${who.name}\n${kind} de ${e.platform}, publicado ${e.published_on}\n${e.url}\nVistas leídas: ${e.auto_views ?? "—"}${e.note ? `\n\n${e.note}` : ""}`,
        },
      };
    },
  },
  creator_link: {
    event: "creator_link", refKey: "discordId",
    state(db, ref) {
      const c = db.prepare("SELECT link_status, link_reviewed_by, link_note FROM creators WHERE discord_id = ?").get(String(ref));
      if (!c) return { status: "gone" };
      const st = { pending: "pending", approved: "approved", rejected: "rejected" }[c.link_status] || "gone";
      return { status: st, by: c.link_reviewed_by, note: c.link_note };
    },
    build(db, cfg, ref) {
      const c = db.prepare("SELECT * FROM creators WHERE discord_id = ? AND link_status = 'pending'").get(String(ref));
      if (!c) return null;
      const who = person(db, c.discord_id), pl = player(db, c.roblox_user_id);
      const cur = db.prepare("SELECT roblox_user_id FROM discord_users WHERE id = ?").get(c.discord_id)?.roblox_user_id;
      const curP = cur && cur !== c.roblox_user_id ? player(db, cur) : null;
      return {
        summary: `🔗 ${who.name} pidió cambiar su cuenta de Roblox a ${ROBLOX(c.roblox_name, c.roblox_user_id)}.`,
        p: {
          title: "🔗 Creador: cambio de cuenta de Roblox", color: 0xc77dff, hash: "mod-vinculos", footer: "Vinculaciones de creadores",
          owner: c.discord_id, ownerRank: null, author: { name: who.name, icon: who.icon }, robloxId: c.roblox_user_id,
          hint: "Confirma con el creador que la cuenta es suya antes de aprobar.",
          fields: [
            { name: "Cuenta nueva", value: ROBLOX(c.roblox_name, c.roblox_user_id), inline: true },
            { name: "Cuenta actual", value: curP ? ROBLOX(curP.name, cur) : "—", inline: true },
            { name: "Nivel (nueva)", value: pl?.level != null ? String(pl.level) : "—", inline: true },
            { name: "Última vez en el juego", value: lastSeen(pl), inline: true },
          ],
          link: c.roblox_user_id ? { label: "Perfil de Roblox", url: PROFILE(c.roblox_user_id), emoji: "🎮" } : null,
          details: `${who.name} (${c.discord_id})\nCuenta nueva: @${c.roblox_name} (${c.roblox_user_id})\nCuenta actual: ${curP ? `@${curP.name} (${cur})` : "—"}`,
        },
      };
    },
  },
};
export const REVIEW_KINDS = Object.keys(KINDS);

export function loadPost(db, id) {
  const r = db.prepare("SELECT * FROM review_posts WHERE id = ?").get(Number(id));
  return r ? { ...r, p: JSON.parse(r.payload) } : null;
}

const RESOLVED = {
  approved: { color: 0x22c55e, emoji: "✅", word: "Aprobado" },
  rejected: { color: 0xef4444, emoji: "❌", word: "Rechazado" },
  closed: { color: 0x6b7280, emoji: "🗃️", word: "Cerrado" },
};

// ---------- Dibujo ----------
export function renderView(cfg, post) {
  const { p, status } = post;
  const res = RESOLVED[status];
  const fields = [...(p.fields || [])];
  fields.push({ name: "Discord", value: `<@${p.owner}>`, inline: true });
  fields.push({ name: "Enviado", value: ts(post.created_at), inline: true });
  if (!res) {
    fields.push({ name: "🛡️ Lo resuelve", value: resolverLabel(post.kind, p), inline: true });
    if (post.claimed_name) fields.push({ name: "👀 Lo revisa", value: safe(post.claimed_name, 100), inline: true });
  } else {
    fields.push({ name: `${res.emoji} ${res.word} por`, value: safe(post.resolved_by || "—", 100), inline: true });
    fields.push({ name: "Cuándo", value: `${ts(post.resolved_at, "f")} · tardó ${duration(post.resolved_at - post.created_at)}`, inline: true });
    if (post.resolve_note) fields.push({ name: status === "rejected" ? "Motivo" : "Nota", value: quote(post.resolve_note, 500) });
  }
  const embed = {
    author: p.author ? { name: clean(p.author.name, 250), ...(p.author.icon ? { icon_url: p.author.icon } : {}) } : undefined,
    title: clean(`${res ? `${res.emoji} ${res.word} · ` : ""}${p.title}`, 250),
    url: `${PANEL(cfg)}#${p.hash}`,
    color: res ? res.color : p.color,
    // La pista («confirma antes de aprobar») solo sirve mientras está pendiente.
    description: clean([p.description, !res && p.hint ? `💡 ${p.hint}` : null].filter(Boolean).join("\n\n"), 1500) || undefined,
    fields: fields.slice(0, 25).map((f) => ({ name: clean(f.name, 250), value: clean(f.value, 1000) || "—", inline: !!f.inline })),
    thumbnail: p.thumb ? { url: p.thumb } : undefined,
    image: p.image && !res ? { url: p.image } : undefined,
    footer: { text: `Sky Eggs · ${res ? res.word : "Pendiente"} · ${p.footer || "Revisión"} · #${post.id}` },
    timestamp: new Date(post.resolved_at || post.created_at).toISOString(),
  };
  for (const k of Object.keys(embed)) if (embed[k] === undefined) delete embed[k];

  const links = [linkButton("Abrir en el panel", `${PANEL(cfg)}#${p.hash}`, "🧭")];
  if (p.link) links.push(linkButton(p.link.label, p.link.url, p.link.emoji));
  if (p.robloxId && p.link?.url !== PROFILE(p.robloxId)) links.push(linkButton("Perfil de Roblox", PROFILE(p.robloxId), "🎮"));
  const rows = [row(...links)];
  if (interactionsEnabled(cfg)) {
    const id = post.id;
    rows.push(res
      ? row(actionButton("Ver detalles", `rv:${id}:more`, 2, "🔎"))
      : row(
        actionButton("Aprobar", `rv:${id}:approve`, 3, "✅"),
        actionButton("Rechazar", `rv:${id}:reject`, 4, "✖️"),
        actionButton(post.claimed_name ? "Liberar" : "Lo reviso yo", `rv:${id}:claim`, post.claimed_name ? 2 : 1, "👀"),
        actionButton("Ver detalles", `rv:${id}:more`, 2, "🔎"),
      ));
  }
  return { embeds: [embed], components: rows };
}
// Texto encima del embed: al resolverse se reemplaza (sin las menciones) para que el canal se lea de un vistazo.
function contentFor(post) {
  const res = RESOLVED[post.status];
  return res ? `${res.emoji} **${res.word}** por ${safe(post.resolved_by || "—", 100)} · ${clean(post.p.summary || "", 1500)}` : undefined;
}
async function redraw(db, cfg, id, fetchImpl) {
  const post = loadPost(db, id);
  if (!post?.message_id || !post.channel_id || !botEnabled(cfg)) return;
  const view = renderView(cfg, post);
  const content = contentFor(post);
  await editMessage(cfg, post.channel_id, post.message_id, { ...(content ? { content } : {}), embeds: view.embeds, components: view.components, allowed_mentions: { parse: [] } }, { fetchImpl });
}
function close(db, id, { status, by, note }, now) {
  db.prepare("UPDATE review_posts SET status = ?, resolved_by = ?, resolved_at = ?, resolve_note = ?, claimed_id = NULL, claimed_name = NULL WHERE id = ? AND status = 'open'")
    .run(status, String(by || "—").slice(0, 100), now, note ? String(note).slice(0, 500) : null, id);
}

// ---------- Publicar / resolver / barrer ----------
// Publica la tarjeta en el canal del staff (con menciones según ajustes). Nunca lanza.
export async function postReview(db, cfg, kind, ref, fetchImpl = fetch, now = Date.now()) {
  try {
    const K = KINDS[kind];
    const built = K && K.build(db, cfg, ref);
    if (!built) return { sent: false, reason: "no_data" };
    const { summary, p } = built;
    p.summary = summary;
    if (p.robloxId && botEnabled(cfg)) {
      try { p.thumb = (await avatars([Number(p.robloxId)], { fetchImpl, timeoutMs: 2500 })).get(Number(p.robloxId)) || null; } catch { /* sin foto */ }
    }
    // Una solicitud nueva del mismo caso reemplaza a la tarjeta anterior.
    for (const old of db.prepare("SELECT id FROM review_posts WHERE kind = ? AND ref = ? AND status = 'open'").all(kind, String(ref))) {
      close(db, old.id, { status: "closed", by: "Sistema", note: "Reemplazada por una solicitud nueva." }, now);
      await redraw(db, cfg, old.id, fetchImpl).catch(() => {});
    }
    const ins = db.prepare("INSERT INTO review_posts (kind, ref, payload, created_at) VALUES (?, ?, ?, ?)").run(kind, String(ref), JSON.stringify(p), now);
    const id = Number(ins.lastInsertRowid);
    const view = renderView(cfg, { id, kind, status: "open", created_at: now, p, claimed_name: null });
    const r = await announce(db, cfg, K.event, { text: summary, auto: p.auto || [], embeds: view.embeds, components: view.components }, fetchImpl, now);
    if (!r.sent) {
      // Sin bot o aviso apagado: no queda tarjeta huérfana (el panel sigue mostrando el pendiente).
      db.prepare("DELETE FROM review_posts WHERE id = ?").run(id);
      return r;
    }
    db.prepare("UPDATE review_posts SET channel_id = ?, message_id = ? WHERE id = ?").run(String(cfg.discord.announceChannel), r.messageId ? String(r.messageId) : null, id);
    return { ...r, postId: id };
  } catch (e) {
    return { sent: false, reason: e.message };
  }
}

// Marca como aprobada o rechazada la tarjeta abierta de esa solicitud y la edita. Nunca lanza.
export async function resolveReview(db, cfg, kind, ref, { status, by, note = null }, fetchImpl = fetch, now = Date.now()) {
  if (status !== "approved" && status !== "rejected") return null; // «contactado» u otros estados no cierran la tarjeta
  try {
    const open = db.prepare("SELECT id FROM review_posts WHERE kind = ? AND ref = ? AND status = 'open' ORDER BY id DESC LIMIT 1").get(kind, String(ref));
    if (!open) return null;
    close(db, open.id, { status, by, note }, now);
    await redraw(db, cfg, open.id, fetchImpl);
    return { ok: true, postId: open.id };
  } catch {
    return null;
  }
}

// Cierra las tarjetas cuyo caso ya no está pendiente (retirado, resuelto por otro camino, cuenta borrada).
export async function sweepReviews(db, cfg, fetchImpl = fetch, now = Date.now()) {
  let closed = 0;
  for (const r of db.prepare("SELECT id, kind, ref FROM review_posts WHERE status = 'open' ORDER BY id LIMIT 300").all()) {
    const K = KINDS[r.kind];
    if (!K) continue;
    let st;
    try { st = K.state(db, r.ref); } catch { continue; }
    if (st.status === "pending" || st.status === "contacted") continue;
    const status = st.status === "approved" || st.status === "rejected" ? st.status : "closed";
    close(db, r.id, { status, by: st.by || "—", note: status === "closed" ? "Ya no está pendiente (la retiraron o se resolvió por otro camino)." : st.note }, now);
    await redraw(db, cfg, r.id, fetchImpl).catch(() => {});
    closed++;
  }
  return { closed };
}

// ---------- Botones y formularios ----------
const DENY = {
  own_item: "Es tuya: la tiene que revisar otra persona del staff.",
  no_staff: "Estos botones son solo para el staff.",
};
const ERRORS = {
  already_reviewed: "Alguien ya la revisó.", not_found: "Ya no está pendiente.", forbidden: "No te toca resolver esta.",
  admin_only: "Solo el Admin puede resolver esta.", own_item: DENY.own_item, note_required: "Escribe el motivo.",
  bad_amount: "La cantidad tiene que ser un número entre 0 y 500.", bad_views: "Las vistas tienen que ser un número.",
  roblox_taken: "Esa cuenta de Roblox ya la tiene otra persona.", no_auto_views: "Ese video aún no tiene vistas leídas.",
  not_trackable: "Ese sitio no se puede leer solo: escribe las vistas.", link_roblox: "Vincula tu cuenta de Roblox en el panel.",
};

function modal(customId, title, inputs) {
  return {
    type: REPLY.MODAL,
    data: {
      custom_id: customId, title: title.slice(0, 45),
      components: inputs.map((i) => ({
        type: 1,
        components: [{
          type: 4, custom_id: i.id, label: i.label.slice(0, 45), style: i.long ? 2 : 1, required: !!i.required,
          min_length: i.required ? 1 : 0, max_length: i.max || 500,
          ...(i.value != null && String(i.value) !== "" ? { value: String(i.value).slice(0, i.max || 500) } : {}),
          ...(i.ph ? { placeholder: i.ph.slice(0, 100) } : {}),
        }],
      })),
    },
  };
}
function formFor(db, post, action) {
  const verb = action === "approve" ? "Aprobar" : "Rechazar";
  const title = `${verb}: ${String(post.p.title).replace(/^\S+\s/, "")}`;
  const id = `rv:${post.id}:${action}`;
  if (action === "reject") return modal(id, title, [{ id: "note", label: "Motivo (lo verá la persona)", long: true, required: true, ph: "Explica por qué, para que pueda corregirlo." }]);
  const extra = [];
  if (post.kind === "staff_evidence") extra.push({ id: "amount", label: "Cantidad a sumar", value: post.p.amount, required: true, max: 3 });
  if (post.kind === "creator_evidence") {
    const ev = db.prepare("SELECT auto_views FROM evidences WHERE id = ?").get(Number(post.ref));
    extra.push({ id: "views", label: ev?.auto_views != null ? "Vistas (déjalas así para seguir leyéndolas)" : "Vistas del video", value: ev?.auto_views ?? "", required: true, max: 10, ph: "Ej. 12500" });
  }
  return modal(id, title, [...extra, { id: "note", label: "Nota (opcional)", long: true, required: false, ph: "Opcional: algo que deba saber." }]);
}
function readForm(it) {
  const out = {};
  for (const r of it.data?.components || []) for (const c of r.components || []) out[c.custom_id] = String(c.value ?? "").trim();
  return out;
}
function bodyFor(db, post, action, f) {
  const K = KINDS[post.kind];
  const body = { [K.refKey]: K.refKey === "id" ? Number(post.ref) : String(post.ref), action, note: f.note || null };
  if (action === "approve" && post.kind === "staff_evidence") body.amount = Number(f.amount);
  if (action === "approve" && post.kind === "creator_evidence") {
    const ev = db.prepare("SELECT auto_views FROM evidences WHERE id = ?").get(Number(post.ref));
    const views = Number(String(f.views).replace(/[.,\s]/g, ""));
    body.views = views;
    if (ev?.auto_views != null && views === ev.auto_views) body.mode = "auto";
  }
  return body;
}

// Botón (type 3) o formulario enviado (type 5) con custom_id rv:<id>:<acción>.
// ctx.act(kind, actor, body) ejecuta la revisión del panel (lanza con .code si falla).
// Para formularios devuelve { type: 6, defer } : app.js responde al momento y luego corre defer()
// y manda su texto como mensaje privado.
export async function handleReviewButton(db, cfg, it, ctx = {}, now = Date.now()) {
  const [, rawId, action] = String(it.data?.custom_id || "").split(":");
  const user = it.member?.user || it.user;
  const discordId = String(user?.id || "");
  const post = loadPost(db, rawId);
  if (!post) return ephemeral("Esa tarjeta ya no existe.");
  const actor = discordActor(db, cfg, discordId);
  if (actor.error) return ephemeral(actor.error);
  const isStaff = ["admin", "moderator", "modjr"].includes(actor.role);
  const why = canResolve(post.kind, post.p, actor);

  if (action === "more") {
    if (!isStaff && why) return ephemeral(DENY.no_staff);
    const head = post.status === "open" ? (post.claimed_name ? `👀 La revisa ${post.claimed_name}.` : "Pendiente.") : `${RESOLVED[post.status].emoji} ${RESOLVED[post.status].word} por ${post.resolved_by}.`;
    return ephemeral(`${head}\n🛡️ Lo resuelve: ${resolverLabel(post.kind, post.p)}\n\n${String(post.p.details || "Sin más detalles.")}`.slice(0, 1990));
  }
  if (post.status !== "open") {
    const view = renderView(cfg, post);
    return { type: REPLY.UPDATE, data: { embeds: view.embeds, components: view.components } };
  }
  if (why) return ephemeral(why === "forbidden" ? `Esta la resuelve: **${resolverLabel(post.kind, post.p)}**.` : DENY[why]);

  if (action === "claim") {
    const mine = post.claimed_id === discordId;
    if (post.claimed_id && !mine && actor.role !== "admin") return ephemeral(`Ya la está revisando ${post.claimed_name}.`);
    const name = safe(user?.global_name || user?.username || actor.name, 100);
    db.prepare("UPDATE review_posts SET claimed_id = ?, claimed_name = ? WHERE id = ?").run(mine ? null : discordId, mine ? null : name, post.id);
    const view = renderView(cfg, loadPost(db, post.id));
    return { type: REPLY.UPDATE, data: { embeds: view.embeds, components: view.components } };
  }
  if (action !== "approve" && action !== "reject") return ephemeral("Esa acción ya no está disponible.");
  if (it.type === 3) return formFor(db, post, action);

  // Formulario enviado: se responde al momento y la revisión corre después (puede poner roles en Discord).
  const f = readForm(it);
  const body = bodyFor(db, post, action, f);
  if (action === "approve" && post.kind === "staff_evidence" && !(Number.isInteger(body.amount) && body.amount >= 0 && body.amount <= 500)) return ephemeral(ERRORS.bad_amount);
  if (action === "approve" && post.kind === "creator_evidence" && !(Number.isFinite(body.views) && body.views >= 0)) return ephemeral(ERRORS.bad_views);
  return {
    type: REPLY.DEFERRED_UPDATE,
    defer: async () => {
      try {
        await ctx.act(post.kind, actor, body);
      } catch (e) {
        const code = e?.code || e?.message;
        if (code === "not_found" || code === "already_reviewed") await sweepReviews(db, cfg, ctx.fetchImpl).catch(() => {});
        return `No se pudo: ${ERRORS[code] || "algo salió mal, inténtalo en el panel."}`;
      }
      // Por si la revisión no cerró la tarjeta (p. ej. sin message_id), se cierra aquí.
      const still = loadPost(db, post.id);
      if (still?.status === "open") {
        close(db, post.id, { status: action === "approve" ? "approved" : "rejected", by: actor.name, note: body.note }, Date.now());
        await redraw(db, cfg, post.id, ctx.fetchImpl).catch(() => {});
      }
      return action === "approve" ? "✅ Aprobada. La tarjeta ya se actualizó." : "❌ Rechazada. La tarjeta ya se actualizó.";
    },
  };
}
