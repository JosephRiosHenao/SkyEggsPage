import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db.js";
import { createApp } from "../src/app.js";
import { hashPassword } from "../src/auth.js";
import { gamePull, gameAck } from "../src/logic.js";
import * as C from "../src/creators.js";
import { robuxFor, bestPack } from "../src/program.js";

const ROLE = { admin: "1560889139375898775", moderator: "1563742282392543312", creator: "1561051688125730897" };
const cfg = () => ({
  gameKey: "k".repeat(40), adminUser: "PochiDev", adminPasswordHash: hashPassword("clave-super-segura"),
  cookieSecure: false, maxPerDay: { mythic: 5, legendary: 5 }, minLevel: 10, codeTtlHours: 72,
  tzOffsetMin: -300, rollsPerMinute: 1000, ipHeader: "x-real-ip", robloxTimeoutMs: 500,
  siteUrl: "https://skyeggs.pro", uploadsDir: mkdtempSync(join(tmpdir(), "se-up-")),
  discord: { clientId: "cid", clientSecret: "sec", guildId: "g1", redirectUri: "https://skyeggs.pro/api/auth/discord/callback", webhookUrl: "", roles: ROLE },
  creators: { claimGraceDaysWeek: 3, claimGraceDaysMonth: 5 },
  views: { enabled: true, ytdlpPath: "/no/existe", pipPath: "", youtubeApiKey: "", refreshHours: 6, maxFails: 3, timeoutMs: 2000 },
});
const silent = { info() {}, warn() {}, error() {} };
const actor = (id, role = "moderator") => ({ id, name: `@${id}`, role });

function seedUser(db, id, roles) { C.upsertDiscordUser(db, { id, username: id }, { inGuild: true, ...roles }); }
function seedRoblox(db, c, userId = 500, name = "CreadorPro") {
  gamePull(db, c, { jobId: "j", players: [{ userId, name, displayName: name, level: 30 }] });
}

test("semanas iguales al juego (lunes 00:00 UTC-5)", () => {
  // MailServiceUtils.weekOf: 20 nov 2026 está en la semana 2968 (16–22 nov).
  assert.equal(C.weekOf(Date.parse("2026-11-20T12:00:00-05:00")), 2968);
  assert.equal(C.weekOf(Date.parse("2026-11-16T00:00:00-05:00")), 2968);
  assert.equal(C.weekOf(Date.parse("2026-11-15T23:59:59-05:00")), 2967);
  assert.equal(C.weekStartMs(2968), Date.parse("2026-11-16T00:00:00-05:00"));
  assert.equal(C.monthOf(Date.parse("2026-12-01T03:00:00Z")), "2026-11");
});

test("bono de Robux: 100 por cada 10k, máximo 1.000 por video", () => {
  assert.equal(robuxFor(9_999), 0);
  assert.equal(robuxFor(10_000), 100);
  assert.equal(robuxFor(25_500), 200);
  assert.equal(robuxFor(250_000), 1000);
  assert.equal(bestPack("week", 3200, 1).key, "V3000");
  assert.equal(bestPack("month", 6000, 2), null); // faltan videos
  assert.equal(bestPack("month", 6000, 3).key, "M5000");
});

test("flujo completo: solicitud → vínculo → evidencia → reclamo semanal → juego", () => {
  const db = openDb(":memory:"); const c = cfg();
  const now = Date.parse("2026-11-20T12:00:00-05:00");
  seedUser(db, "cre", { creator: true }); seedUser(db, "mod", { moderator: true }); seedUser(db, "adm", { admin: true, moderator: true });
  seedRoblox(db, c);

  // Solicitud
  assert.throws(() => C.submitApplication(db, "nuevo", { robloxUserId: 500 }), /age_required/);
  const base = { age13: true, platforms: [{ type: "YouTube", url: "https://youtube.com/@nuevo", followers: 1200 }], about: "Hago videos de Roblox cada semana." };
  // cuenta que nunca jugó Sky Eggs (solo salió en la búsqueda de Roblox): no puede aplicar
  db.prepare("INSERT INTO players (user_id, name, display_name, name_lc, display_lc, played, first_seen, last_seen) VALUES (900, 'NoJuega', 'NoJuega', 'nojuega', 'nojuega', 0, 0, 0)").run();
  assert.throws(() => C.submitApplication(db, "nuevo", { ...base, robloxUserId: 900 }), /must_play/);
  assert.throws(() => C.submitApplication(db, "nuevo", { ...base }), /pick_account/);
  seedRoblox(db, c, 501, "Nuevo_YT");
  const app = C.submitApplication(db, "nuevo", { ...base, robloxUserId: 501 }, now);
  assert.throws(() => C.submitApplication(db, "nuevo", { age13: true }), /already_pending/);
  assert.equal(C.reviewApplication(db, actor("mod"), { id: app.id, action: "contacted", note: "Le escribí por DM" }).status, "contacted");
  const ok = C.reviewApplication(db, actor("mod"), { id: app.id, action: "approve" });
  assert.equal(ok.status, "approved");
  assert.equal(ok.linked, true); // aprobar la solicitud confirma su cuenta de Roblox
  assert.equal(C.getCreator(db, "nuevo").link_status, "approved");
  assert.equal(C.getCreator(db, "nuevo").roblox_user_id, 501);

  // Vinculación (un moderador la aprueba; no puede aprobarse a sí mismo)
  assert.throws(() => C.requestLink(db, "cre", 900, now), /must_play/);
  const link = C.requestLink(db, "cre", 500, now);
  assert.equal(link.roblox.name, "CreadorPro");
  assert.equal(C.modQueue(db, actor("mod")).links[0].player.level, 30);
  assert.throws(() => C.claimPack(db, c, "cre", { period: "week" }, now), /link_required/);
  assert.throws(() => C.reviewLink(db, actor("cre"), { discordId: "cre", action: "approve" }), /own_item/);
  C.reviewLink(db, actor("mod"), { discordId: "cre", action: "approve" }, now);
  assert.throws(() => C.requestLink(db, "otro", 500, now), /roblox_taken|already_linked/);

  // Evidencias
  const e1 = C.addEvidence(db, "cre", { kind: "video", platform: "YouTube", url: "https://youtu.be/abc", publishedOn: "2026-11-18", title: "Abrí 100 huevos" }, now);
  assert.throws(() => C.addEvidence(db, "cre", { url: "https://youtu.be/abc", publishedOn: "2026-11-18" }, now), /duplicate_url/);
  assert.throws(() => C.addEvidence(db, "cre", { url: "https://youtu.be/zzz", publishedOn: "2026-12-30" }, now), /future_date/);
  let st = C.creatorState(db, c, "cre", now);
  assert.equal(st.week.current.pending, 1);
  assert.equal(st.week.current.best, null);
  C.reviewEvidence(db, actor("mod"), { id: e1.id, action: "approve", views: 3200 }, now);
  st = C.creatorState(db, c, "cre", now);
  assert.equal(st.week.current.views, 3200);
  assert.equal(st.week.current.best, "V3000");

  // Reclamo: una vez por semana, el mejor pack alcanzado
  const cl = C.claimPack(db, c, "cre", { period: "week", which: "current" }, now);
  assert.equal(cl.pack, "V3000");
  assert.throws(() => C.claimPack(db, c, "cre", { period: "week", which: "current" }, now), /already_claimed/);
  assert.throws(() => C.claimPack(db, c, "cre", { period: "month", which: "current" }, now), /no_pack/);

  // El juego recibe: rango base exacto + bienvenida (de la vinculación) y el pack con su periodo absoluto
  const pull = gamePull(db, c, { players: [{ userId: 500, name: "CreadorPro", level: 1 }] }, now);
  const kinds = pull.rewards.map((r) => `${r.kind}:${r.pack}:${r.period || ""}`).sort();
  assert.deepEqual(kinds, ["creator:V3000:w2968", "notice:welcome:Creator", "tierset:Creator:"]);

  // Registro con nombres
  const log = C.auditList(db).map((a) => `${a.actor_name} ${a.action}`);
  assert.ok(log.includes("@mod application.approve"));
  assert.ok(log.includes("@mod link.approve"));
  assert.ok(log.includes("@mod evidence.approve"));
});

test("reclamo de la semana pasada: solo dentro del plazo", () => {
  const db = openDb(":memory:"); const c = cfg();
  seedUser(db, "cre", { creator: true }); seedRoblox(db, c);
  const sun = Date.parse("2026-11-22T20:00:00-05:00"); // domingo, semana 2968
  C.requestLink(db, "cre", 500, sun); C.reviewLink(db, actor("mod"), { discordId: "cre", action: "approve" }, sun);
  const e = C.addEvidence(db, "cre", { url: "https://tiktok.com/@c/1", platform: "TikTok", publishedOn: "2026-11-21" }, sun);
  C.reviewEvidence(db, actor("mod"), { id: e.id, action: "approve", views: 1500 }, sun);
  const wed = Date.parse("2026-11-25T12:00:00-05:00"); // miércoles siguiente (2 días de plazo usados)
  assert.equal(C.claimPack(db, c, "cre", { period: "week", which: "previous" }, wed).pack, "V1000");
  const db2 = openDb(":memory:"); seedUser(db2, "cre", { creator: true }); seedRoblox(db2, c);
  C.requestLink(db2, "cre", 500, sun); C.reviewLink(db2, actor("mod"), { discordId: "cre", action: "approve" }, sun);
  const e2 = C.addEvidence(db2, "cre", { url: "https://tiktok.com/@c/1", publishedOn: "2026-11-21" }, sun);
  C.reviewEvidence(db2, actor("mod"), { id: e2.id, action: "approve", views: 1500 }, sun);
  const fri = Date.parse("2026-11-27T12:00:00-05:00"); // viernes: plazo de 3 días vencido
  assert.throws(() => C.claimPack(db2, c, "cre", { period: "week", which: "previous" }, fri), /period_closed/);
});

test("bono de Robux: moderador y luego admin (personas distintas), y pago", () => {
  const db = openDb(":memory:"); const c = cfg();
  const now = Date.parse("2026-11-20T12:00:00-05:00");
  seedUser(db, "cre", { creator: true });
  const e = C.addEvidence(db, "cre", { url: "https://youtu.be/viral", publishedOn: "2026-11-19" }, now);
  assert.throws(() => C.requestBonus(db, "cre", e.id), /not_approved/);
  C.reviewEvidence(db, actor("mod"), { id: e.id, action: "approve", views: 8000 }, now);
  assert.throws(() => C.requestBonus(db, "cre", e.id), /not_enough_views/);
  C.reviewEvidence(db, actor("mod"), { id: e.id, action: "update", views: 42_000 }, now);
  assert.equal(C.requestBonus(db, "cre", e.id).robux, 400);
  const id = db.prepare("SELECT id FROM bonuses").get().id;
  assert.throws(() => C.reviewBonus(db, actor("cre"), { id, action: "approve" }), /own_item/);
  assert.throws(() => C.reviewBonus(db, actor("mod"), { id, action: "paid" }), /bad_action/);
  assert.equal(C.reviewBonus(db, actor("adm", "admin"), { id, action: "approve" }).status, "pending_admin"); // el admin hace de moderador
  assert.throws(() => C.reviewBonus(db, actor("adm", "admin"), { id, action: "approve" }), /needs_other_reviewer/);
  db.prepare("UPDATE bonuses SET status = 'pending_mod', mod_id = NULL").run();
  assert.equal(C.reviewBonus(db, actor("mod"), { id, action: "approve" }).status, "pending_admin");
  assert.throws(() => C.reviewBonus(db, actor("mod2"), { id, action: "approve" }), /admin_only/);
  assert.equal(C.reviewBonus(db, actor("adm", "admin"), { id, action: "approve" }).status, "approved");
  assert.equal(C.reviewBonus(db, actor("adm", "admin"), { id, action: "paid", note: "Pago de grupo" }).status, "paid");
});

test("pedido especial con 100.000 vistas al mes, uno por mes, solo admin lo resuelve", () => {
  const db = openDb(":memory:"); const c = cfg();
  const now = Date.parse("2026-11-20T12:00:00-05:00");
  seedUser(db, "cre", { creator: true });
  assert.throws(() => C.requestSpecial(db, c, "cre", { request: "Quiero un pase gratis" }, now), /not_eligible/);
  const e = C.addEvidence(db, "cre", { url: "https://youtu.be/mega", publishedOn: "2026-11-10" }, now);
  C.reviewEvidence(db, actor("mod"), { id: e.id, action: "approve", views: 120_000 }, now);
  C.requestSpecial(db, c, "cre", { request: "Un título propio en el juego" }, now);
  assert.throws(() => C.requestSpecial(db, c, "cre", { request: "Otro pedido más" }, now), /not_eligible/);
  const sid = db.prepare("SELECT id FROM specials").get().id;
  assert.throws(() => C.reviewSpecial(db, actor("mod"), { id: sid, action: "approve" }), /admin_only/);
  assert.equal(C.reviewSpecial(db, actor("adm", "admin"), { id: sid, action: "approve" }).status, "approved");
});

// ---------- HTTP con Discord simulado ----------
function fakeDiscord(rolesById) {
  return async (url, init) => {
    const u = String(url);
    const j = (status, body) => ({ ok: status < 300, status, json: async () => body });
    if (u.endsWith("/oauth2/token")) return j(200, { access_token: `tok-${new URLSearchParams(init.body).get("code")}` });
    const who = (init.headers.authorization || "").replace("Bearer tok-", "");
    if (u.endsWith("/users/@me")) return j(200, { id: who, username: `user_${who}`, global_name: who.toUpperCase(), avatar: null });
    if (u.includes("/guilds/g1/member")) return rolesById[who] ? j(200, { roles: rolesById[who] }) : j(404, {});
    return j(404, {});
  };
}

async function withServer(fn, fetchImpl, probe = async () => ({ ok: false, error: "sin red en pruebas" })) {
  const db = openDb(":memory:"); const c = cfg();
  const srv = createServer(createApp({ db, cfg: c, log: silent, fetchImpl, probe }));
  await new Promise((r) => srv.listen(0, r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  try { await fn(base, db, c); } finally { srv.close(); }
}

async function login(base, code) {
  const r1 = await fetch(`${base}/api/auth/discord/login?next=/creadores/panel/`, { redirect: "manual" });
  assert.equal(r1.status, 302);
  const loc = new URL(r1.headers.get("location"));
  assert.equal(loc.host, "discord.com");
  assert.equal(loc.searchParams.get("scope"), "identify guilds.members.read");
  const state = loc.searchParams.get("state");
  const stateCookie = r1.headers.get("set-cookie").split(";")[0];
  const r2 = await fetch(`${base}/api/auth/discord/callback?code=${code}&state=${state}`, { redirect: "manual", headers: { cookie: stateCookie } });
  assert.equal(r2.status, 302);
  assert.equal(r2.headers.get("location"), "/creadores/panel/");
  const cookie = r2.headers.getSetCookie().find((x) => x.startsWith("se_user=")).split(";")[0];
  return cookie;
}
const json = (body, cookie) => ({ method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) });

test("HTTP: login con Discord lee los roles y protege cada zona", async () => {
  const fake = fakeDiscord({ cre: [ROLE.creator], mod: [ROLE.moderator], adm: [ROLE.admin], fan: [] });
  await withServer(async (base, db, c) => {
    // estado de OAuth falsificado
    const bad = await fetch(`${base}/api/auth/discord/callback?code=x&state=inventado`, { redirect: "manual" });
    assert.match(bad.headers.get("location"), /error=login_expired/);

    const fan = await login(base, "fan");
    const me = await (await fetch(`${base}/api/me`, { headers: { cookie: fan } })).json();
    assert.equal(me.user.roles.creator, false);
    assert.equal((await fetch(`${base}/api/creators/me`, { headers: { cookie: fan } })).status, 403);
    assert.equal((await fetch(`${base}/api/mod/queue`, { headers: { cookie: fan } })).status, 403);
    gamePull(db, c, { players: [{ userId: 700, name: "FanYT", displayName: "Fan", level: 15 }] });
    const found = await (await fetch(`${base}/api/players/search?q=fany&played=1`)).json();
    assert.equal(found.players.length, 1);
    assert.equal((await (await fetch(`${base}/api/players/search?q=nadie&played=1`)).json()).players.length, 0);
    const apply = await fetch(`${base}/api/creators/apply`, json({ age13: true, robloxUserId: 700, platforms: [{ type: "TikTok", url: "https://tiktok.com/@fan" }], about: "Quiero grabar Sky Eggs todos los días." }, fan));
    assert.equal(apply.status, 200);

    const mod = await login(base, "mod");
    const q = await (await fetch(`${base}/api/mod/queue`, { headers: { cookie: mod } })).json();
    assert.equal(q.actor.role, "moderator");
    assert.equal(q.applications.length, 1);
    assert.equal(q.applications[0].user.username, "user_fan");
    const rev = await fetch(`${base}/api/mod/application`, json({ id: q.applications[0].id, action: "approve", note: "Bienvenido" }, mod));
    assert.equal(rev.status, 200);
    assert.equal((await fetch(`${base}/api/mod/special`, json({ id: 1, action: "approve" }, mod))).status, 403); // solo admin
    assert.equal((await fetch(`${base}/api/admin/metrics`, { headers: { cookie: mod } })).status, 403);

    const adm = await login(base, "adm");
    assert.equal((await fetch(`${base}/api/admin/metrics`, { headers: { cookie: adm } })).status, 200);
    const audit = await (await fetch(`${base}/api/mod/audit`, { headers: { cookie: adm } })).json();
    assert.equal(audit.audit[0].actor_name, "MOD (@user_mod)");
    assert.equal(audit.audit[0].action, "application.approve");

    // creador: sube imagen, solo él y el staff la ven
    const cre = await login(base, "cre");
    const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
    const up = await fetch(`${base}/api/creators/upload`, { method: "POST", headers: { "content-type": "image/png", cookie: cre }, body: png });
    const { file } = await up.json();
    assert.match(file, /^[a-f0-9]{32}\.png$/);
    const fake2 = await fetch(`${base}/api/creators/upload`, { method: "POST", headers: { "content-type": "image/png", cookie: cre }, body: Buffer.from("<svg/>") });
    assert.equal(fake2.status, 415);
    await fetch(`${base}/api/creators/evidence`, json({ kind: "live", platform: "Twitch", url: "https://twitch.tv/videos/1", publishedOn: "2026-11-01", file }, cre));
    // (fecha vieja según el reloj real: puede fallar por too_old; lo que importa es el permiso del archivo)
    db.prepare("INSERT INTO evidences (discord_id, kind, platform, url, published_on, week, month, file, created_at) VALUES ('cre','video','YouTube','https://y/1','2026-11-18',2968,'2026-11',?,0)").run(file);
    assert.equal((await fetch(`${base}/api/files/${file}`, { headers: { cookie: cre } })).status, 200);
    assert.equal((await fetch(`${base}/api/files/${file}`, { headers: { cookie: fan } })).status, 403);
    assert.equal((await fetch(`${base}/api/files/${file}`, { headers: { cookie: mod } })).status, 200);

    // otro origen no puede actuar
    const evil = await fetch(`${base}/api/mod/application`, { method: "POST", headers: { "content-type": "application/json", cookie: mod, origin: "https://malo.com" }, body: "{}" });
    assert.equal(evil.status, 403);
  }, fake);
});

test("HTTP: sin Discord configurado el login avisa y no rompe", async () => {
  const db = openDb(":memory:"); const c = cfg(); c.discord.clientId = "";
  const srv = createServer(createApp({ db, cfg: c, log: silent }));
  await new Promise((r) => srv.listen(0, r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const r = await fetch(`${base}/api/auth/discord/login`, { redirect: "manual" });
  assert.match(r.headers.get("location"), /error=discord_off/);
  assert.equal((await (await fetch(`${base}/api/me`)).json()).discord, false);
  srv.close();
});


// ---------- Vistas automáticas ----------
import { trackableSite, probeViews } from "../src/views.js";
import { probeEvidence } from "../src/app.js";

test("solo se leen redes conocidas por https (nada de URLs internas)", () => {
  assert.equal(trackableSite("https://www.youtube.com/watch?v=abc"), "youtube");
  assert.equal(trackableSite("https://youtu.be/abc"), "youtube");
  assert.equal(trackableSite("https://www.tiktok.com/@a/video/1"), "tiktok");
  assert.equal(trackableSite("https://vm.tiktok.com/ZM123/"), "tiktok");
  assert.equal(trackableSite("https://www.twitch.tv/videos/1"), "twitch");
  assert.equal(trackableSite("https://kick.com/x/videos/1"), "kick");
  assert.equal(trackableSite("https://www.instagram.com/reel/1"), null);
  assert.equal(trackableSite("http://youtube.com/watch?v=1"), null);
  assert.equal(trackableSite("https://youtube.com.evil.com/x"), null);
  assert.equal(trackableSite("https://169.254.169.254/latest"), null);
  assert.equal(trackableSite("https://youtube.com:8443/x"), null);
});

test("sin yt-dlp instalado, TikTok falla con un motivo claro; Instagram no se lee", async () => {
  const r = await probeViews(cfg(), "https://www.tiktok.com/@a/video/1");
  assert.equal(r.ok, false);
  assert.match(r.error, /yt-dlp/);
  const ig = await probeViews(cfg(), "https://www.instagram.com/reel/1");
  assert.match(ig.error, /no permite/);
});

// fetch simulado: cada URL que empiece por una clave responde lo indicado
function fakeFetch(routes) {
  const calls = [];
  const impl = async (url) => {
    calls.push(String(url));
    const key = Object.keys(routes).find((k) => String(url).startsWith(k));
    const r = key ? routes[key] : { status: 404 };
    const body = typeof r.body === "string" ? r.body : JSON.stringify(r.body ?? {});
    return new Response(r.status === 200 || !r.status ? body : null, { status: r.status || 200, headers: r.location ? { location: r.location } : {} });
  };
  return { impl, calls };
}
const shortHtml = (views) => `<html><script>var ytInitialData = ${JSON.stringify({ engagementPanels: [{ items: [{ videoDescriptionHeaderRenderer: {
  channel: { simpleText: "Blexizz" }, views: { simpleText: `${views} views` }, publishDate: { simpleText: "Nov 23, 2026" } } }] }] })};</script></html>`;

test("YouTube: lee las vistas de la página del short, sin claves ni yt-dlp", async () => {
  const { impl } = fakeFetch({
    "https://www.youtube.com/shorts/j5HUTIaLEEw": { body: shortHtml("1,796") },
    "https://www.youtube.com/oembed": { body: { title: "recomendando juegos", author_name: "Blexizz", author_url: "https://www.youtube.com/@blexizzYT" } },
  });
  const r = await probeViews(cfg(), "https://youtube.com/shorts/j5HUTIaLEEw?si=abc", impl);
  assert.equal(r.ok, true);
  assert.equal(r.views, 1796);
  assert.equal(r.meta.channel, "Blexizz");
  assert.equal(r.meta.title, "recomendando juegos");
  assert.equal(r.meta.uploadDate, "2026-11-23");
});

test("YouTube: si la página pide verificación, usa Return YouTube Dislike", async () => {
  const { impl, calls } = fakeFetch({
    "https://www.youtube.com/shorts/": { status: 303, location: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
    "https://www.youtube.com/watch": { status: 302, location: "https://www.google.com/sorry/index?continue=x" },
    "https://returnyoutubedislikeapi.com/votes": { body: { id: "dQw4w9WgXcQ", viewCount: 1840207238, deleted: false } },
    "https://www.youtube.com/oembed": { body: { title: "Never Gonna Give You Up", author_name: "Rick Astley" } },
  });
  const r = await probeViews(cfg(), "https://www.youtube.com/watch?v=dQw4w9WgXcQ", impl);
  assert.equal(r.ok, true);
  assert.equal(r.views, 1840207238);
  assert.equal(r.meta.channel, "Rick Astley");
  assert.ok(calls.some((u) => u.includes("returnyoutubedislikeapi.com/votes?videoId=dQw4w9WgXcQ")));
});

test("YouTube: video recién subido sin datos → reintento que no cuenta como fallo", async () => {
  const { impl } = fakeFetch({
    "https://www.youtube.com/shorts/": { status: 303, location: "https://www.youtube.com/watch?v=x" },
    "https://www.youtube.com/watch": { status: 302, location: "https://www.google.com/sorry/index" },
    "https://returnyoutubedislikeapi.com/votes": { body: { viewCount: 0, deleted: false } },
  });
  const r = await probeViews(cfg(), "https://youtu.be/abcdefghijk", impl);
  assert.equal(r.ok, false);
  assert.equal(r.retry, true);
  assert.match(r.error, /aún no/);

  const db = openDb(":memory:"); const c = cfg();
  const now = Date.parse("2026-11-20T12:00:00-05:00");
  seedUser(db, "cre", { creator: true });
  C.setGrace(c);
  const e = C.addEvidence(db, "cre", { url: "https://youtu.be/abcdefghijk", publishedOn: "2026-11-18" }, now);
  for (let i = 0; i < 5; i++) await probeEvidence(db, c, e.id, "x", async () => r, silent, now);
  const row = db.prepare("SELECT track, auto_fails, auto_error FROM evidences WHERE id = ?").get(e.id);
  assert.equal(row.track, "auto");
  assert.equal(row.auto_fails, 0);
  assert.match(row.auto_error, /aún no/);
});

test("parseCount entiende los formatos de YouTube", async () => {
  const { parseCount } = await import("../src/views.js");
  assert.equal(parseCount("1,234,567 views"), 1234567);
  assert.equal(parseCount("796"), 796);
  assert.equal(parseCount("1.2M views"), 1_200_000);
  assert.equal(parseCount("No views"), 0);
  assert.ok(Number.isNaN(parseCount("Views")));
});

test("vistas automáticas: se aprueban, se refrescan y actualizan el bono; si fallan pasan a fijas", async () => {
  const db = openDb(":memory:"); const c = cfg();
  const now = Date.parse("2026-11-20T12:00:00-05:00");
  seedUser(db, "cre", { creator: true });
  C.setGrace(c);
  const e = C.addEvidence(db, "cre", { url: "https://www.youtube.com/watch?v=abc123", publishedOn: "2026-11-18" }, now);
  assert.equal(e.track, "auto");
  const ig = C.addEvidence(db, "cre", { url: "https://www.instagram.com/reel/9", publishedOn: "2026-11-18" }, now);
  assert.equal(ig.track, "manual");
  // hasta cuándo: plazo del mes (30 nov + 5 días) porque termina después que el de la semana
  assert.equal(db.prepare("SELECT track_until FROM evidences WHERE id = ?").get(e.id).track_until, Date.parse("2026-12-06T00:00:00-05:00"));

  let views = 12_000;
  const probe = async () => ({ ok: true, views, meta: { site: "youtube", channel: "Lu Plays", uploadDate: "2026-11-18" } });
  await probeEvidence(db, c, e.id, "x", probe, silent, now);
  assert.throws(() => C.reviewEvidence(db, actor("mod"), { id: ig.id, action: "approve", mode: "auto" }), /not_trackable|no_auto_views/);
  C.reviewEvidence(db, actor("mod"), { id: e.id, action: "approve", mode: "auto" }, now);
  assert.equal(C.creatorState(db, c, "cre", now).week.current.views, 12_000);
  C.requestBonus(db, "cre", e.id);

  // pasa el tiempo: toca refrescar
  assert.equal(C.dueForProbe(db, c, now + 60_000).length, 0);
  assert.equal(C.dueForProbe(db, c, now + 7 * 3_600_000).length, 1);
  views = 34_500;
  await probeEvidence(db, c, e.id, "x", probe, silent, now);
  assert.equal(C.creatorState(db, c, "cre", now).week.current.views, 34_500);
  assert.equal(db.prepare("SELECT robux FROM bonuses").get().robux, 300);
  // fuera del plazo ya no se refresca
  assert.equal(C.dueForProbe(db, c, Date.parse("2026-12-07T00:00:00-05:00")).length, 0);

  // 3 fallos seguidos → vistas fijas y vuelve a la cola del moderador
  const bad = async () => ({ ok: false, error: "Sign in to confirm you're not a bot" });
  for (let i = 0; i < 3; i++) await probeEvidence(db, c, e.id, "x", bad, silent, now);
  const row = db.prepare("SELECT track, recount, views, auto_error FROM evidences WHERE id = ?").get(e.id);
  assert.equal(row.track, "manual"); assert.equal(row.recount, 1); assert.equal(row.views, 34_500);
  assert.match(row.auto_error, /bot/);
  assert.equal(C.modQueue(db, actor("mod")).evidences.some((x) => x.id === e.id), true);
  // el moderador fija las vistas
  C.reviewEvidence(db, actor("mod"), { id: e.id, action: "update", views: 35_000 }, now);
  assert.equal(db.prepare("SELECT track FROM evidences WHERE id = ?").get(e.id).track, "manual");
  assert.equal(C.dueForProbe(db, c, now + 30 * 86400_000).length, 0);
});

// ---------- Rangos automáticos, avisos y creadores antiguos (2026-11-23) ----------
import { evaluateCreators, handleGameCreator, legacyList, noticeList } from "../src/lifecycle.js";
import { rankForViews } from "../src/program.js";
import { publicCreators, creatorsDashboard, clearPublicCache } from "../src/insights.js";
import { rolesForTier, setMemberRoles } from "../src/discord.js";
import { runRoleJobs } from "../src/app.js";

const cfgAuto = () => {
  const c = cfg();
  c.creators = { ...c.creators, autoTiers: true, warnDaysBefore: 3, demotionGraceHours: 24, legacyNoticeDays: 3, legacyDeadline: Date.parse("2027-01-01T00:00:00-05:00") };
  return c;
};
const pendingOf = (db, userId) => db.prepare("SELECT kind, pack, period FROM rewards WHERE user_id = ? AND status = 'pending' ORDER BY created_at, rowid").all(userId).map((r) => `${r.kind}:${r.pack}${r.period ? `:${r.period}` : ""}`);
function approvedCreator(db, c, id, userId, at) {
  seedUser(db, id, { creator: true }); seedRoblox(db, c, userId, `Cre_${userId}`);
  C.requestLink(db, id, userId, at); C.reviewLink(db, actor("mod"), { discordId: id, action: "approve" }, at);
}

test("rangos por vistas semanales: 3k Activo, 3.5k Viral, 4.5k Estrella, 5k Elite", () => {
  assert.equal(rankForViews(2999), "Creator");
  assert.equal(rankForViews(3000), "Active");
  assert.equal(rankForViews(3500), "Viral");
  assert.equal(rankForViews(4500), "Star");
  assert.equal(rankForViews(5000), "Elite");
});

test("sube solo con las vistas, avisa 3 días antes y baja a Creator si una semana no sube video", () => {
  const db = openDb(":memory:"); const c = cfgAuto();
  const mon = Date.parse("2026-11-09T10:00:00-05:00"); // semana 2967
  approvedCreator(db, c, "cre", 600, mon);
  assert.equal(C.getCreator(db, "cre").tier, "Creator");
  db.prepare("UPDATE rewards SET status = 'delivered'").run();

  // 3.600 vistas en la semana → Viral, con aviso al buzón
  const e = C.addEvidence(db, "cre", { url: "https://youtu.be/v1", platform: "YouTube", publishedOn: "2026-11-10" }, mon + 86400_000);
  C.reviewEvidence(db, actor("mod"), { id: e.id, action: "approve", views: 3600 }, mon + 86400_000);
  let out = evaluateCreators(db, c, mon + 86400_000);
  assert.equal(out.changes[0].to, "Viral");
  assert.equal(C.getCreator(db, "cre").tier, "Viral");
  assert.deepEqual(pendingOf(db, 600), ["tierset:Viral", "notice:promoted:Viral"]);
  assert.equal(out.roleJobs[0].tierKey, "Viral");
  db.prepare("UPDATE rewards SET status = 'delivered'").run();

  // Semana 2968 sin video: el viernes llega el aviso (una sola vez)
  const fri = Date.parse("2026-11-20T08:00:00-05:00");
  out = evaluateCreators(db, c, fri);
  assert.equal(out.warnings, 1);
  assert.equal(evaluateCreators(db, c, fri + 3600_000).warnings, 0);
  assert.deepEqual(pendingOf(db, 600), ["notice:demotion_warning:Viral"]);
  db.prepare("UPDATE rewards SET status = 'delivered'").run();

  // El lunes aún no baja (margen de 24 h); el martes baja a Creator
  assert.equal(evaluateCreators(db, c, Date.parse("2026-11-23T10:00:00-05:00")).changes.length, 0);
  out = evaluateCreators(db, c, Date.parse("2026-11-24T01:00:00-05:00"));
  assert.deepEqual(out.changes, [{ discordId: "cre", from: "Viral", to: "Creator" }]);
  assert.deepEqual(pendingOf(db, 600), ["tierset:Creator", "notice:demoted:Viral"]);
  // No vuelve a bajar ni a subir sin vistas nuevas
  assert.equal(evaluateCreators(db, c, Date.parse("2026-11-24T05:00:00-05:00")).changes.length, 0);
  assert.ok(noticeList(db).some((n) => n.kind === "demoted"));
});

test("con un video en la semana no baja aunque esté en revisión", () => {
  const db = openDb(":memory:"); const c = cfgAuto();
  const mon = Date.parse("2026-11-09T10:00:00-05:00");
  approvedCreator(db, c, "cre", 610, mon);
  db.prepare("UPDATE creators SET tier = 'Star' WHERE discord_id = 'cre'").run();
  C.addEvidence(db, "cre", { url: "https://youtu.be/p1", platform: "YouTube", publishedOn: "2026-11-21" }, Date.parse("2026-11-21T10:00:00-05:00"));
  const out = evaluateCreators(db, c, Date.parse("2026-11-24T02:00:00-05:00"));
  assert.equal(out.changes.length, 0);
  assert.equal(C.getCreator(db, "cre").tier, "Star");
});

test("creadores antiguos: aviso al entrar, 3 días para aplicar, y fecha límite del 1 de enero", () => {
  const db = openDb(":memory:"); const c = cfgAuto();
  const t0 = Date.parse("2026-11-23T10:00:00-05:00");
  // El juego reporta a un jugador con el tag de creador que no está en la página
  gamePull(db, c, { players: [{ userId: 700, name: "Viejo_Creator", displayName: "Viejo", level: 50, creatorTier: 3 }] }, t0);
  assert.equal(legacyList(db)[0].status, "notified");
  let pull = gamePull(db, c, { players: [{ userId: 700, name: "Viejo_Creator", level: 50, creatorTier: 3 }] }, t0 + 60_000);
  assert.deepEqual(pull.rewards.map((r) => `${r.kind}:${r.pack}:${r.period}`), ["notice:legacy_join:26/11/2026"]);
  gameAck(db, { ids: pull.rewards.map((r) => r.id) });

  // Otro antiguo aplica a tiempo: conserva el rol mientras revisan
  gamePull(db, c, { players: [{ userId: 701, name: "Aplica_Ya", level: 20, creatorTier: 1 }] }, t0);
  seedUser(db, "ap", {});
  C.submitApplication(db, "ap", { robloxUserId: 701, age13: true, platforms: [{ type: "TikTok", url: "https://tiktok.com/@ap" }], about: "Soy creador desde hace tiempo." }, t0 + 3600_000);
  gamePull(db, c, { players: [{ userId: 701, name: "Aplica_Ya", level: 20, creatorTier: 1 }] }, t0 + 5 * 86400_000);
  assert.equal(legacyList(db).find((l) => l.roblox_user_id === 701).status, "applied");

  // El primero no aplicó: pasado el plazo pierde el rol al entrar
  pull = gamePull(db, c, { players: [{ userId: 700, name: "Viejo_Creator", level: 50, creatorTier: 3 }] }, t0 + 3 * 86400_000 + 60_000);
  assert.deepEqual(pull.rewards.map((r) => `${r.kind}:${r.pack}`), ["tierset:None", "notice:legacy_removed"]);
  assert.equal(legacyList(db).find((l) => l.roblox_user_id === 700).status, "removed");
  // Mientras el cambio no se entrega, no se repite
  pull = gamePull(db, c, { players: [{ userId: 700, name: "Viejo_Creator", level: 50, creatorTier: 3 }] }, t0 + 3 * 86400_000 + 120_000);
  assert.equal(pull.rewards.filter((r) => r.kind === "notice").length, 1);

  // Aprobarlo lo deja en Creator (rango más bajo) y lo marca aprobado
  const app = C.myApplication(db, "ap");
  C.reviewApplication(db, actor("mod"), { id: app.id, action: "approve" }, t0 + 6 * 86400_000);
  assert.equal(legacyList(db).find((l) => l.roblox_user_id === 701).status, "approved");
  assert.ok(pendingOf(db, 701).includes("tierset:Creator"));

  // Quien aparece por primera vez después del 1 de enero de 2027 pierde el rol de inmediato
  pull = gamePull(db, c, { players: [{ userId: 702, name: "Tarde_2027", level: 9, creatorTier: 2 }] }, Date.parse("2027-01-02T10:00:00-05:00"));
  assert.deepEqual(pull.rewards.map((r) => `${r.kind}:${r.pack}`), ["tierset:None", "notice:legacy_removed"]);
  // Y un aviso de diciembre no pasa del 1 de enero
  gamePull(db, c, { players: [{ userId: 703, name: "Dic_31", level: 9, creatorTier: 1 }] }, Date.parse("2026-12-31T10:00:00-05:00"));
  assert.equal(legacyList(db).find((l) => l.roblox_user_id === 703).deadline_at, Date.parse("2027-01-01T00:00:00-05:00"));
});

test("lista pública y panel del staff", async () => {
  const db = openDb(":memory:"); const c = cfgAuto();
  const now = Date.parse("2026-11-18T10:00:00-05:00");
  seedRoblox(db, c, 800, "Publico_1");
  seedUser(db, "pub", {});
  const app = C.submitApplication(db, "pub", { robloxUserId: 800, age13: true, platforms: [{ type: "YouTube", url: "https://youtube.com/@pub", followers: 5000 }], about: "Videos de huevos todos los días." }, now);
  C.reviewApplication(db, actor("mod"), { id: app.id, action: "approve" }, now);
  const fake = async (url) => ({ ok: true, status: 200, json: async () => ({ data: [{ targetId: 800, state: "Completed", imageUrl: "https://tr.rbxcdn.com/abc.png" }] }) });
  clearPublicCache();
  let pub = await publicCreators(db, c, fake, now);
  assert.equal(pub.creators.length, 1);
  assert.equal(pub.creators[0].platforms[0].followers, 5000);
  assert.equal(pub.creators[0].avatar, "https://tr.rbxcdn.com/abc.png");
  assert.equal(pub.creators[0].tierName, "Creator");
  C.setPublicProfile(db, "pub", false);
  clearPublicCache();
  pub = await publicCreators(db, c, fake, now);
  assert.equal(pub.creators.length, 0);

  const e = C.addEvidence(db, "pub", { url: "https://youtu.be/d1", platform: "YouTube", publishedOn: "2026-11-17" }, now);
  C.reviewEvidence(db, actor("mod"), { id: e.id, action: "approve", views: 3100 }, now);
  const d = creatorsDashboard(db, c, now);
  assert.equal(d.summary.creators, 1);
  assert.equal(d.summary.weekViews, 3100);
  assert.equal(d.creators[0].next.key, "Active");
  assert.equal(d.weeks.length, 8);
  assert.equal(d.platforms[0].platform, "YouTube");
});

test("roles de Discord con el bot: pone el del rango y quita los demás", async () => {
  const db = openDb(":memory:"); const c = cfgAuto();
  c.discord = { ...c.discord, botToken: "bot-token", levelRoles: { Active: "111111", Viral: "222222", Star: "", Elite: "444444" } };
  assert.deepEqual(rolesForTier(c, "Viral"), { add: [ROLE.creator, "222222"], remove: ["111111", "444444"] });
  assert.deepEqual(rolesForTier(c, "None"), { add: [], remove: [ROLE.creator, "111111", "222222", "444444"] });
  const calls = [];
  const fake = async (url, init) => { calls.push(`${init.method} ${url.split("/members/")[1]} ${init.headers.authorization}`); return { ok: true, status: 204, json: async () => null }; };
  const r = await setMemberRoles(c, "123456789", rolesForTier(c, "Elite"), "test", fake);
  assert.equal(r.ok, true);
  assert.ok(calls.includes(`PUT 123456789/roles/444444 Bot bot-token`));
  assert.ok(calls.includes(`DELETE 123456789/roles/111111 Bot bot-token`));
  seedUser(db, "123456789", {});
  await runRoleJobs(db, c, [{ discordId: "123456789", tierKey: "Creator" }], fake, silent);
  assert.equal(C.getDiscordUser(db, "123456789").roles.creator, true);
  // Sin token no hace nada
  c.discord.botToken = "";
  assert.equal((await setMemberRoles(c, "123456789", { add: ["1"] }, "x", fake)).skipped, true);
});

test("2 semanas seguidas sin video: sale del programa (juego y Discord) y puede volver a aplicar", () => {
  const db = openDb(":memory:"); const c = cfgAuto();
  const t0 = Date.parse("2026-11-02T10:00:00-05:00"); // semana 2966
  seedRoblox(db, c, 900, "Inactivo_1"); seedUser(db, "ina", { creator: true });
  const app = C.submitApplication(db, "ina", { robloxUserId: 900, age13: true, platforms: [{ type: "YouTube", url: "https://youtube.com/@ina" }], about: "Prometo videos cada semana." }, t0);
  C.reviewApplication(db, actor("mod"), { id: app.id, action: "approve" }, t0);
  db.prepare("UPDATE creators SET tier = 'Viral' WHERE discord_id = 'ina'").run();
  db.prepare("UPDATE rewards SET status = 'delivered'").run();
  // Semana 2967 con video: racha 0
  C.addEvidence(db, "ina", { url: "https://youtu.be/i1", platform: "YouTube", publishedOn: "2026-11-10" }, Date.parse("2026-11-10T10:00:00-05:00"));
  evaluateCreators(db, c, Date.parse("2026-11-17T02:00:00-05:00"));
  assert.equal(C.getCreator(db, "ina").idle_weeks, 0);
  // Semana 2968 sin video → baja a Creator (racha 1)
  let out = evaluateCreators(db, c, Date.parse("2026-11-24T02:00:00-05:00"));
  assert.equal(out.changes[0].to, "Creator");
  assert.equal(C.getCreator(db, "ina").idle_weeks, 1);
  db.prepare("UPDATE rewards SET status = 'delivered'").run();
  // Viernes de la semana 2969 sin video → aviso de salida
  out = evaluateCreators(db, c, Date.parse("2026-11-27T08:00:00-05:00"));
  assert.equal(out.warnings, 1);
  assert.deepEqual(pendingOf(db, 900), ["notice:removal_warning:Creator"]);
  db.prepare("UPDATE rewards SET status = 'delivered'").run();
  // Semana 2969 sin video → sale del programa
  out = evaluateCreators(db, c, Date.parse("2026-12-01T02:00:00-05:00"));
  assert.deepEqual(out.changes, [{ discordId: "ina", from: "Creator", to: "None" }]);
  assert.equal(out.roleJobs[0].tierKey, "None");
  assert.deepEqual(pendingOf(db, 900), ["tierset:None", "notice:removed_inactive:Creator"]);
  assert.equal(C.getCreator(db, "ina").link_status, "removed");
  assert.equal(C.myApplication(db, "ina").status, "removed");
  assert.throws(() => C.requestLink(db, "ina", 900), /must_reapply/);
  assert.throws(() => C.claimPack(db, c, "ina", { period: "week" }), /link_required/);
  // Vuelve a aplicar y al aprobarlo entra otra vez como Creator
  const again = C.submitApplication(db, "ina", { robloxUserId: 900, age13: true, platforms: [{ type: "YouTube", url: "https://youtube.com/@ina" }], about: "Vuelvo con más videos." }, Date.parse("2026-12-02T10:00:00-05:00"));
  C.reviewApplication(db, actor("mod"), { id: again.id, action: "approve" }, Date.parse("2026-12-02T11:00:00-05:00"));
  const back = C.getCreator(db, "ina");
  assert.equal(back.link_status, "approved");
  assert.equal(back.tier, "Creator");
  assert.equal(back.idle_weeks, 0);
});

test("solicitud rechazada: se quita el rango del juego si lo tenía", () => {
  const db = openDb(":memory:"); const c = cfgAuto();
  const t0 = Date.parse("2026-11-23T10:00:00-05:00");
  gamePull(db, c, { players: [{ userId: 950, name: "Antiguo_X", level: 30, creatorTier: 2 }] }, t0);
  db.prepare("UPDATE rewards SET status = 'delivered'").run();
  seedUser(db, "ax", {});
  const app = C.submitApplication(db, "ax", { robloxUserId: 950, age13: true, platforms: [{ type: "TikTok", url: "https://tiktok.com/@ax" }], about: "Soy creador antiguo." }, t0);
  C.reviewApplication(db, actor("mod"), { id: app.id, action: "reject", note: "Sin videos de Sky Eggs" }, t0 + 3600_000);
  assert.deepEqual(pendingOf(db, 950), ["tierset:None", "notice:rejected"]);
  // El siguiente pull no duplica la quita
  gamePull(db, c, { players: [{ userId: 950, name: "Antiguo_X", level: 30, creatorTier: 2 }] }, t0 + 7200_000);
  assert.deepEqual(pendingOf(db, 950), ["tierset:None", "notice:rejected"]);
});
