// Bot de Discord por REST (sin gateway ni librerías): mensajes con adjuntos, edición, reacciones,
// roles de un miembro y botones (Interactions Endpoint URL con firma Ed25519).
// Lo usan los anuncios de videos aprobados (videos.js) y las alertas de huevos (eggAlerts.js).
import { createPublicKey, verify } from "node:crypto";
import { botEnabled } from "./discord.js";

const API = "https://discord.com/api/v10";
export const isSnowflake = (v) => /^\d{5,25}$/.test(String(v || ""));

// Llamada a la API de Discord. files = [{ name, bytes, type }] → multipart con payload_json.
// Reintenta una vez si Discord pide esperar (429). Devuelve { ok, status, body }. Nunca lanza.
export async function discordApi(cfg, method, path, body, { files = [], fetchImpl = fetch, reason } = {}) {
  if (!botEnabled(cfg)) return { ok: false, status: 0, body: { message: "bot_off" } };
  const headers = { authorization: `Bot ${cfg.discord.botToken}` };
  if (reason) headers["x-audit-log-reason"] = encodeURIComponent(String(reason).slice(0, 200));
  for (let attempt = 0; attempt < 2; attempt++) {
    let init = { method, headers: { ...headers } };
    if (files.length) {
      const form = new FormData();
      form.append("payload_json", JSON.stringify(body || {}));
      files.forEach((f, i) => form.append(`files[${i}]`, new Blob([f.bytes], { type: f.type || "application/octet-stream" }), f.name));
      init.body = form;
    } else if (body !== undefined) {
      init.headers["content-type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    try {
      const res = await fetchImpl(`${API}${path}`, { ...init, signal: AbortSignal.timeout(10_000) });
      const data = res.status === 204 ? null : await res.json().catch(() => null);
      if (res.status === 429 && attempt === 0) {
        await new Promise((r) => setTimeout(r, Math.min(5000, Math.ceil((data?.retry_after || 1) * 1000))));
        continue;
      }
      return { ok: res.ok, status: res.status, body: data };
    } catch (e) {
      return { ok: false, status: 0, body: { message: e.message } };
    }
  }
  return { ok: false, status: 429, body: { message: "rate_limited" } };
}

export const sendMessage = (cfg, channelId, payload, opts) => discordApi(cfg, "POST", `/channels/${channelId}/messages`, payload, opts);
export const editMessage = (cfg, channelId, messageId, payload, opts) => discordApi(cfg, "PATCH", `/channels/${channelId}/messages/${messageId}`, payload, opts);
export const deleteMessage = (cfg, channelId, messageId, opts) => discordApi(cfg, "DELETE", `/channels/${channelId}/messages/${messageId}`, undefined, opts);
export const addReaction = (cfg, channelId, messageId, emoji, opts) =>
  discordApi(cfg, "PUT", `/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}/@me`, undefined, opts);

// Pone o quita un rol a un miembro (para los botones "Avisarme").
export async function toggleRole(cfg, member, roleId, fetchImpl = fetch) {
  if (!isSnowflake(roleId) || !member?.user?.id) return { ok: false, error: "no_role" };
  const has = Array.isArray(member.roles) && member.roles.includes(String(roleId));
  const r = await discordApi(cfg, has ? "DELETE" : "PUT", `/guilds/${cfg.discord.guildId}/members/${member.user.id}/roles/${roleId}`, undefined, { fetchImpl, reason: "Botón de avisos" });
  return { ok: r.ok || r.status === 204, added: !has, status: r.status, code: r.body?.code };
}

// ---------- Botones (interacciones por HTTP) ----------
// Discord firma cada petición: Ed25519(timestamp + cuerpo) con la clave pública de la app.
const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
let keyCache = { hex: "", key: null };
export function verifyInteraction(publicKeyHex, signatureHex, timestamp, rawBody) {
  if (!/^[0-9a-f]{64}$/i.test(publicKeyHex || "") || !/^[0-9a-f]{128}$/i.test(signatureHex || "") || !timestamp) return false;
  try {
    if (keyCache.hex !== publicKeyHex) keyCache = { hex: publicKeyHex, key: createPublicKey({ key: Buffer.concat([SPKI_PREFIX, Buffer.from(publicKeyHex, "hex")]), format: "der", type: "spki" }) };
    return verify(null, Buffer.concat([Buffer.from(String(timestamp)), rawBody]), keyCache.key, Buffer.from(signatureHex, "hex"));
  } catch { return false; }
}
export const interactionsEnabled = (cfg) => botEnabled(cfg) && /^[0-9a-f]{64}$/i.test(cfg.discord.publicKey || "");

// Tipos de respuesta de Discord.
export const REPLY = { PONG: 1, MESSAGE: 4, DEFERRED_UPDATE: 6, UPDATE: 7, MODAL: 9 };
export const EPHEMERAL = 64;
export const ephemeral = (content, embeds) => ({ type: REPLY.MESSAGE, data: { content, embeds, flags: EPHEMERAL, allowed_mentions: { parse: [] } } });

// Botones: { type: 2, style, label, emoji, custom_id | url }. Estilos: 1 azul, 2 gris, 3 verde, 4 rojo, 5 enlace.
export const linkButton = (label, url, emoji) => ({ type: 2, style: 5, label: label.slice(0, 80), url, ...(emoji ? { emoji: { name: emoji } } : {}) });
export const actionButton = (label, customId, style = 2, emoji, disabled = false) =>
  ({ type: 2, style, label: label.slice(0, 80), custom_id: customId.slice(0, 100), disabled, ...(emoji ? { emoji: { name: emoji } } : {}) });
export const row = (...components) => ({ type: 1, components: components.filter(Boolean).slice(0, 5) });

// Idioma de quien tocó el botón (es-ES, es-419, pt-BR, en-US…) → es | pt | en.
export function langOf(locale) {
  const l = String(locale || "").toLowerCase();
  if (l.startsWith("es")) return "es";
  if (l.startsWith("pt")) return "pt";
  return "en";
}

// Números cortos: 12500 → 12.5K
export function short(value) {
  const SUF = ["", "K", "M", "B", "T", "Qa", "Qi", "Sx", "Sp", "Oc", "No", "Dc"];
  let v = Number(value) || 0, i = 0;
  while (v >= 1000 && i < SUF.length - 1) { v /= 1000; i++; }
  if (v >= 1000) return v.toExponential(2);
  return (v >= 100 || i === 0 ? String(Math.round(v)) : v.toFixed(1).replace(/\.0$/, "")) + SUF[i];
}
// Texto seguro para Discord: sin menciones ni enlaces enmascarados, recortado.
export const safe = (v, max = 100) => String(v ?? "").replace(/@/g, "@​").replace(/[\[\]]/g, "").slice(0, max);
