// Bot de Discord: firma de los botones, alertas de huevos, anuncios de videos y caché de imágenes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { createServer } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db.js";
import { createApp } from "../src/app.js";
import { hashPassword } from "../src/auth.js";
import { gamePull } from "../src/logic.js";
import * as C from "../src/creators.js";
import { verifyInteraction, langOf } from "../src/bot.js";
import { receiveEggAlert, updateEggAlert, handleEggButton, expireOldAlerts } from "../src/eggAlerts.js";
import { announceVideo, handleVideoButton } from "../src/videos.js";
import { saveCatalog, assetImage, sniffImage } from "../src/assets.js";

const ROLE = { admin: "1560889139375898775", moderator: "1563742282392543312", creator: "1561051688125730897" };
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const PUBLIC_HEX = publicKey.export({ format: "der", type: "spki" }).subarray(12).toString("hex");
const cfg = () => ({
  gameKey: "k".repeat(40), adminUser: "PochiDev", adminPasswordHash: hashPassword("clave-super-segura"),
  cookieSecure: false, maxPerDay: { mythic: 5, legendary: 5 }, minLevel: 10, codeTtlHours: 72, tzOffsetMin: -300, rollsPerMinute: 1000,
  ipHeader: "x-real-ip", robloxTimeoutMs: 500, siteUrl: "https://skyeggs.pro", uploadsDir: mkdtempSync(join(tmpdir(), "se-up-")),
  mediaDir: mkdtempSync(join(tmpdir(), "se-media-")),
  discord: { clientId: "cid", clientSecret: "sec", guildId: "g1", redirectUri: "x", webhookUrl: "", roles: ROLE, staffRoles: {}, levelRoles: {},
    botToken: "bot-token", publicKey: PUBLIC_HEX, videoChannel: "1560771030228799510", videoPingRole: "", eggChannel: "1567675436681662604", eggPingRole: "1567693893963612250", eggLang: "es" },
  roblox: { apiKey: "", universeId: "10768674210", placeId: "77372347150746" },
  creators: { claimGraceDaysWeek: 3, claimGraceDaysMonth: 5 },
  views: { enabled: false, ytdlpPath: "/no", pipPath: "", youtubeApiKey: "", refreshHours: 6, maxFails: 3, timeoutMs: 2000 },
});
const silent = { info() {}, warn() {}, error() {} };
const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");

// Discord + Roblox simulados. Guarda cada llamada.
function fakeNet() {
  const calls = [];
  let msg = 1000;
  const fetchImpl = async (url, init = {}) => {
    const u = String(url);
    const method = init.method || "GET";
    calls.push({ method, url: u, body: init.body });
    const j = (status, body) => ({ ok: status < 300, status, json: async () => body, arrayBuffer: async () => new ArrayBuffer(0) });
    if (u.includes("thumbnails.roblox.com/v1/assets")) return j(200, { data: [{ state: "Completed", imageUrl: "https://tr.rbxcdn.com/egg.png" }] });
    if (u.includes("thumbnails.roblox.com/v1/users")) return j(200, { data: [{ targetId: 777, state: "Completed", imageUrl: "https://tr.rbxcdn.com/face.png" }] });
    if (u === "https://tr.rbxcdn.com/egg.png") return { ok: true, status: 200, arrayBuffer: async () => PNG.buffer.slice(PNG.byteOffset, PNG.byteOffset + PNG.length) };
    if (u.includes("/messages") && method === "POST") return j(200, { id: String(msg++), attachments: [{ id: "att1", filename: "egg.png" }] });
    if (u.includes("/messages/") && method === "PATCH") return j(200, { id: "x" });
    if (u.includes("/reactions/")) return { ok: true, status: 204, json: async () => null };
    if (u.includes("/roles/")) return { ok: true, status: 204, json: async () => null };
    return j(404, {});
  };
  return { calls, fetchImpl };
}
const wait = (ms = 30) => new Promise((r) => setTimeout(r, ms));

test("firma de los botones de Discord (Ed25519)", () => {
  const body = Buffer.from(JSON.stringify({ type: 1 }));
  const ts = "1700000000";
  const sig = sign(null, Buffer.concat([Buffer.from(ts), body]), privateKey).toString("hex");
  assert.equal(verifyInteraction(PUBLIC_HEX, sig, ts, body), true);
  assert.equal(verifyInteraction(PUBLIC_HEX, sig, "1700000001", body), false);
  assert.equal(verifyInteraction("", sig, ts, body), false);
  assert.equal(langOf("pt-BR"), "pt"); assert.equal(langOf("es-419"), "es"); assert.equal(langOf("fr"), "en");
});

test("alerta de huevo absurdo: imagen como adjunto, traducción, ¡Voy!, agarrado y estadísticas", async () => {
  const db = openDb(":memory:"); const c = cfg(); const net = fakeNet();
  saveCatalog(db, [{ kind: "egg", name: "Galactic Faberge Egg", rarity: "Mythic", icon: "rbxassetid://129186172275552" }]);
  const body = {
    key: "job-1:1", asset: "Galactic Faberge Egg", rarity: "Mythic", size: "absurdo", weight: 812.4, value: 2_500_000, place: "Level8",
    iconId: "rbxassetid://129186172275552", jobId: "abcdef12-3456", placeId: 77372347150746, studio: false, players: 7, maxPlayers: 12,
    i18n: { en: { asset: "Galactic Faberge Egg", rarity: "Mythic", place: "Abyssal Reef" }, es: { asset: "Huevo Fabergé Galáctico", rarity: "Mítico", place: "Arrecife Abisal" } },
  };
  const out = await receiveEggAlert(db, c, body, net.fetchImpl, silent);
  assert.equal(out.ok, true);
  assert.equal((await receiveEggAlert(db, c, body, net.fetchImpl, silent)).duplicate, true);
  await wait(60);
  const post = net.calls.find((x) => x.method === "POST" && x.url.includes(`/channels/${c.discord.eggChannel}/messages`));
  assert.ok(post, "publicó en el canal de huevos");
  assert.ok(post.body instanceof FormData, "la imagen va como adjunto");
  const payload = JSON.parse(post.body.get("payload_json"));
  assert.match(payload.content, /<@&1567693893963612250> 🥚 ¡Huevo ABSURDO en Arrecife Abisal!/);
  assert.deepEqual(payload.allowed_mentions.roles, ["1567693893963612250"]);
  assert.equal(payload.embeds[0].image.url, "attachment://egg.png");
  assert.match(payload.embeds[0].description, /Huevo Fabergé Galáctico/);
  assert.match(payload.embeds[0].description, /-# Galactic Faberge Egg \(Mythic\) just spawned on Abyssal Reef/); // línea en inglés
  assert.match(payload.embeds[0].url, /gameInstanceId=abcdef12-3456/);
  const ids = payload.components.flatMap((r) => r.components.map((b) => b.custom_id || b.url));
  assert.ok(ids.includes(`egoing:${out.id}`) && ids.includes("estats") && ids.includes("eping") && ids.includes(`elang:${out.id}`));
  // La imagen quedó guardada en la página.
  assert.ok(sniffImage((await assetImage(db, c, 129186172275552, net.fetchImpl)).bytes));

  // ¡Voy! actualiza el contador en el mensaje público y confirma en privado.
  const press = (custom_id, locale = "es-ES", user = "42") => handleEggButton(db, c, { data: { custom_id }, locale, member: { user: { id: user }, roles: [] }, message: { embeds: [{ image: { url: "https://cdn.discordapp.com/egg.png" } }] } }, net.fetchImpl);
  const go = await press(`egoing:${out.id}`);
  assert.equal(go.type, 7);
  assert.match(go.followup, /Anotado/);
  assert.ok(go.data.components[0].components.some((b) => b.label === "¡Voy! · 1"));
  assert.deepEqual(go.data.attachments, [{ id: "att1" }]);
  // En mi idioma: copia privada en portugués e inglés.
  const pt = await press(`elang:${out.id}`, "pt-BR");
  assert.equal(pt.data.flags, 64);
  assert.match(pt.data.embeds[0].title, /Ovo ABSURDO apareceu/);
  const en = await press(`elang:${out.id}`, "en-US");
  assert.match(en.data.embeds[0].description, /Abyssal Reef/);
  // Egg Ping: pone el rol.
  const ping = await press("eping");
  assert.match(ping.data.content, /te avisaremos/);
  assert.ok(net.calls.some((x) => x.method === "PUT" && x.url.endsWith("/members/42/roles/1567693893963612250")));

  // Alguien lo agarra: el mensaje cambia.
  assert.equal((await updateEggAlert(db, c, { key: "job-1:1", status: "grabbed", by: { userId: 9, name: "pepito", displayName: "Pepito" } }, net.fetchImpl)).ok, true);
  await wait(30);
  const edit = net.calls.filter((x) => x.method === "PATCH").pop();
  const ep = JSON.parse(edit.body);
  assert.match(ep.embeds[0].title, /Pepito agarró el huevo ABSURDO/);
  assert.ok(!ep.components.some((r) => r.components.some((b) => b.style === 5)), "sin botón de unirse");
  assert.deepEqual(ep.attachments, [{ id: "att1" }]);
  const late = await press(`egoing:${out.id}`, "es-ES", "43");
  assert.match(late.data.content, /ya no está/);
  // Estadísticas.
  const st = await press("estats", "en-US");
  assert.equal(st.data.embeds[0].fields.find((f) => f.name === "Last 24 h").value, "1");
  assert.equal(st.data.embeds[0].fields.find((f) => f.name === "Grabbed").value, "100%");
  // Alertas viejas de servidores cerrados pasan a "se fue".
  await receiveEggAlert(db, c, { ...body, key: "job-2:1" }, net.fetchImpl, silent, Date.now() - 3 * 3600_000);
  assert.equal(expireOldAlerts(db).length, 1);
});

test("anuncio del video aprobado y botón de me gusta", async () => {
  const db = openDb(":memory:"); const c = cfg(); const net = fakeNet();
  C.upsertDiscordUser(db, { id: "cre", username: "luna" }, { inGuild: true });
  C.upsertDiscordUser(db, { id: "mod", username: "mod" }, { inGuild: true, moderator: true });
  gamePull(db, c, { jobId: "j", players: [{ userId: 777, name: "LunaYT", displayName: "Luna", level: 30 }] });
  const { id: appId } = C.submitApplication(db, "cre", { age13: true, robloxUserId: 777, about: "Hago videos de Sky Eggs cada semana!", platforms: [{ type: "YouTube", url: "https://youtube.com/@luna" }] });
  C.reviewApplication(db, { id: "mod", name: "@mod", role: "moderator" }, { id: appId, action: "approve" });
  const today = new Date(Date.now() - 5 * 3600_000).toISOString().slice(0, 10);
  const ev = C.addEvidence(db, "cre", { kind: "video", platform: "YouTube", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", publishedOn: today, title: "Encontré un huevo ABSURDO" });
  C.reviewEvidence(db, { id: "mod", name: "@mod", role: "moderator" }, { id: ev.id, action: "approve", mode: "fixed", views: 3200 });
  const r = await announceVideo(db, c, ev.id, net.fetchImpl, silent);
  assert.equal(r.sent, true);
  assert.equal((await announceVideo(db, c, ev.id, net.fetchImpl, silent)).reason, "done");
  const post = net.calls.find((x) => x.method === "POST" && x.url.includes(`/channels/${c.discord.videoChannel}/messages`));
  const p = JSON.parse(post.body);
  assert.equal(p.embeds[0].image.url, "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg");
  assert.equal(p.embeds[0].author.icon_url, "https://tr.rbxcdn.com/face.png");
  assert.match(p.embeds[0].title, /Encontré un huevo ABSURDO/);
  assert.equal(p.embeds[0].fields.find((f) => f.name.endsWith("Vistas")).value, "**3.2K**");
  assert.ok(p.components[1].components.some((b) => b.custom_id === `vlike:${ev.id}`));
  assert.ok(net.calls.some((x) => x.url.includes("/reactions/")));
  const like = await handleVideoButton(db, c, { data: { custom_id: `vlike:${ev.id}` }, locale: "es-ES", member: { user: { id: "77" } }, message: { embeds: [{}] } }, net.fetchImpl);
  assert.equal(like.type, 7);
  assert.ok(like.data.components[1].components.some((b) => b.label === "Me gusta · 1"));
  const stats = await handleVideoButton(db, c, { data: { custom_id: `vstats:${ev.id}` }, locale: "en-US", member: { user: { id: "77" } } }, net.fetchImpl);
  assert.equal(stats.data.flags, 64);
  assert.match(stats.data.embeds[0].title, /More from this creator: Luna/);
});

test("HTTP: botones firmados, alerta desde el juego y catálogo de imágenes", async () => {
  const db = openDb(":memory:"); const c = cfg(); const net = fakeNet();
  const srv = createServer(createApp({ db, cfg: c, log: silent, fetchImpl: net.fetchImpl, probe: async () => ({ ok: false, error: "x" }) }));
  await new Promise((r) => srv.listen(0, r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    const signed = (obj) => {
      const body = JSON.stringify(obj); const ts = String(Math.floor(Date.now() / 1000));
      return { method: "POST", headers: { "content-type": "application/json", "x-signature-timestamp": ts, "x-signature-ed25519": sign(null, Buffer.from(ts + body), privateKey).toString("hex") }, body };
    };
    const pong = await fetch(`${base}/api/discord/interactions`, signed({ type: 1 }));
    assert.deepEqual(await pong.json(), { type: 1 });
    const bad = await fetch(`${base}/api/discord/interactions`, { method: "POST", headers: { "content-type": "application/json", "x-signature-timestamp": "1", "x-signature-ed25519": "00".repeat(64) }, body: "{\"type\":1}" });
    assert.equal(bad.status, 401);
    // Sin la clave del juego no se aceptan alertas.
    assert.equal((await fetch(`${base}/api/game/egg-alert`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status, 401);
    const game = (path, body) => fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json", "x-game-key": c.gameKey }, body: JSON.stringify(body) });
    const cat = await (await game("/api/game/catalog", { items: [{ kind: "egg", name: "Moon Egg", rarity: "Legendary", icon: "rbxassetid://84731167730121" }, { kind: "pet", name: "Sin ícono" }] })).json();
    assert.equal(cat.saved, 1);
    await wait(80);
    const img = await fetch(`${base}/api/media/asset/84731167730121`);
    assert.equal(img.status, 200);
    assert.equal(img.headers.get("content-type"), "image/png");
    assert.equal((await fetch(`${base}/api/media/asset/123456789`)).status, 404); // fuera del catálogo: no es un proxy
    const list = await (await fetch(`${base}/api/catalog`)).json();
    assert.equal(list.items[0].image, "https://skyeggs.pro/api/media/asset/84731167730121");
    const alert = await (await game("/api/game/egg-alert", { key: "j:9", asset: "Moon Egg", rarity: "Legendary", iconId: "84731167730121", place: "Level3", jobId: "j", placeId: 1, players: 1, maxPlayers: 12 })).json();
    assert.equal(alert.ok, true);
    const press = await fetch(`${base}/api/discord/interactions`, signed({ type: 3, application_id: "app", token: "tok", locale: "es-ES", data: { custom_id: "estats" }, member: { user: { id: "5" }, roles: [] } }));
    const j = await press.json();
    assert.equal(j.type, 4);
    assert.equal(j.data.flags, 64);
  } finally { srv.close(); }
});
