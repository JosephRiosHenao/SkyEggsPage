// Alertas de huevos ABSURDOS en Discord con el bot (reemplaza al webhook del Worker de Cloudflare).
// El juego manda POST /api/game/egg-alert cuando nace un absurdo y /api/game/egg-alert/update cuando
// alguien lo agarra o desaparece. El bot publica en DISCORD_EGG_CHANNEL con ping a @Egg Ping:
//  - Imagen del huevo subida como adjunto desde la caché de la página (assets.js): siempre carga.
//  - Texto en el idioma del servidor (DISCORD_EGG_LANG) con una línea en inglés; los nombres (huevo,
//    rareza, isla) vienen ya traducidos por el juego con su tabla de localización.
//  - Botones: 🚪 Unirse al servidor · 🏃 ¡Voy! (contador) · 🌐 En mi idioma (respuesta privada en el
//    idioma de cada persona) · 📊 Estadísticas · 🔔 Egg Ping (se pone o quita el rol).
//  - Cuando alguien lo agarra, el mensaje cambia: quién, en cuánto tiempo, y se quita "Unirse".
import { assetImage } from "./assets.js";
import { sendMessage, editMessage, interactionsEnabled, linkButton, actionButton, row, ephemeral, short, safe, isSnowflake, langOf, toggleRole, REPLY } from "./bot.js";
import { botEnabled } from "./discord.js";

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
const str = (v, max = 60) => (typeof v === "string" ? v.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max) : "");

const T = {
  es: {
    title: "🥚 ¡Huevo {size} apareció!", grabbedTitle: "✅ ¡{who} agarró el huevo {size}!", goneTitle: "⌛ El huevo {size} desapareció",
    desc: "**{asset}** ({rarity}) acaba de aparecer en **{place}**. ¡Corre antes de que otro lo agarre!",
    grabbedDesc: "**{who}** agarró **{asset}** ({rarity}) en **{place}** después de **{time}**. ¡Suerte para el próximo!",
    goneDesc: "Nadie alcanzó a agarrar **{asset}** en **{place}** (duró {time}).",
    egg: "🥚 Huevo", rarity: "✨ Rareza", place: "📍 Isla", weight: "⚖️ Peso", value: "💰 Valor", when: "⏱️ Apareció", server: "🖥️ Servidor",
    going: "🏃 Van en camino", today: "📈 Absurdos hoy", odds: "🎲 Probabilidad", oddsValue: "1 en 500.000",
    join: "Unirse al servidor", goBtn: "¡Voy!", langBtn: "En mi idioma", statsBtn: "Estadísticas", pingBtn: "Egg Ping", studio: "🧪 Prueba en Studio",
    content: "¡Huevo ABSURDO en {place}!", footer: "Sky Eggs · Alertas de huevos",
    goingOn: "🏃 ¡Anotado! Avisamos que vas en camino.", goingOff: "Quitamos tu \"¡Voy!\".", ended: "Ese huevo ya no está.",
    pingOn: "🔔 Listo: te avisaremos de cada huevo absurdo.", pingOff: "🔕 Ya no te avisaremos de los huevos absurdos.", pingErr: "No pude cambiar tu rol (avísale a un admin).",
    statsTitle: "📊 Huevos absurdos", last24: "Últimas 24 h", last7: "Últimos 7 días", grabbedPct: "Agarrados", avgTime: "Tiempo medio hasta que lo agarran",
    topIsland: "Isla con más absurdos (7 días)", latest: "Últimos absurdos", none: "Todavía no hay alertas.", st: { active: "🟢 en el mapa", grabbed: "✅ agarrado", gone: "⌛ se fue" },
  },
  en: {
    title: "🥚 {size} egg spawned!", grabbedTitle: "✅ {who} grabbed the {size} egg!", goneTitle: "⌛ The {size} egg is gone",
    desc: "**{asset}** ({rarity}) just spawned on **{place}**. Run before someone else grabs it!",
    grabbedDesc: "**{who}** grabbed **{asset}** ({rarity}) on **{place}** after **{time}**. Good luck next time!",
    goneDesc: "Nobody grabbed **{asset}** on **{place}** in time (it lasted {time}).",
    egg: "🥚 Egg", rarity: "✨ Rarity", place: "📍 Island", weight: "⚖️ Weight", value: "💰 Value", when: "⏱️ Spawned", server: "🖥️ Server",
    going: "🏃 On their way", today: "📈 Absurd eggs today", odds: "🎲 Odds", oddsValue: "1 in 500,000",
    join: "Join server", goBtn: "On my way!", langBtn: "My language", statsBtn: "Stats", pingBtn: "Egg Ping", studio: "🧪 Studio test",
    content: "ABSURD egg on {place}!", footer: "Sky Eggs · Egg alerts",
    goingOn: "🏃 Got it! Everyone knows you're on your way.", goingOff: "Removed your \"On my way!\".", ended: "That egg is gone.",
    pingOn: "🔔 Done: we'll ping you for every absurd egg.", pingOff: "🔕 We won't ping you for absurd eggs anymore.", pingErr: "I couldn't change your role (tell an admin).",
    statsTitle: "📊 Absurd eggs", last24: "Last 24 h", last7: "Last 7 days", grabbedPct: "Grabbed", avgTime: "Average time until grabbed",
    topIsland: "Island with most absurd eggs (7 days)", latest: "Latest absurd eggs", none: "No alerts yet.", st: { active: "🟢 on the map", grabbed: "✅ grabbed", gone: "⌛ gone" },
  },
  pt: {
    title: "🥚 Ovo {size} apareceu!", grabbedTitle: "✅ {who} pegou o ovo {size}!", goneTitle: "⌛ O ovo {size} sumiu",
    desc: "**{asset}** ({rarity}) acabou de aparecer em **{place}**. Corra antes que alguém pegue!",
    grabbedDesc: "**{who}** pegou **{asset}** ({rarity}) em **{place}** depois de **{time}**. Boa sorte no próximo!",
    goneDesc: "Ninguém conseguiu pegar **{asset}** em **{place}** (durou {time}).",
    egg: "🥚 Ovo", rarity: "✨ Raridade", place: "📍 Ilha", weight: "⚖️ Peso", value: "💰 Valor", when: "⏱️ Apareceu", server: "🖥️ Servidor",
    going: "🏃 A caminho", today: "📈 Absurdos hoje", odds: "🎲 Chance", oddsValue: "1 em 500.000",
    join: "Entrar no servidor", goBtn: "Tô indo!", langBtn: "No meu idioma", statsBtn: "Estatísticas", pingBtn: "Egg Ping", studio: "🧪 Teste no Studio",
    content: "Ovo ABSURDO em {place}!", footer: "Sky Eggs · Alertas de ovos",
    goingOn: "🏃 Anotado! Todos sabem que você está a caminho.", goingOff: "Removemos seu \"Tô indo!\".", ended: "Esse ovo já sumiu.",
    pingOn: "🔔 Pronto: vamos te avisar de cada ovo absurdo.", pingOff: "🔕 Não vamos mais te avisar dos ovos absurdos.", pingErr: "Não consegui mudar seu cargo (avise um admin).",
    statsTitle: "📊 Ovos absurdos", last24: "Últimas 24 h", last7: "Últimos 7 dias", grabbedPct: "Pegos", avgTime: "Tempo médio até pegarem",
    topIsland: "Ilha com mais absurdos (7 dias)", latest: "Últimos absurdos", none: "Ainda não há alertas.", st: { active: "🟢 no mapa", grabbed: "✅ pego", gone: "⌛ sumiu" },
  },
};
const SIZE = { es: "ABSURDO", en: "ABSURD", pt: "ABSURDO" };
const fill = (tpl, vars) => tpl.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ""));
function duration(ms, lang) {
  const s = Math.max(1, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

// Nombres en un idioma: lo que mandó el juego traducido o, si no, el nombre en inglés / interno.
function namesFor(a, lang) {
  let i18n = {};
  try { i18n = a.i18n ? JSON.parse(a.i18n) : {}; } catch { i18n = {}; }
  const pick = (k, fallback) => str(i18n[lang]?.[k], 60) || str(i18n.en?.[k], 60) || fallback;
  return { asset: safe(pick("asset", a.asset), 60), rarity: safe(pick("rarity", a.rarity || "—"), 30), place: safe(pick("place", a.place || "—"), 40) };
}
const joinUrl = (a) => (!a.studio && a.place_id && a.job_id ? `https://www.roblox.com/games/start?placeId=${a.place_id}&gameInstanceId=${encodeURIComponent(a.job_id)}` : null);

function goingCount(db, id) { return db.prepare("SELECT COUNT(*) AS n FROM egg_going WHERE alert_id = ?").get(id).n; }
function todayCount(db, now = Date.now()) {
  const start = new Date(now - 5 * 3600_000); start.setUTCHours(0, 0, 0, 0); // día de Colombia (UTC-5)
  return db.prepare("SELECT COUNT(*) AS n FROM egg_alerts WHERE studio = 0 AND created_at >= ?").get(start.getTime() + 5 * 3600_000).n;
}

// Embed + botones de una alerta en un idioma. second = idioma de la línea pequeña de abajo (o null).
export function buildEggMessage(db, cfg, a, lang, { second = "en", withImage = true, privateCopy = false } = {}) {
  const t = T[lang] || T.en;
  const n = namesFor(a, lang);
  const size = SIZE[lang] || SIZE.en;
  const created = Math.floor(a.created_at / 1000);
  const going = goingCount(db, a.id);
  const url = a.status === "active" ? joinUrl(a) : null;
  const vars = { ...n, size, who: safe(a.grabbed_by_name || "?", 40), time: a.ended_at ? duration(a.ended_at - a.created_at, lang) : "" };
  const head = a.status === "grabbed" ? t.grabbedTitle : a.status === "gone" ? t.goneTitle : t.title;
  const body = a.status === "grabbed" ? t.grabbedDesc : a.status === "gone" ? t.goneDesc : t.desc;
  let description = fill(body, vars);
  if (second && second !== lang && T[second]) {
    const n2 = namesFor(a, second);
    description += `\n-# ${fill(a.status === "grabbed" ? T[second].grabbedDesc : a.status === "gone" ? T[second].goneDesc : T[second].desc, { ...n2, size: SIZE[second], who: vars.who, time: vars.time }).replace(/\*\*/g, "")}`;
  }
  if (url) description += `\n🚪 [${t.join}](${url})`;
  const fields = [
    { name: t.egg, value: `**${n.asset}**`, inline: true },
    { name: t.rarity, value: n.rarity, inline: true },
    { name: t.place, value: n.place, inline: true },
    { name: t.weight, value: `${Math.round(a.weight || 0).toLocaleString("es-CO")} kg`, inline: true },
  ];
  if (a.value > 0) fields.push({ name: t.value, value: `$${short(a.value)}`, inline: true });
  fields.push({ name: t.when, value: `<t:${created}:R>\n<t:${created}:t>`, inline: true });
  fields.push({ name: t.server, value: a.studio ? t.studio : `👥 ${a.players ?? "?"}/${a.max_players ?? "?"}\n\`${safe(String(a.job_id || "").slice(0, 8), 8)}\``, inline: true });
  if (going) fields.push({ name: t.going, value: `**${going}**`, inline: true });
  fields.push({ name: t.odds, value: t.oddsValue, inline: true });
  const embed = {
    author: { name: t.footer },
    title: `${a.studio ? "[STUDIO] " : ""}${fill(head, vars)}`,
    ...(url ? { url } : {}),
    description,
    color: a.status === "grabbed" ? 0x3fc35a : a.status === "gone" ? 0x6a77a8 : 0xfacc15,
    fields,
    footer: { text: `${t.footer} · #${a.id}` },
    timestamp: new Date(a.created_at).toISOString(),
  };
  if (withImage && a.image) embed.image = { url: a.image };
  const components = [];
  const first = [url ? linkButton(t.join, url, "🚪") : null];
  if (interactionsEnabled(cfg) && !privateCopy) {
    first.push(actionButton(going ? `${t.goBtn} · ${going}` : t.goBtn, `egoing:${a.id}`, 3, "🏃", a.status !== "active"));
    components.push(row(...first));
    components.push(row(
      actionButton(t.langBtn, `elang:${a.id}`, 2, "🌐"),
      actionButton(t.statsBtn, "estats", 2, "📊"),
      isSnowflake(cfg.discord.eggPingRole) ? actionButton(t.pingBtn, "eping", 2, "🔔") : null,
    ));
  } else if (first[0]) components.push(row(...first));
  return { embeds: [embed], components: components.filter((r) => r.components.length) };
}

function rowById(db, id) { return db.prepare("SELECT * FROM egg_alerts WHERE id = ?").get(Number(id)); }
const withImage = (a) => ({ ...a, image: a.image_url ? "attachment://egg.png" : null });

// El juego avisa de un absurdo. Guarda y publica. Devuelve { ok, id }.
export async function receiveEggAlert(db, cfg, body, fetchImpl = fetch, log = console, now = Date.now()) {
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
  const img = a.icon_id ? await assetImage(db, cfg, a.icon_id, fetchImpl).catch(() => null) : null;
  const lang = T[cfg.discord.eggLang] ? cfg.discord.eggLang : "es";
  const payload = buildEggMessage(db, cfg, { ...a, image: img ? "attachment://egg.png" : null }, lang);
  const n = namesFor(a, lang);
  const ping = isSnowflake(cfg.discord.eggPingRole) ? cfg.discord.eggPingRole : null;
  payload.content = `${ping ? `<@&${ping}> ` : ""}🥚 ${fill(T[lang].content, n)}`;
  payload.allowed_mentions = { parse: [], roles: ping ? [ping] : [] };
  const files = img ? [{ name: "egg.png", bytes: img.bytes, type: img.type }] : [];
  if (img) payload.attachments = [{ id: 0, filename: "egg.png" }];
  const r = await sendMessage(cfg, cfg.discord.eggChannel, payload, { files, fetchImpl });
  if (!r.ok) {
    db.prepare("UPDATE egg_alerts SET post_error = ? WHERE id = ?").run(`${r.status} ${r.body?.message || ""}`.slice(0, 200), id);
    log.warn(`[huevos] no se pudo publicar la alerta ${id}: ${r.status} ${r.body?.message || ""}`);
    return { sent: false, reason: `http_${r.status}` };
  }
  // Guardamos el id del adjunto para conservar la imagen al editar el mensaje.
  const att = r.body?.attachments?.[0]?.id || null;
  db.prepare("UPDATE egg_alerts SET channel_id = ?, message_id = ?, image_url = ?, post_error = NULL WHERE id = ?").run(cfg.discord.eggChannel, r.body.id, att, id);
  return { sent: true, messageId: r.body.id };
}

// Vuelve a pintar la alerta pública (agarrado, se fue, "¡Voy!").
export async function refreshEggMessage(db, cfg, id, fetchImpl = fetch) {
  const a = rowById(db, id);
  if (!a?.message_id) return { ok: false };
  const lang = T[cfg.discord.eggLang] ? cfg.discord.eggLang : "es";
  const payload = buildEggMessage(db, cfg, withImage(a), lang);
  if (a.image_url) payload.attachments = [{ id: a.image_url }];
  const r = await editMessage(cfg, a.channel_id, a.message_id, payload, { fetchImpl });
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

// Servidor que se cerró: sus alertas activas de hace más de 2 h pasan a "se fue".
export function expireOldAlerts(db, now = Date.now()) {
  return db.prepare("SELECT id FROM egg_alerts WHERE status = 'active' AND created_at < ?").all(now - 2 * 3600_000).map((r) => {
    db.prepare("UPDATE egg_alerts SET status = 'gone', ended_at = ? WHERE id = ?").run(now, r.id);
    return r.id;
  });
}

function statsEmbed(db, lang, now = Date.now()) {
  const t = T[lang];
  const q = (sql, ...args) => db.prepare(sql).get(...args);
  const d1 = q("SELECT COUNT(*) AS n FROM egg_alerts WHERE studio = 0 AND created_at >= ?", now - 86_400_000).n;
  const d7 = q("SELECT COUNT(*) AS n, SUM(status = 'grabbed') AS g, AVG(CASE WHEN status = 'grabbed' THEN ended_at - created_at END) AS avg FROM egg_alerts WHERE studio = 0 AND created_at >= ?", now - 7 * 86_400_000);
  const top = q("SELECT place, COUNT(*) AS n FROM egg_alerts WHERE studio = 0 AND created_at >= ? GROUP BY place ORDER BY n DESC LIMIT 1", now - 7 * 86_400_000);
  const latest = db.prepare("SELECT * FROM egg_alerts WHERE studio = 0 ORDER BY id DESC LIMIT 5").all();
  if (!latest.length) return { title: t.statsTitle, description: t.none, color: 0xfacc15 };
  const topName = top ? namesFor(db.prepare("SELECT * FROM egg_alerts WHERE studio = 0 AND place = ? ORDER BY id DESC LIMIT 1").get(top.place), lang).place : "—";
  return {
    title: t.statsTitle, color: 0xfacc15,
    fields: [
      { name: t.last24, value: String(d1), inline: true },
      { name: t.last7, value: String(d7.n), inline: true },
      { name: t.grabbedPct, value: d7.n ? `${Math.round(((d7.g || 0) / d7.n) * 100)}%` : "—", inline: true },
      { name: t.avgTime, value: d7.avg ? duration(d7.avg, lang) : "—", inline: true },
      { name: t.topIsland, value: top ? `${topName} (${top.n})` : "—", inline: true },
      { name: t.latest, value: latest.map((a) => { const n = namesFor(a, lang); return `• **${n.asset}** · ${n.place} · <t:${Math.floor(a.created_at / 1000)}:R> · ${t.st[a.status]}${a.grabbed_by_name ? ` (${safe(a.grabbed_by_name, 30)})` : ""}`; }).join("\n").slice(0, 1000), inline: false },
    ],
  };
}

export async function handleEggButton(db, cfg, interaction, fetchImpl = fetch) {
  const [action, rawId] = String(interaction.data?.custom_id || "").split(":");
  const lang = langOf(interaction.locale);
  const t = T[lang];
  const userId = String(interaction.member?.user?.id || interaction.user?.id || "");
  if (action === "eping") {
    const r = await toggleRole(cfg, interaction.member, cfg.discord.eggPingRole, fetchImpl);
    return ephemeral(r.ok ? (r.added ? t.pingOn : t.pingOff) : t.pingErr);
  }
  if (action === "estats") return ephemeral(undefined, [statsEmbed(db, lang)]);
  const a = rowById(db, rawId);
  if (!a) return ephemeral(t.ended);
  if (action === "elang") {
    // Copia privada en el idioma de quien tocó (con la imagen del mensaje público).
    const imgUrl = interaction.message?.embeds?.[0]?.image?.url || null;
    const msg = buildEggMessage(db, cfg, { ...a, image: imgUrl }, lang, { second: null, privateCopy: true });
    return { type: REPLY.MESSAGE, data: { ...msg, flags: 64, allowed_mentions: { parse: [] } } };
  }
  if (action === "egoing") {
    if (a.status !== "active") return ephemeral(t.ended);
    const had = db.prepare("SELECT 1 FROM egg_going WHERE alert_id = ? AND discord_id = ?").get(a.id, userId);
    if (had) db.prepare("DELETE FROM egg_going WHERE alert_id = ? AND discord_id = ?").run(a.id, userId);
    else db.prepare("INSERT OR IGNORE INTO egg_going (alert_id, discord_id) VALUES (?, ?)").run(a.id, userId);
    const fresh = rowById(db, a.id);
    const pubLang = T[cfg.discord.eggLang] ? cfg.discord.eggLang : "es";
    const msg = buildEggMessage(db, cfg, withImage(fresh), pubLang);
    return { type: REPLY.UPDATE, data: { embeds: msg.embeds, components: msg.components, ...(fresh.image_url ? { attachments: [{ id: fresh.image_url }] } : {}) }, followup: had ? t.goingOff : t.goingOn };
  }
  return ephemeral(t.ended);
}

export const eggTexts = T;
export { todayCount };
