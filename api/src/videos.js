// Anuncio en Discord de cada video o directo aprobado por un moderador (canal DISCORD_VIDEO_CHANNEL).
// Mensaje con miniatura, creador (foto de Roblox, rango con su color), red, vistas que se actualizan
// solas, botones de enlace (ver video, jugar, perfil, ser creador) y botones para todos los miembros:
// ❤️ Me gusta (contador), 📊 Más de este creador (respuesta privada) y 🔔 Avisos de videos (rol opcional).
import { avatars } from "./roblox.js";
import { youtubeId } from "./views.js";
import { sendMessage, editMessage, deleteMessage, interactionsEnabled, linkButton, actionButton, row, ephemeral, short, safe, isSnowflake, langOf, toggleRole, REPLY } from "./bot.js";
import { botEnabled } from "./discord.js";

const PLATFORM = {
  YouTube: { emoji: "📺", color: 0xff2d2d }, TikTok: { emoji: "🎵", color: 0x111111 }, Twitch: { emoji: "🟣", color: 0x9146ff },
  Kick: { emoji: "🟩", color: 0x53fc18 }, Instagram: { emoji: "📸", color: 0xe1306c }, Facebook: { emoji: "📘", color: 0x1877f2 }, Otra: { emoji: "🔗", color: 0x4fb4ff },
};
const gameUrl = (cfg) => `https://www.roblox.com/games/${cfg.roblox?.placeId || "77372347150746"}`;

function videoData(db, evidenceId) {
  const e = db.prepare("SELECT * FROM evidences WHERE id = ?").get(Number(evidenceId));
  if (!e) return null;
  const c = db.prepare("SELECT * FROM creators WHERE discord_id = ?").get(e.discord_id);
  const d = db.prepare("SELECT username, global_name FROM discord_users WHERE id = ?").get(e.discord_id);
  const meta = (() => { try { return e.auto_meta ? JSON.parse(e.auto_meta) : {}; } catch { return {}; } })();
  const likes = db.prepare("SELECT COUNT(*) AS n FROM video_likes WHERE evidence_id = ?").get(e.id).n;
  return { e, c, d, meta, likes };
}

function thumbnailOf(cfg, e, meta) {
  const yt = youtubeId(e.url);
  if (yt) return `https://i.ytimg.com/vi/${yt}/hqdefault.jpg`;
  if (meta.thumbnail) return meta.thumbnail;
  return `${cfg.siteUrl}/img/og.jpg`;
}

// Mensaje público compacto (en inglés: Discord no deja mostrar un texto distinto a cada persona).
// Creador con su foto, título del video, una línea con red · vistas · fecha y la miniatura grande.
export function buildVideoMessage(cfg, data, avatarUrl) {
  const { e, c, d, meta, likes } = data;
  const plat = PLATFORM[e.platform] || PLATFORM.Otra;
  const name = safe(c?.roblox_display || c?.roblox_name || d?.global_name || d?.username || "Creator", 40);
  const title = safe(e.title || meta.title || (e.kind === "live" ? "Sky Eggs livestream" : "Sky Eggs video"), 200);
  const published = Date.parse(`${e.published_on}T12:00:00-05:00`);
  const embed = {
    author: { name: `${name} ${e.kind === "live" ? "went live" : "posted a new video"}`, ...(c?.roblox_user_id ? { url: `https://www.roblox.com/users/${c.roblox_user_id}/profile` } : {}), ...(avatarUrl ? { icon_url: avatarUrl } : {}) },
    title: `${e.kind === "live" ? "🔴 " : ""}${title}`,
    url: e.url,
    description: [`${plat.emoji} ${e.platform}`, `👀 **${short(e.views)}** views`, Number.isFinite(published) ? `<t:${Math.floor(published / 1000)}:R>` : null].filter(Boolean).join(" · "),
    color: plat.color,
    image: { url: thumbnailOf(cfg, e, meta) },
    footer: { text: "Sky Eggs · Creators" },
  };
  const buttons = [linkButton(e.kind === "live" ? "Watch live" : "Watch", e.url, "▶️")];
  if (interactionsEnabled(cfg)) {
    buttons.push(actionButton(likes ? String(likes) : "Like", `vlike:${e.id}`, 2, "❤️"));
    buttons.push(actionButton(`More from ${name}`.slice(0, 80), `vstats:${e.id}`, 2, "📺"));
    if (isSnowflake(cfg.discord.videoPingRole)) buttons.push(actionButton("Video alerts on/off", "vping", 2, "🔔"));
  }
  buttons.push(linkButton("Play Sky Eggs", gameUrl(cfg), "🎮"));
  return { embeds: [embed], components: [row(...buttons.slice(0, 5))] };
}

// Publica el anuncio (una sola vez por evidencia). Nunca lanza.
export async function announceVideo(db, cfg, evidenceId, fetchImpl = fetch, log = console) {
  try {
    if (!botEnabled(cfg) || !isSnowflake(cfg.discord.videoChannel)) return { sent: false, reason: "off" };
    const data = videoData(db, evidenceId);
    if (!data || data.e.status !== "approved") return { sent: false, reason: "not_approved" };
    if (data.e.announce_msg) return { sent: false, reason: "done" };
    let avatarUrl = null;
    if (data.c?.roblox_user_id) {
      try { avatarUrl = (await avatars([data.c.roblox_user_id], { fetchImpl, timeoutMs: cfg.robloxTimeoutMs })).get(data.c.roblox_user_id) || null; } catch { /* sin foto */ }
    }
    const payload = buildVideoMessage(cfg, data, avatarUrl);
    const ping = isSnowflake(cfg.discord.videoPingRole) ? cfg.discord.videoPingRole : null;
    if (ping) payload.content = `<@&${ping}> 🎬 New Sky Eggs ${data.e.kind === "live" ? "livestream" : "video"}!`;
    payload.allowed_mentions = { parse: [], roles: ping ? [ping] : [] };
    const r = await sendMessage(cfg, cfg.discord.videoChannel, payload, { fetchImpl });
    if (!r.ok) {
      db.prepare("UPDATE evidences SET announce_error = ? WHERE id = ?").run(`${r.status} ${r.body?.message || ""}`.slice(0, 200), data.e.id);
      log.warn(`[videos] no se pudo anunciar la evidencia ${data.e.id}: ${r.status} ${r.body?.message || ""}`);
      return { sent: false, reason: `http_${r.status}` };
    }
    db.prepare("UPDATE evidences SET announce_channel = ?, announce_msg = ?, announce_views = ?, announce_error = NULL WHERE id = ?")
      .run(cfg.discord.videoChannel, r.body.id, data.e.views, data.e.id);
    return { sent: true, messageId: r.body.id };
  } catch (err) {
    log.warn(`[videos] ${err.message}`);
    return { sent: false, reason: err.message };
  }
}

// Reenviar (para probar cambios): borra el anuncio anterior y publica de nuevo con el formato actual.
export async function resendVideo(db, cfg, evidenceId, fetchImpl = fetch, log = console) {
  const e = db.prepare("SELECT id, announce_channel, announce_msg FROM evidences WHERE id = ?").get(Number(evidenceId));
  if (!e) return { sent: false, reason: "not_found" };
  if (e.announce_msg && e.announce_channel) await deleteMessage(cfg, e.announce_channel, e.announce_msg, { fetchImpl });
  db.prepare("UPDATE evidences SET announce_msg = NULL, announce_channel = NULL WHERE id = ?").run(e.id);
  return announceVideo(db, cfg, e.id, fetchImpl, log);
}

// Vuelve a pintar el anuncio (vistas nuevas o me gusta). Mantiene la foto del creador que ya tenía.
export async function refreshVideoMessage(db, cfg, evidenceId, fetchImpl = fetch, { force = false } = {}) {
  try {
    const data = videoData(db, evidenceId);
    if (!data?.e.announce_msg || !botEnabled(cfg)) return { ok: false };
    const prev = data.e.announce_views || 0;
    const grew = data.e.views - prev;
    if (!force && grew < Math.max(100, prev * 0.1)) return { ok: false, reason: "sin cambio" };
    let avatarUrl = null;
    if (data.c?.roblox_user_id) { try { avatarUrl = (await avatars([data.c.roblox_user_id], { fetchImpl, timeoutMs: cfg.robloxTimeoutMs })).get(data.c.roblox_user_id) || null; } catch { /* sin foto */ } }
    const r = await editMessage(cfg, data.e.announce_channel, data.e.announce_msg, buildVideoMessage(cfg, data, avatarUrl), { fetchImpl });
    if (r.ok) db.prepare("UPDATE evidences SET announce_views = ? WHERE id = ?").run(data.e.views, data.e.id);
    return { ok: r.ok };
  } catch { return { ok: false }; }
}

// ---------- Botones ----------
const T = {
  es: {
    liked: "❤️ ¡Gracias! Le diste me gusta a este video.", unliked: "💔 Quitaste tu me gusta.",
    stats: "📊 Más de este creador", rank: "Rango", week: "Vistas esta semana", total: "Vistas totales", videos: "Videos aprobados",
    socials: "Redes", latest: "Últimos videos", none: "No encontramos a este creador.",
    pingOn: "🔔 Listo: te avisaremos de cada video nuevo.", pingOff: "🔕 Ya no te avisaremos de los videos nuevos.", pingErr: "No pude cambiar tu rol (avísale a un admin).",
    join: "¿Quieres salir aquí? Aplica al programa de creadores:",
  },
  en: {
    liked: "❤️ Thanks! You liked this video.", unliked: "💔 You removed your like.",
    stats: "📊 More from this creator", rank: "Rank", week: "Views this week", total: "Total views", videos: "Approved videos",
    socials: "Socials", latest: "Latest videos", none: "We couldn't find this creator.",
    pingOn: "🔔 Done: we'll ping you for every new video.", pingOff: "🔕 We won't ping you for new videos anymore.", pingErr: "I couldn't change your role (tell an admin).",
    join: "Want to be featured here? Apply to the creator program:",
  },
  pt: {
    liked: "❤️ Valeu! Você curtiu este vídeo.", unliked: "💔 Você removeu sua curtida.",
    stats: "📊 Mais deste criador", rank: "Nível", week: "Views nesta semana", total: "Views totais", videos: "Vídeos aprovados",
    socials: "Redes", latest: "Últimos vídeos", none: "Não encontramos este criador.",
    pingOn: "🔔 Pronto: vamos te avisar de cada vídeo novo.", pingOff: "🔕 Não vamos mais te avisar dos vídeos novos.", pingErr: "Não consegui mudar seu cargo (avise um admin).",
    join: "Quer aparecer aqui? Inscreva-se no programa de criadores:",
  },
};

export async function handleVideoButton(db, cfg, interaction, fetchImpl = fetch) {
  const [action, rawId] = String(interaction.data?.custom_id || "").split(":");
  const lang = langOf(interaction.locale);
  const t = T[lang];
  const userId = interaction.member?.user?.id || interaction.user?.id;
  if (action === "vping") {
    const r = await toggleRole(cfg, interaction.member, cfg.discord.videoPingRole, fetchImpl);
    return ephemeral(r.ok ? (r.added ? t.pingOn : t.pingOff) : t.pingErr);
  }
  const data = videoData(db, rawId);
  if (!data) return ephemeral(t.none);
  if (action === "vlike") {
    const had = db.prepare("SELECT 1 FROM video_likes WHERE evidence_id = ? AND discord_id = ?").get(data.e.id, String(userId));
    if (had) db.prepare("DELETE FROM video_likes WHERE evidence_id = ? AND discord_id = ?").run(data.e.id, String(userId));
    else db.prepare("INSERT OR IGNORE INTO video_likes (evidence_id, discord_id, at) VALUES (?, ?, ?)").run(data.e.id, String(userId), Date.now());
    // Se actualiza el contador del botón en el mismo mensaje; la confirmación llega aparte (privada).
    const fresh = videoData(db, data.e.id);
    const avatarUrl = interaction.message?.embeds?.[0]?.thumbnail?.url || null;
    const msg = buildVideoMessage(cfg, fresh, avatarUrl);
    return { type: REPLY.UPDATE, data: { embeds: msg.embeds, components: msg.components }, followup: had ? t.unliked : t.liked };
  }
  if (action === "vstats") {
    const id = data.e.discord_id;
    const sum = (where, ...args) => db.prepare(`SELECT COALESCE(SUM(views),0) AS v, COUNT(*) AS n FROM evidences WHERE discord_id = ? AND status = 'approved' ${where}`).get(id, ...args);
    const total = sum("");
    const week = sum("AND week = ?", data.e.week);
    const latest = db.prepare("SELECT title, url, platform, views FROM evidences WHERE discord_id = ? AND status = 'approved' ORDER BY published_on DESC, id DESC LIMIT 5").all(id);
    const app = db.prepare("SELECT platforms FROM applications WHERE discord_id = ? ORDER BY (status = 'approved') DESC, id DESC LIMIT 1").get(id);
    const socials = (() => { try { return JSON.parse(app?.platforms || "[]"); } catch { return []; } })().filter((p) => /^https?:\/\//.test(p.url)).slice(0, 6);
    const name = safe(data.c?.roblox_display || data.c?.roblox_name || "Creador", 40);
    const embed = {
      title: `${t.stats}: ${name}`, color: 0x4fb4ff, ...(data.c?.roblox_user_id ? { url: `https://www.roblox.com/users/${data.c.roblox_user_id}/profile` } : {}),
      fields: [
        { name: t.week, value: short(week.v), inline: true },
        { name: t.total, value: short(total.v), inline: true },
        { name: t.videos, value: String(total.n), inline: true },
        ...(socials.length ? [{ name: t.socials, value: socials.map((p) => `[${safe(p.type, 20)}](${p.url})${p.followers ? ` · ${short(p.followers)}` : ""}`).join("\n").slice(0, 1000), inline: false }] : []),
        ...(latest.length ? [{ name: t.latest, value: latest.map((v) => `• [${safe(v.title || v.platform, 60)}](${v.url}) · ${short(v.views)} 👀`).join("\n").slice(0, 1000), inline: false }] : []),
      ],
      footer: { text: `${t.join} ${cfg.siteUrl}/creadores/` },
    };
    return ephemeral(undefined, [embed]);
  }
  return ephemeral(t.none);
}
