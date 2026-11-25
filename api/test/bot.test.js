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
import { receiveEggAlert, updateEggAlert, handleEggButton, expireOldAlerts, resendEggAlert } from "../src/eggAlerts.js";
import { announceVideo, handleVideoButton, resendVideo } from "../src/videos.js";
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

test("alerta de huevo absurdo: compacta, ícono en el mensaje, Unirse con cupo, Egg Ping, agarrado y reenviar", async () => {
  const db = openDb(":memory:"); const c = cfg(); const net = fakeNet();
  saveCatalog(db, [{ kind: "egg", name: "Galactic Faberge Egg", rarity: "Legendary", icon: "rbxassetid://129186172275552" }]);
  gamePull(db, c, { jobId: "abcdef12-3456", players: [{ userId: 1, name: "Uno", displayName: "Uno", level: 30 }] });
  const body = {
    key: "job-1:1", asset: "Galactic Faberge Egg", rarity: "Legendary", size: "absurdo", weight: 812.4, value: 2_500_000, place: "Level8",
    iconId: "rbxassetid://129186172275552", jobId: "abcdef12-3456", placeId: 77372347150746, studio: false, players: 7, maxPlayers: 12,
    i18n: { en: { asset: "Galactic Faberge Egg", rarity: "Legendary", place: "Abyssal Reef" }, es: { asset: "Huevo Fabergé Galáctico", rarity: "Legendario", place: "Arrecife Abisal" } },
  };
  const out = await receiveEggAlert(db, c, body, net.fetchImpl, silent);
  assert.equal(out.ok, true);
  assert.equal((await receiveEggAlert(db, c, body, net.fetchImpl, silent)).duplicate, true);
  await wait(60);
  const post = net.calls.find((x) => x.method === "POST" && x.url.includes(`/channels/${c.discord.eggChannel}/messages`));
  assert.ok(post, "publicó en el canal de huevos");
  assert.equal(typeof post.body, "string", "sin archivos adjuntos");
  const p = JSON.parse(post.body);
  assert.equal(p.content, "<@&1567693893963612250> 🥚 **ABSURD egg** on **Abyssal Reef**!");
  assert.deepEqual(p.allowed_mentions.roles, ["1567693893963612250"]);
  const e = p.embeds[0];
  assert.equal(e.title, "🥚 Galactic Faberge Egg");
  assert.equal(e.thumbnail.url, "https://skyeggs.pro/api/media/asset/129186172275552"); // ícono dentro del mensaje
  assert.match(e.description, /🟡 Legendary · ⚖️ \*\*812 kg\*\*/);
  assert.match(e.description, /📍 \*\*Abyssal Reef\*\* · 👥 \*\*1\/12\*\*/); // jugadores reales del último /pull
  assert.ok(!JSON.stringify(e).includes("2.5M"), "sin el valor");
  assert.equal(e.fields, undefined, "compacto: sin campos");
  const ids = p.components.flatMap((r) => r.components.map((b) => b.custom_id));
  assert.deepEqual(ids, [`ejoin:${out.id}`, "eping"]);

  const press = (custom_id, locale = "es-ES", user = "42") => handleEggButton(db, c, { data: { custom_id }, locale, member: { user: { id: user }, roles: [] } }, net.fetchImpl);
  // Unirse: hay espacio → enlace privado y cuenta como "va en camino" (una sola vez por persona).
  const join = await press(`ejoin:${out.id}`);
  assert.equal(join.data.flags, 64);
  assert.match(join.data.content, /Hay espacio/);
  assert.match(join.data.components[0].components[0].url, /gameInstanceId=abcdef12-3456/);
  await press(`ejoin:${out.id}`);
  await wait(30);
  const edit = JSON.parse(net.calls.filter((x) => x.method === "PATCH").pop().body);
  assert.equal(edit.components[0].components[0].label, "Join · 1 going");
  // Servidor lleno: no da el enlace.
  gamePull(db, c, { jobId: "abcdef12-3456", players: Array.from({ length: 12 }, (_, i) => ({ userId: 100 + i, name: `P${i}x`, displayName: `P${i}`, level: 30 })) });
  const full = await press(`ejoin:${out.id}`, "en-US", "50");
  assert.match(full.data.content, /full.*12\/12/);
  assert.equal(full.data.components, undefined);
  // Egg Ping: pone el rol (en portugués).
  const ping = await press("eping", "pt-BR");
  assert.match(ping.data.content, /Egg Ping ativado/);
  assert.ok(net.calls.some((x) => x.method === "PUT" && x.url.endsWith("/members/42/roles/1567693893963612250")));
  // Botones de la versión anterior.
  assert.match((await press("estats")).data.content, /ya no se usa/);

  // Alguien lo agarra: el mensaje cambia y queda solo Egg Ping.
  assert.equal((await updateEggAlert(db, c, { key: "job-1:1", status: "grabbed", by: { userId: 9, name: "pepito", displayName: "Pepito" } }, net.fetchImpl)).ok, true);
  await wait(30);
  const ep = JSON.parse(net.calls.filter((x) => x.method === "PATCH").pop().body);
  assert.equal(ep.embeds[0].title, "✅ Grabbed by Pepito");
  assert.deepEqual(ep.components[0].components.map((b) => b.custom_id), ["eping"]);
  assert.match((await press(`ejoin:${out.id}`, "es-ES", "43")).data.content, /ya no está/);
  // Reenviar: borra el mensaje anterior y publica otro.
  const before = net.calls.length;
  const re = await resendEggAlert(db, c, out.id, net.fetchImpl, silent);
  assert.equal(re.sent, true);
  assert.ok(net.calls.slice(before).some((x) => x.method === "DELETE" && x.url.includes("/messages/")));
  // Servidor que dejó de mandar /pull: la alerta pasa a "se fue".
  await receiveEggAlert(db, c, { ...body, key: "job-2:1", jobId: "viejo-1234" }, net.fetchImpl, silent, Date.now() - 30 * 60_000);
  db.prepare("INSERT INTO live_servers (job_id, players, last_pull) VALUES ('viejo-1234', 3, ?)").run(Date.now() - 20 * 60_000);
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
  const v = p.embeds[0];
  assert.equal(v.image.url, "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg");
  assert.equal(v.author.icon_url, "https://tr.rbxcdn.com/face.png");
  assert.equal(v.author.name, "Luna posted a new video");
  assert.equal(v.title, "Encontré un huevo ABSURDO");
  assert.match(v.description, /^📺 YouTube · 👀 \*\*3.2K\*\* views · <t:\d+:R>$/);
  assert.equal(v.fields, undefined, "compacto: sin rango ni campos");
  assert.equal(p.content, undefined, "sin texto extra cuando no hay rol de avisos");
  assert.deepEqual(p.components[0].components.map((b) => b.custom_id || b.label), ["Watch", `vlike:${ev.id}`, `vstats:${ev.id}`, "Play Sky Eggs"]);
  assert.ok(!net.calls.some((x) => x.url.includes("/reactions/")));
  const like = await handleVideoButton(db, c, { data: { custom_id: `vlike:${ev.id}` }, locale: "es-ES", member: { user: { id: "77" } }, message: { embeds: [{}] } }, net.fetchImpl);
  assert.equal(like.type, 7);
  assert.equal(like.data.components[0].components[1].label, "1");
  const again = await resendVideo(db, c, ev.id, net.fetchImpl, silent);
  assert.equal(again.sent, true);
  assert.ok(net.calls.some((x) => x.method === "DELETE"));
  const stats = await handleVideoButton(db, c, { data: { custom_id: `vstats:${ev.id}` }, locale: "en-US", member: { user: { id: "77" } } }, net.fetchImpl);
  assert.equal(stats.data.flags, 64);
  assert.match(stats.data.embeds[0].title, /More from this creator: Luna/);
  assert.ok(!stats.data.embeds[0].fields.some((f) => /Rank/.test(f.name)));
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
    // Servidor privado (VIP/reservado): no se guarda ni se publica en Discord.
    const before = net.calls.filter((x) => x.method === "POST" && x.url.includes(`/channels/${c.discord.eggChannel}/messages`)).length;
    const priv = await (await game("/api/game/egg-alert", { key: "vip:1", asset: "Moon Egg", rarity: "Legendary", place: "Level3", jobId: "vip", placeId: 1, players: 2, maxPlayers: 12, privateServer: true })).json();
    assert.equal(priv.skipped, "private_server");
    await wait(60);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM egg_alerts WHERE alert_key = 'vip:1'").get().n, 0);
    assert.equal(net.calls.filter((x) => x.method === "POST" && x.url.includes(`/channels/${c.discord.eggChannel}/messages`)).length, before);
    const press = await fetch(`${base}/api/discord/interactions`, signed({ type: 3, application_id: "app", token: "tok", locale: "es-ES", data: { custom_id: "estats" }, member: { user: { id: "5" }, roles: [] } }));
    const j = await press.json();
    assert.equal(j.type, 4);
    assert.equal(j.data.flags, 64);
  } finally { srv.close(); }
});
