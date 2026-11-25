// Alertas de huevos ABSURDOS en Discord con el bot (reemplaza al webhook del Worker de Cloudflare).
// El juego manda POST /api/game/egg-alert cuando nace un absurdo y /api/game/egg-alert/update cuando
// alguien lo agarra o desaparece. El bot publica en DISCORD_EGG_CHANNEL con ping a @Egg Ping.
//
// Formato (2026-11-24, pedido del dueño: compacto y bonito):
//  - Texto público en inglés (Discord no deja mostrar un mensaje distinto a cada persona); las respuestas
//    de los botones salen en el idioma del Discord de quien toca (es / pt / en).
//  - Solo lo importante: huevo, rareza, peso, isla, jugadores del servidor y hace cuánto. Ícono del huevo
//    dentro del mensaje (miniatura servida por la página), no como imagen adjunta.
//  - Botones: 🚪 Unirse (cuenta a los que van y comprueba en ese momento si hay espacio en el servidor:
//    responde en privado con el enlace o "lleno") y 🔔 Egg Ping (pone o quita el rol).
//  - Cuando alguien lo agarra: "✅ Grabbed by X" y cuánto duró. Si el servidor cierra: "⌛ Despawned".
import { assetImage } from "./assets.js";
import { sendMessage, editMessage, deleteMessage, interactionsEnabled, linkButton, actionButton, row, ephemeral, safe, isSnowflake, langOf, toggleRole } from "./bot.js";
import { botEnabled } from "./discord.js";

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
const str = (v, max = 60) => (typeof v === "string" ? v.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max) : "");
const LIVE_MS = 3 * 60_000; // un servidor manda /pull cada ~60 s: si pasan 3 min sin noticias, cerró

// Respuestas privadas de los botones (idioma de quien toca).
const T = {
  en: {
    room: "🟢 **There's room!** ({players}/{max} players). Tap to join:", open: "Join in Roblox",
    full: "🔴 That server is **full** right now ({players}/{max}). Try again in a moment!",
    closed: "⌛ That server already **closed**. Wait for the next absurd egg!", ended: "⌛ That egg is gone. Wait for the next one!",
    studio: "🧪 This was a test from Studio: there's no server to join.",
    pingOn: "🔔 **Egg Ping on**: we'll ping you for every absurd egg.", pingOff: "🔕 **Egg Ping off**: no more pings for absurd eggs.",
    pingErr: "I couldn't change your role. Tell an admin.", old: "This button is no longer used.",
  },
  es: {
    room: "🟢 **¡Hay espacio!** ({players}/{max} jugadores). Toca para unirte:", open: "Unirme en Roblox",
    full: "🔴 Ese servidor está **lleno** ahora mismo ({players}/{max}). ¡Inténtalo en un momento!",
    closed: "⌛ Ese servidor ya **cerró**. ¡Espera el próximo huevo absurdo!", ended: "⌛ Ese huevo ya no está. ¡Espera el próximo!",
    studio: "🧪 Fue una prueba desde Studio: no hay servidor al que unirse.",
    pingOn: "🔔 **Egg Ping activado**: te avisaremos de cada huevo absurdo.", pingOff: "🔕 **Egg Ping desactivado**: ya no te avisaremos.",
    pingErr: "No pude cambiar tu rol. Avísale a un admin.", old: "Este botón ya no se usa.",
  },
  pt: {
    room: "🟢 **Tem vaga!** ({players}/{max} jogadores). Toque para entrar:", open: "Entrar no Roblox",
    full: "🔴 Esse servidor está **cheio** agora ({players}/{max}). Tente de novo em instantes!",
    closed: "⌛ Esse servidor já **fechou**. Espere o próximo ovo absurdo!", ended: "⌛ Esse ovo já sumiu. Espere o próximo!",
    studio: "🧪 Foi um teste no Studio: não há servidor para entrar.",
    pingOn: "🔔 **Egg Ping ativado**: vamos te avisar de cada ovo absurdo.", pingOff: "🔕 **Egg Ping desativado**: sem mais avisos.",
    pingErr: "Não consegui mudar seu cargo. Avise um admin.", old: "Este botão não é mais usado.",
  },
};
const fill = (tpl, vars) => tpl.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ""));
function duration(ms) {
  const s = Math.max(1, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}
const RARITY_EMOJI = { Common: "⚪", Uncommon: "🟢", Rare: "🔵", Epic: "🟣", Legendary: "🟡", Mythic: "🔴", Limited: "🎃" };

// Nombres en inglés (los manda el juego; si no, el nombre interno).
function names(a) {
  let i18n = {};
  try { i18n = a.i18n ? JSON.parse(a.i18n) : {}; } catch { i18n = {}; }
  return { asset: safe(str(i18n.en?.asset) || a.asset, 60), rarity: safe(str(i18n.en?.rarity, 30) || a.rarity || "", 30), place: safe(str(i18n.en?.place, 40) || a.place || "the map", 40) };
}
const joinUrl = (a) => (!a.studio && a.place_id && a.job_id ? `https://www.roblox.com/games/start?placeId=${a.place_id}&gameInstanceId=${encodeURIComponent(a.job_id)}` : null);
const goingCount = (db, id) => db.prepare("SELECT COUNT(*) AS n FROM egg_going WHERE alert_id = ?").get(id).n;
const iconUrl = (db, cfg, a) => (a.icon_id && db.prepare("SELECT 1 FROM game_assets WHERE asset_id = ? AND file IS NOT NULL").get(a.icon_id) ? `${cfg.siteUrl}/api/media/asset/${a.icon_id}` : null);

// Jugadores del servidor ahora (último /pull) o los que había al nacer el huevo.
export function serverState(db, a, now = Date.now()) {
  const max = a.max_players || null;
  if (a.studio) return { open: false, studio: true, players: a.players, max };
  const live = a.job_id ? db.prepare("SELECT players, last_pull FROM live_servers WHERE job_id = ?").get(a.job_id) : null;
  if (live && now - live.last_pull > LIVE_MS) return { open: false, closed: true, players: 0, max };
  const players = live ? live.players : a.players;
  return { open: true, players, max, full: Boolean(max && players >= max) };
}

// Mensaje público (inglés, compacto).
export function buildEggMessage(db, cfg, a, now = Date.now()) {
  const n = names(a);
  const created = Math.floor(a.created_at / 1000);
  const icon = iconUrl(db, cfg, a);
  const kg = `${Math.round(a.weight || 0).toLocaleString("en-US")} kg`;
  const rarity = n.rarity ? `${RARITY_EMOJI[n.rarity] || "✨"} ${n.rarity}` : null;
  const embed = { color: 0xfacc15, footer: { text: "Sky Eggs · Egg alerts" }, timestamp: new Date(a.created_at).toISOString() };
  if (icon) embed.thumbnail = { url: icon };
  const components = [];
  if (a.status === "active") {
    const st = serverState(db, a, now);
    const going = goingCount(db, a.id);
    embed.title = `${a.studio ? "🧪 [TEST] " : ""}🥚 ${n.asset}`;
    embed.description = [
      [rarity, `⚖️ **${kg}**`].filter(Boolean).join(" · "),
      `📍 **${n.place}** · ${st.studio ? "🧪 Studio" : st.closed ? "⌛ server closed" : `👥 **${st.players ?? "?"}/${st.max ?? "?"}**${st.full ? " (full)" : ""}`} · <t:${created}:R>`,
    ].join("\n");
    const url = joinUrl(a);
    if (interactionsEnabled(cfg)) {
      const label = st.closed ? "Server closed" : st.full ? `Server full · ${st.players}/${st.max}` : going ? `Join · ${going} going` : "Join server";
      components.push(row(
        actionButton(label, `ejoin:${a.id}`, st.full || st.closed ? 2 : 3, st.full ? "🔒" : "🚪", Boolean(st.studio || st.closed)),
        isSnowflake(cfg.discord.eggPingRole) ? actionButton("Egg Ping on/off", "eping", 2, "🔔") : null,
      ));
    } else if (url && !st.closed) components.push(row(linkButton("Join server", url, "🚪")));
  } else {
    const grabbed = a.status === "grabbed";
    embed.color = grabbed ? 0x3fc35a : 0x6a77a8;
    embed.title = grabbed ? `✅ Grabbed by ${safe(a.grabbed_by_name || "someone", 40)}` : "⌛ The egg despawned";
    embed.description = `🥚 **${n.asset}** · 📍 ${n.place}${a.ended_at ? ` · lasted ${duration(a.ended_at - a.created_at)}` : ""}`;
    if (interactionsEnabled(cfg) && isSnowflake(cfg.discord.eggPingRole)) components.push(row(actionButton("Egg Ping on/off", "eping", 2, "🔔")));
  }
  return { embeds: [embed], components };
}

function rowById(db, id) { return db.prepare("SELECT * FROM egg_alerts WHERE id = ?").get(Number(id)); }

// El juego avisa de un absurdo. Guarda y publica. Devuelve { ok, id }.
export async function receiveEggAlert(db, cfg, body, fetchImpl = fetch, log = console, now = Date.now()) {
  // Servidor privado (VIP) o reservado: nadie de Discord puede unirse, así que no se publica
  // (pedido del dueño 2026-11-24). El juego ya no las manda; esto cubre versiones viejas o pruebas.
  if (body?.privateServer === true) return { ok: true, skipped: "private_server" };
  const key = str(body?.key, 80) || `${str(body?.jobId, 60)}:${num(body?.t) || now}`;
  const existing = db.prepare("SELECT id FROM egg_alerts WHERE alert_key = ?").get(key);
  if (existing) return { ok: true, id: existing.id, duplicate: true };
  const iconId = Number(String(body?.iconId ?? "").match(/\d{5,20}/)?.[0]) || null;
  const i18n = {};
  for (const lang of ["en", "es", "pt"]) {
    const src = body?.i18n?.[lang];
    if (src && typeof src === "object") i18n[lang] = { asset: str(src.asset), rarity: str(src.rarity, 30), place: str(src.place, 40) };
  }
  const info = db.prepare(`INSERT INTO egg_alerts (alert_key, job_id, place_id, studio, asset, rarity, size, weight, value, place, icon_id, players, max_players, i18n, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(key, str(body?.jobId, 60) || null, num(body?.placeId), body?.studio === true ? 1 : 0,
    str(body?.asset) || "Egg", str(body?.rarity, 30) || null, str(body?.size, 20) || "absurdo", num(body?.weight), num(body?.value),
    str(body?.place, 40) || null, iconId, num(body?.players), num(body?.maxPlayers), JSON.stringify(i18n), now);
  const id = Number(info.lastInsertRowid);
  postEggAlert(db, cfg, id, fetchImpl, log).catch((e) => log.warn(`[huevos] ${e.message}`));
  return { ok: true, id };
}

export async function postEggAlert(db, cfg, id, fetchImpl = fetch, log = console) {
  const a = rowById(db, id);
  if (!a || a.message_id) return { sent: false };
  if (!botEnabled(cfg) || !isSnowflake(cfg.discord.eggChannel)) return { sent: false, reason: "off" };
  // Que el ícono esté guardado en la página antes de publicar (Discord lo pide al mostrar el mensaje).
  if (a.icon_id) await assetImage(db, cfg, a.icon_id, fetchImpl).catch(() => null);
  const payload = buildEggMessage(db, cfg, a);
  const n = names(a);
  const ping = isSnowflake(cfg.discord.eggPingRole) ? cfg.discord.eggPingRole : null;
  payload.content = `${ping ? `<@&${ping}> ` : ""}🥚 **ABSURD egg** on **${n.place}**!`;
  payload.allowed_mentions = { parse: [], roles: ping ? [ping] : [] };
  const r = await sendMessage(cfg, cfg.discord.eggChannel, payload, { fetchImpl });
  if (!r.ok) {
    db.prepare("UPDATE egg_alerts SET post_error = ? WHERE id = ?").run(`${r.status} ${r.body?.message || ""}`.slice(0, 200), id);
    log.warn(`[huevos] no se pudo publicar la alerta ${id}: ${r.status} ${r.body?.message || ""}`);
    return { sent: false, reason: `http_${r.status}` };
  }
  db.prepare("UPDATE egg_alerts SET channel_id = ?, message_id = ?, image_url = NULL, post_error = NULL WHERE id = ?").run(cfg.discord.eggChannel, r.body.id, id);
  return { sent: true, messageId: r.body.id };
}

// Reenviar (para probar cambios): borra el mensaje anterior y publica de nuevo con el formato actual.
export async function resendEggAlert(db, cfg, id, fetchImpl = fetch, log = console) {
  const a = rowById(db, id);
  if (!a) return { sent: false, reason: "not_found" };
  if (a.message_id && a.channel_id) await deleteMessage(cfg, a.channel_id, a.message_id, { fetchImpl });
  db.prepare("UPDATE egg_alerts SET message_id = NULL, channel_id = NULL WHERE id = ?").run(a.id);
  return postEggAlert(db, cfg, a.id, fetchImpl, log);
}

// Vuelve a pintar la alerta pública (agarrado, se fue, gente que va).
export async function refreshEggMessage(db, cfg, id, fetchImpl = fetch) {
  const a = rowById(db, id);
  if (!a?.message_id) return { ok: false };
  const r = await editMessage(cfg, a.channel_id, a.message_id, { ...buildEggMessage(db, cfg, a), attachments: [] }, { fetchImpl });
  return { ok: r.ok };
}

// El juego avisa de que alguien lo agarró (o de que desapareció).
export async function updateEggAlert(db, cfg, body, fetchImpl = fetch, now = Date.now()) {
  const a = db.prepare("SELECT * FROM egg_alerts WHERE alert_key = ?").get(str(body?.key, 80));
  if (!a) return { ok: false, error: "not_found" };
  if (a.status !== "active") return { ok: true, already: true };
  const status = body?.status === "grabbed" ? "grabbed" : "gone";
  const who = body?.by && typeof body.by === "object" ? (str(body.by.displayName, 40) || str(body.by.name, 40)) : "";
  db.prepare("UPDATE egg_alerts SET status = ?, grabbed_by_id = ?, grabbed_by_name = ?, ended_at = ? WHERE id = ?")
    .run(status, status === "grabbed" ? num(body?.by?.userId) : null, status === "grabbed" ? who || "?" : null, now, a.id);
  refreshEggMessage(db, cfg, a.id, fetchImpl).catch(() => {});
  return { ok: true };
}

// Alertas de servidores que ya cerraron (sin /pull hace rato) o muy viejas: pasan a "se fue".
export function expireOldAlerts(db, now = Date.now()) {
  return db.prepare(`SELECT a.id FROM egg_alerts a LEFT JOIN live_servers s ON s.job_id = a.job_id
    WHERE a.status = 'active' AND (a.created_at < ? OR (a.studio = 0 AND s.last_pull IS NOT NULL AND s.last_pull < ? AND a.created_at < ?))`)
    .all(now - 2 * 3600_000, now - 10 * 60_000, now - 10 * 60_000).map((r) => {
      db.prepare("UPDATE egg_alerts SET status = 'gone', ended_at = ? WHERE id = ?").run(now, r.id);
      return r.id;
    });
}

export async function handleEggButton(db, cfg, interaction, fetchImpl = fetch) {
  const [action, rawId] = String(interaction.data?.custom_id || "").split(":");
  const t = T[langOf(interaction.locale)];
  const userId = String(interaction.member?.user?.id || interaction.user?.id || "");
  if (action === "eping") {
    const r = await toggleRole(cfg, interaction.member, cfg.discord.eggPingRole, fetchImpl);
    return ephemeral(r.ok ? (r.added ? t.pingOn : t.pingOff) : t.pingErr);
  }
  if (action !== "ejoin" && action !== "egoing") return ephemeral(t.old);
  const a = rowById(db, rawId);
  if (!a || a.status !== "active") return ephemeral(t.ended);
  const st = serverState(db, a);
  if (st.studio) return ephemeral(t.studio);
  if (st.closed) { refreshEggMessage(db, cfg, a.id, fetchImpl).catch(() => {}); return ephemeral(t.closed); }
  if (st.full) { refreshEggMessage(db, cfg, a.id, fetchImpl).catch(() => {}); return ephemeral(fill(t.full, st)); }
  // Unirse = cuenta como "va en camino" (una vez por persona) + enlace privado para entrar.
  const added = db.prepare("INSERT OR IGNORE INTO egg_going (alert_id, discord_id) VALUES (?, ?)").run(a.id, userId).changes;
  if (added) refreshEggMessage(db, cfg, a.id, fetchImpl).catch(() => {});
  const url = joinUrl(a);
  return { type: 4, data: { content: fill(t.room, { players: st.players ?? "?", max: st.max ?? "?" }), components: url ? [row(linkButton(t.open, url, "🚪"))] : [], flags: 64, allowed_mentions: { parse: [] } } };
}
