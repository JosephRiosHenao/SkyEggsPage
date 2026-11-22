import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db.js";
import { createApp } from "../src/app.js";
import { hashPassword } from "../src/auth.js";
import { gamePull } from "../src/logic.js";
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
  assert.throws(() => C.submitApplication(db, "nuevo", { robloxName: "x" }), /age_required/);
  const app = C.submitApplication(db, "nuevo", { age13: true, robloxName: "Nuevo_YT", platforms: [{ type: "YouTube", url: "https://youtube.com/@nuevo", followers: 1200 }], about: "Hago videos de Roblox cada semana." }, now);
  assert.throws(() => C.submitApplication(db, "nuevo", { age13: true }), /already_pending/);
  assert.equal(C.reviewApplication(db, actor("mod"), { id: app.id, action: "contacted", note: "Le escribí por DM" }).status, "contacted");
  assert.equal(C.reviewApplication(db, actor("mod"), { id: app.id, action: "approve" }).status, "approved");

  // Vinculación (un moderador la aprueba; no puede aprobarse a sí mismo)
  const link = C.requestLink(db, "cre", 500, now);
  assert.match(link.code, /^SKY-[2-9A-HJKMNP-Z]{6}$/);
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

  // El juego recibe: nivel base (de la vinculación) y el pack con su periodo absoluto
  const pull = gamePull(db, c, { players: [{ userId: 500, name: "CreadorPro", level: 1 }] }, now);
  const kinds = pull.rewards.map((r) => `${r.kind}:${r.pack}:${r.period || ""}`).sort();
  assert.deepEqual(kinds, ["creator:V3000:w2968", "tier:Creator:"]);

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

async function withServer(fn, fetchImpl) {
  const db = openDb(":memory:"); const c = cfg();
  const srv = createServer(createApp({ db, cfg: c, log: silent, fetchImpl }));
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
    const apply = await fetch(`${base}/api/creators/apply`, json({ age13: true, robloxName: "FanYT", platforms: [{ type: "TikTok", url: "https://tiktok.com/@fan" }], about: "Quiero grabar Sky Eggs todos los días." }, fan));
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
