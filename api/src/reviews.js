// Tarjetas de revisión en el canal del staff (2026-11-24).
// Cada solicitud, evidencia o excusa que necesita a un moderador se publica como un mensaje con
// embed, menciones al rango que le toca (ajustes del staff) y botones:
//   🧭 Abrir en el panel · 📎/🎮 enlace extra · 👀 Lo reviso yo (se ve quién lo lleva) · 🔎 Ver detalles.
// Cuando alguien lo aprueba o rechaza en el panel, el mensaje se EDITA solo: color, "Aprobado por …",
// fecha y sin botones de acción. Así nadie más pierde tiempo en lo que ya está atendido.
import { announce, reviewerRanks } from "./announce.js";
import { editMessage, interactionsEnabled, linkButton, actionButton, row, ephemeral, safe, short, REPLY } from "./bot.js";

// Texto de campos: deja los enlaces markdown, solo neutraliza menciones masivas.
const clean = (v, max) => String(v ?? "").replace(/@(everyone|here)/gi, "@\u200b$1").slice(0, max);
import { botEnabled } from "./discord.js";
import { withStaffRoles } from "./staff.js";
import { getDiscordUser } from "./creators.js";
import { TASK_BY_KEY } from "./staffProgram.js";

const RN = { Helper: "Helper", ModeratorJr: "Moderator Jr", Moderator: "Moderator" };
const PANEL = (cfg) => `${cfg.siteUrl}/creadores/panel/`;
const LINK = (label, url) => `[${label}](${url})`;
const ROBLOX = (name, uid) => (uid ? LINK(`@${name}`, `https://www.roblox.com/users/${uid}/profile`) : `@${name || "—"}`);
const PLATFORM_EMOJI = { YouTube: "📺", TikTok: "🎵", Twitch: "🟣", Kick: "🟩", Instagram: "📸", Facebook: "📘" };

function nameOf(db, discordId) {
  const u = db.prepare("SELECT username, global_name FROM discord_users WHERE id = ?").get(String(discordId));
  return u ? (u.global_name ? `${u.global_name} (@${u.username})` : `@${u.username}`) : `#${discordId}`;
}

// Cada tipo: evento de ajustes (menciones), y cómo armar el contenido a partir de la fila de la base.
// build(db, cfg, ref) devuelve { summary, p } o null. p se guarda como JSON para poder redibujar la tarjeta.
const KINDS = {
  staff_evidence: {
    event: "staff_evidence",
    build(db, cfg, ref) {
      const e = db.prepare("SELECT e.*, s.rank, s.roblox_name, s.roblox_user_id FROM staff_evidence e JOIN staff s ON s.discord_id = e.discord_id WHERE e.id = ?").get(Number(ref));
      if (!e) return null;
      const who = nameOf(db, e.discord_id), rank = RN[e.rank] || e.rank, task = TASK_BY_KEY[e.task]?.name || e.task;
      const proof = e.url ? LINK("Abrir la prueba", e.url) : e.file ? "📎 Captura adjunta (ábrela en el panel)" : "—";
      return {
        summary: `🧾 ${who} (${rank}) subió una evidencia de **${task}**.`,
        p: {
          title: `Evidencia de tarea: ${task}`, color: 0x38bdf8, hash: "staff-revision", footer: "Tareas del staff",
          description: safe(e.note, 1000),
          fields: [
            { name: "Pide sumar", value: String(e.amount), inline: true },
            { name: "Mes", value: e.month, inline: true },
            { name: "Rango", value: rank, inline: true },
            { name: "Prueba", value: proof },
          ],
          link: e.url ? { label: "Ver prueba", url: e.url, emoji: "📎" } : null,
          details: `Tarea: ${task}\nMes: ${e.month}\nPide sumar: ${e.amount}\nNota: ${e.note || "—"}`,
          auto: reviewerRanks(e.rank),
        },
      };
    },
  },
  staff_excuse: {
    event: "staff_excuse",
    build(db, cfg, ref) {
      const x = db.prepare("SELECT x.*, s.rank FROM staff_excuses x JOIN staff s ON s.discord_id = x.discord_id WHERE x.id = ?").get(Number(ref));
      if (!x) return null;
      const who = nameOf(db, x.discord_id), rank = RN[x.rank] || x.rank;
      const when = x.scope === "week" ? `semana del ${x.period}` : `mes ${x.period}`;
      return {
        summary: `📝 ${who} (${rank}) presentó una **excusa** (${when}).`,
        p: {
          title: `Excusa: ${when}`, color: 0xf59e0b, hash: "staff-excusas-revision", footer: "Excusas del staff",
          description: safe(x.reason, 1000),
          fields: [
            { name: "Rango", value: rank, inline: true },
            { name: "Periodo", value: when, inline: true },
            ...(x.url ? [{ name: "Prueba", value: LINK("Abrir", x.url) }] : []),
          ],
          link: x.url ? { label: "Ver prueba", url: x.url, emoji: "📎" } : null,
          details: `Excusa (${when}) de ${who}\n\n${x.reason}`,
          auto: reviewerRanks(x.rank),
        },
      };
    },
  },
  staff_link: {
    event: "staff_link",
    build(db, cfg, ref) {
      const s = db.prepare("SELECT * FROM staff WHERE discord_id = ? AND link_status = 'pending'").get(String(ref));
      if (!s) return null;
      const who = nameOf(db, s.discord_id), rank = RN[s.rank] || s.rank;
      return {
        summary: `🔗 ${who} (${rank}) pidió vincular la cuenta de Roblox ${ROBLOX(s.roblox_name, s.roblox_user_id)}.`,
        p: {
          title: "Staff antiguo: confirmar cuenta de Roblox", color: 0x10b981, hash: "staff-solicitudes", footer: "Vinculación de staff",
          description: "Confirma con esa persona que la cuenta de Roblox es suya antes de aprobar.",
          fields: [
            { name: "Rango", value: rank, inline: true },
            { name: "Roblox", value: ROBLOX(s.roblox_name, s.roblox_user_id), inline: true },
          ],
          link: s.roblox_user_id ? { label: "Perfil de Roblox", url: `https://www.roblox.com/users/${s.roblox_user_id}/profile`, emoji: "🎮" } : null,
          details: `Discord: ${who}\nRoblox: @${s.roblox_name} (${s.roblox_user_id})\nRango: ${rank}`,
        },
      };
    },
  },
  staff_application: {
    event: "staff_application",
    build(db, cfg, ref) {
      const a = db.prepare("SELECT * FROM staff_applications WHERE id = ?").get(Number(ref));
      if (!a) return null;
      const who = nameOf(db, a.discord_id);
      const answers = (() => { try { return JSON.parse(a.answers); } catch { return {}; } })();
      const lvl = db.prepare("SELECT level FROM players WHERE user_id = ?").get(a.roblox_user_id)?.level;
      const why = Object.values(answers).find((v) => typeof v === "string" && v.length > 40) || "";
      return {
        summary: `🛟 Nueva solicitud de **Helper** de ${who}.`,
        p: {
          title: "Solicitud para ser Helper", color: 0x38bdf8, hash: "staff-solicitudes", footer: "Solicitudes de Helper",
          description: safe(why, 600) || "Revisa sus respuestas con «Ver detalles».",
          fields: [
            { name: "Roblox", value: ROBLOX(a.roblox_name, a.roblox_user_id), inline: true },
            { name: "Nivel en el juego", value: lvl != null ? String(lvl) : "—", inline: true },
          ],
          link: a.roblox_user_id ? { label: "Perfil de Roblox", url: `https://www.roblox.com/users/${a.roblox_user_id}/profile`, emoji: "🎮" } : null,
          details: Object.entries(answers).map(([k, v]) => `• ${k}\n  ${v}`).join("\n").slice(0, 1800),
        },
      };
    },
  },
  creator_application: {
    event: "creator_application",
    build(db, cfg, ref) {
      const a = db.prepare("SELECT * FROM applications WHERE id = ?").get(Number(ref));
      if (!a) return null;
      const who = nameOf(db, a.discord_id);
      let platforms = [];
      try { platforms = JSON.parse(a.platforms) || []; } catch { /* sin redes */ }
      const redes = platforms.slice(0, 6).map((x) => `${PLATFORM_EMOJI[x.type] || "🔗"} ${x.type}: ${LINK(x.url.replace(/^https?:\/\//, "").slice(0, 60), x.url)}${x.followers ? ` · ${short(x.followers)} seg.` : ""}`).join("\n") || "—";
      return {
        summary: `📝 Nueva solicitud para ser **creador** de ${who}.`,
        p: {
          title: `Solicitud de creador: ${a.roblox_name}`, color: 0xff6fae, hash: "mod-solicitudes", footer: "Solicitudes de creador",
          description: safe(a.about, 600),
          fields: [
            { name: "Roblox", value: `@${a.roblox_name}`, inline: true },
            { name: "Redes", value: redes },
            ...(a.sample_url ? [{ name: "Video de ejemplo", value: a.sample_url }] : []),
          ],
          link: a.sample_url ? { label: "Video de ejemplo", url: a.sample_url, emoji: "🎬" } : null,
          details: `${who}\nCorreo: ${a.email || "—"}\n\n${a.about}`,
        },
      };
    },
  },
  creator_evidence: {
    event: "creator_evidence",
    build(db, cfg, ref) {
      const e = db.prepare("SELECT * FROM evidences WHERE id = ?").get(Number(ref));
      if (!e) return null;
      const who = nameOf(db, e.discord_id);
      const kind = e.kind === "live" ? "directo" : "video";
      return {
        summary: `📹 ${who} subió un ${kind} de **${e.platform}** para anotar las vistas.`,
        p: {
          title: e.title ? safe(e.title, 200) : `Nuevo ${kind} de ${e.platform}`, color: 0xff8a3d, hash: "mod-evidencias", footer: "Videos de creadores",
          description: e.note ? safe(e.note, 500) : null,
          fields: [
            { name: "Plataforma", value: `${PLATFORM_EMOJI[e.platform] || "🔗"} ${e.platform}`, inline: true },
            { name: "Publicado", value: e.published_on, inline: true },
            { name: "Enlace", value: LINK("Abrir", e.url) },
          ],
          link: { label: "Ver el video", url: e.url, emoji: "▶️" },
          details: `${who}\n${kind} de ${e.platform}, publicado ${e.published_on}\n${e.url}${e.note ? `\n\n${e.note}` : ""}`,
        },
      };
    },
  },
  creator_link: {
    event: "creator_link",
    build(db, cfg, ref) {
      const c = db.prepare("SELECT * FROM creators WHERE discord_id = ? AND link_status = 'pending'").get(String(ref));
      if (!c) return null;
      const who = nameOf(db, c.discord_id);
      return {
        summary: `🔗 ${who} pidió cambiar su cuenta de Roblox a ${ROBLOX(c.roblox_name, c.roblox_user_id)}.`,
        p: {
          title: "Cambio de cuenta de Roblox", color: 0xc77dff, hash: "mod-vinculos", footer: "Vinculaciones de creadores",
          description: "Confirma con el creador que la cuenta es suya antes de aprobar.",
          fields: [{ name: "Roblox nuevo", value: ROBLOX(c.roblox_name, c.roblox_user_id), inline: true }],
          link: c.roblox_user_id ? { label: "Perfil de Roblox", url: `https://www.roblox.com/users/${c.roblox_user_id}/profile`, emoji: "🎮" } : null,
          details: `${who}\nRoblox: @${c.roblox_name} (${c.roblox_user_id})`,
        },
      };
    },
  },
};

// Sin mención de rango: el evento de ajustes decide. Devuelve la fila de la tarjeta o null.
export function loadPost(db, id) {
  const row = db.prepare("SELECT * FROM review_posts WHERE id = ?").get(Number(id));
  return row ? { ...row, p: JSON.parse(row.payload) } : null;
}

const RESOLVED = {
  approved: { color: 0x22c55e, title: "✅", word: "Aprobado" },
  rejected: { color: 0xef4444, title: "❌", word: "Rechazado" },
};

// Dibuja la tarjeta según su estado (abierta, con quién la lleva, o resuelta).
export function renderView(cfg, post) {
  const { p, status } = post;
  const resolved = RESOLVED[status];
  const fields = [...(p.fields || [])];
  const embed = {
    title: safe(`${resolved ? `${resolved.title} ` : ""}${p.title}`, 250),
    url: `${PANEL(cfg)}#${p.hash}`,
    color: resolved ? resolved.color : p.color,
    description: p.description ? clean(p.description, 1000) : undefined,
    fields: [],
    footer: { text: `Sky Eggs · ${resolved ? `${resolved.word} · ` : "Pendiente · "}${p.footer || "Revisión"}` },
    timestamp: new Date(post.resolved_at || post.created_at).toISOString(),
  };
  if (!resolved && post.claimed_name) fields.push({ name: "👀 Lo revisa", value: safe(post.claimed_name, 100), inline: true });
  if (resolved) {
    fields.push({ name: `${resolved.word} por`, value: safe(post.resolved_by || "—", 100), inline: true });
    if (post.resolve_note) fields.push({ name: "Nota", value: clean(post.resolve_note, 500) });
  }
  embed.fields = fields.slice(0, 25).map((f) => ({ name: clean(f.name, 250), value: clean(f.value, 1000) || "—", inline: !!f.inline }));
  if (!embed.description) delete embed.description;

  const links = [linkButton("Abrir en el panel", `${PANEL(cfg)}#${p.hash}`, "🧭")];
  if (p.link) links.push(linkButton(p.link.label, p.link.url, p.link.emoji));
  const rows = [row(...links)];
  if (interactionsEnabled(cfg)) {
    const id = post.id;
    const acts = [];
    if (!resolved) acts.push(actionButton(post.claimed_name ? "Liberar" : "Lo reviso yo", `rv:${id}:claim`, post.claimed_name ? 2 : 1, "👀"));
    acts.push(actionButton("Ver detalles", `rv:${id}:more`, 2, "🔎"));
    rows.push(row(...acts));
  }
  return { embeds: [embed], components: rows };
}

// Publica la tarjeta en el canal del staff (con menciones según ajustes). Nunca lanza.
export async function postReview(db, cfg, kind, ref, fetchImpl = fetch, now = Date.now()) {
  try {
    const K = KINDS[kind];
    const built = K && K.build(db, cfg, ref);
    if (!built) return { sent: false, reason: "no_data" };
    const { summary, p } = built;
    const ins = db.prepare("INSERT INTO review_posts (kind, ref, payload, created_at) VALUES (?, ?, ?, ?)").run(kind, String(ref), JSON.stringify(p), now);
    const id = Number(ins.lastInsertRowid);
    const view = renderView(cfg, { id, status: "open", created_at: now, p, claimed_name: null });
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
  if (!RESOLVED[status]) return null; // «contactado» u otros estados no cierran la tarjeta
  try {
    const open = db.prepare("SELECT id FROM review_posts WHERE kind = ? AND ref = ? AND status = 'open' ORDER BY id DESC LIMIT 1").get(kind, String(ref));
    if (!open) return null;
    db.prepare("UPDATE review_posts SET status = ?, resolved_by = ?, resolved_at = ?, resolve_note = ? WHERE id = ?").run(status, safe(by, 100), now, note ? safe(note, 500) : null, open.id);
    const post = loadPost(db, open.id);
    if (post.message_id && post.channel_id && botEnabled(cfg)) {
      const view = renderView(cfg, post);
      await editMessage(cfg, post.channel_id, post.message_id, { embeds: view.embeds, components: view.components }, { fetchImpl });
    }
    return { ok: true, postId: open.id };
  } catch {
    return null;
  }
}

// Botones de la tarjeta. Solo el staff (moderador o Moderator Jr, o admin) puede usarlos.
export async function handleReviewButton(db, cfg, it, now = Date.now()) {
  const [, rawId, action] = String(it.data?.custom_id || "").split(":");
  const user = it.member?.user || it.user;
  const discordId = String(user?.id || "");
  const who = withStaffRoles(db, cfg, getDiscordUser(db, discordId));
  if (!who || !(who.roles.modjr || who.roles.moderator || who.roles.admin)) {
    return ephemeral("Estos botones son solo para el staff.");
  }
  const post = loadPost(db, rawId);
  if (!post) return ephemeral("Esa tarjeta ya no existe.");
  if (action === "more") return ephemeral(post.p.details || "Sin más detalles.");
  if (post.status !== "open") {
    const view = renderView(cfg, post);
    return { type: REPLY.UPDATE, data: { embeds: view.embeds, components: view.components } };
  }
  if (action === "claim") {
    const name = safe(user?.global_name || user?.username || discordId, 100);
    const mine = post.claimed_id === discordId;
    db.prepare("UPDATE review_posts SET claimed_id = ?, claimed_name = ? WHERE id = ?").run(mine ? null : discordId, mine ? null : name, post.id);
    const view = renderView(cfg, loadPost(db, post.id));
    return { type: REPLY.UPDATE, data: { embeds: view.embeds, components: view.components } };
  }
  return ephemeral("Esa acción ya no está disponible.");
}
