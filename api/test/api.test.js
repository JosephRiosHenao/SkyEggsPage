import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { openDb } from "../src/db.js";
import { createApp } from "../src/app.js";
import { hashPassword } from "../src/auth.js";
import { doRoll, gamePull, gameAck, gameRedeem, rollTier, dayKey, metrics, CODE_RE } from "../src/logic.js";

const GAME_KEY = "k".repeat(40);
const cfg = () => ({
  gameKey: GAME_KEY, adminUser: "joseph", adminPasswordHash: hashPassword("clave-super-segura"),
  cookieSecure: false, maxPerDay: { mythic: 5, legendary: 5 }, minLevel: 10, codeTtlHours: 72,
  tzOffsetMin: -300, rollsPerMinute: 1000, ipHeader: "x-real-ip", robloxTimeoutMs: 500,
});
const MYTHIC = () => 999_999; // fuerza Mítico
const LEGEND = () => 998_000;
const COMMON = () => 0;
const silent = { info() {}, warn() {}, error() {} };

function seedPlayer(db, c, { userId = 111, name = "PepitoGamer", displayName = "Pepito ⭐", level = 20 } = {}) {
  gamePull(db, c, { jobId: "job-1", players: [{ userId, name, displayName, level }] });
}

test("probabilidades: los cortes caen donde deben", () => {
  assert.equal(rollTier(() => 0), "common");
  assert.equal(rollTier(() => 799_999), "common");
  assert.equal(rollTier(() => 800_000), "uncommon");
  assert.equal(rollTier(() => 997_499), "epic");
  assert.equal(rollTier(() => 997_500), "legendary");
  assert.equal(rollTier(() => 999_499), "legendary");
  assert.equal(rollTier(() => 999_500), "mythic");
  // muestra real: cerca de 80% comunes
  let commons = 0;
  for (let i = 0; i < 20000; i++) if (rollTier() === "common") commons++;
  assert.ok(commons > 15500 && commons < 16500, `comunes ${commons}`);
});

test("día en hora de Colombia", () => {
  assert.equal(dayKey(Date.parse("2026-11-21T04:59:00Z"), -300), "2026-11-20");
  assert.equal(dayKey(Date.parse("2026-11-21T05:00:00Z"), -300), "2026-11-21");
});

test("modo usuario: máximo 5 míticos por día y luego queda 'capped'", () => {
  const db = openDb(":memory:"); const c = cfg();
  seedPlayer(db, c);
  const now = Date.parse("2026-11-20T15:00:00Z");
  for (let i = 0; i < 5; i++) {
    const r = doRoll(db, c, { mode: "user", userId: 111 }, now, MYTHIC);
    assert.equal(r.reward.kind, "mail");
    assert.equal(r.remaining.mythic, 4 - i);
  }
  const sixth = doRoll(db, c, { mode: "user", userId: 111 }, now, MYTHIC);
  assert.equal(sixth.capped, true);
  assert.equal(sixth.reward, undefined);
  // los legendarios tienen su propio tope
  assert.equal(doRoll(db, c, { mode: "user", userId: 111 }, now, LEGEND).reward.kind, "mail");
  // al día siguiente se reinicia
  const tomorrow = now + 86_400_000;
  assert.equal(doRoll(db, c, { mode: "user", userId: 111 }, tomorrow, MYTHIC).reward.kind, "mail");
  // comunes no dan nada
  assert.equal(doRoll(db, c, { mode: "user", userId: 111 }, now, COMMON).reward, undefined);
});

test("modo usuario: jugador desconocido no puede tirar", () => {
  const db = openDb(":memory:");
  assert.throws(() => doRoll(db, cfg(), { mode: "user", userId: 999 }, Date.now(), MYTHIC), /unknown_player/);
});

test("el juego recibe los premios pendientes, una sola vez, y respeta el nivel mínimo", () => {
  const db = openDb(":memory:"); const c = cfg();
  seedPlayer(db, c, { level: 3 });
  doRoll(db, c, { mode: "user", userId: 111 }, Date.now(), MYTHIC);
  const r = doRoll(db, c, { mode: "user", userId: 111 }, Date.now(), LEGEND);
  assert.equal(r.reward.needsLevel, 10);
  // nivel 3 → no se entrega aún
  assert.equal(gamePull(db, c, { jobId: "a", players: [{ userId: 111, name: "PepitoGamer", level: 3 }] }).rewards.length, 0);
  // nivel 12 → llegan los dos
  const pull = gamePull(db, c, { jobId: "a", players: [{ userId: 111, name: "PepitoGamer", level: 12 }] });
  assert.deepEqual(pull.rewards.map((x) => x.tier).sort(), ["legendary", "mythic"]);
  assert.equal(gameAck(db, { ids: pull.rewards.map((x) => x.id) }).updated, 2);
  assert.equal(gameAck(db, { ids: pull.rewards.map((x) => x.id) }).updated, 0); // repetir no cambia nada
  assert.equal(gamePull(db, c, { jobId: "a", players: [{ userId: 111, name: "PepitoGamer", level: 12 }] }).rewards.length, 0);
});

test("códigos: se canjean una vez, el mismo jugador puede reintentar, otro no", () => {
  const db = openDb(":memory:"); const c = cfg();
  const r = doRoll(db, c, { mode: "code" }, Date.now(), MYTHIC);
  assert.match(r.code, CODE_RE);
  const pretty = `${r.code.slice(0, 3)} ${r.code.slice(3, 8)}-${r.code.slice(8)}`.toLowerCase();
  const p = { userId: 222, name: "Lucia_2014", displayName: "Lu", level: 50 };
  const a = gameRedeem(db, c, { ...p, code: pretty });
  assert.equal(a.ok, true); assert.equal(a.reward.tier, "mythic");
  const again = gameRedeem(db, c, { ...p, code: r.code });
  assert.equal(again.ok, true); assert.equal(again.reward.id, a.reward.id); // reintento idempotente
  gameAck(db, { ids: [a.reward.id] });
  assert.equal(gameRedeem(db, c, { ...p, code: r.code }).error, "used");
  assert.equal(gameRedeem(db, c, { userId: 333, name: "OtroJugador", level: 50, code: r.code }).error, "used");
  assert.equal(gameRedeem(db, c, { ...p, code: "SKYAAAAAAAAAA" }).error, "invalid");
  assert.equal(gameRedeem(db, c, { ...p, code: "hola" }).error, "invalid");
});

test("códigos: caducan, piden nivel y cuentan para el tope diario", () => {
  const db = openDb(":memory:"); const c = cfg();
  const t0 = Date.parse("2026-11-20T15:00:00Z");
  const old = doRoll(db, c, { mode: "code" }, t0 - 73 * 3_600_000, MYTHIC);
  const p = { userId: 444, name: "Tomas_Pro", level: 50 };
  assert.equal(gameRedeem(db, c, { ...p, code: old.code }, t0).error, "expired");
  const low = doRoll(db, c, { mode: "code" }, t0, MYTHIC);
  assert.equal(gameRedeem(db, c, { ...p, level: 2, code: low.code }, t0).error, "level");
  assert.equal(gameRedeem(db, c, { ...p, code: low.code }, t0).ok, true); // no se gastó al fallar por nivel
  for (let i = 0; i < 4; i++) assert.equal(gameRedeem(db, c, { ...p, code: doRoll(db, c, { mode: "code" }, t0, MYTHIC).code }, t0).ok, true);
  const sixth = doRoll(db, c, { mode: "code" }, t0, MYTHIC);
  assert.equal(gameRedeem(db, c, { ...p, code: sixth.code }, t0).error, "capped");
  // y el modo usuario también ve el tope
  assert.equal(doRoll(db, c, { mode: "user", userId: 444 }, t0, MYTHIC).capped, true);
});

test("métricas", () => {
  const db = openDb(":memory:"); const c = cfg();
  seedPlayer(db, c);
  doRoll(db, c, { mode: "user", userId: 111 }, Date.now(), MYTHIC);
  doRoll(db, c, { mode: "user", userId: 111 }, Date.now(), COMMON);
  doRoll(db, c, { mode: "code" }, Date.now(), LEGEND);
  const m = metrics(db, c, 7);
  assert.equal(m.rolls.total, 3);
  assert.equal(m.rolls.byTierToday.mythic, 1);
  assert.equal(m.codes.issued, 1);
  assert.equal(m.rewards.pending, 1);
  assert.equal(m.connections.serversToday, 1);
  assert.equal(m.series.length, 7);
  assert.equal(m.rewards.recent[0].name, "PepitoGamer");
});

// ---------- HTTP ----------
async function withServer(fn, fetchImpl) {
  const db = openDb(":memory:"); const c = cfg();
  const srv = createServer(createApp({ db, cfg: c, log: silent, fetchImpl }));
  await new Promise((r) => srv.listen(0, r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  try { await fn(base, db, c); } finally { srv.close(); }
}
const json = (body, extra = {}) => ({ method: "POST", headers: { "content-type": "application/json", ...extra }, body: JSON.stringify(body) });

test("HTTP: los endpoints del juego exigen la clave", async () => {
  await withServer(async (base) => {
    assert.equal((await fetch(`${base}/api/game/pull`, json({ players: [] }))).status, 401);
    assert.equal((await fetch(`${base}/api/game/pull`, json({ players: [] }, { "x-game-key": "mala" }))).status, 401);
    assert.equal((await fetch(`${base}/api/game/pull`, json({ players: [] }, { "x-game-key": GAME_KEY }))).status, 200);
  });
});

test("HTTP: login del panel, cookie y métricas", async () => {
  await withServer(async (base) => {
    assert.equal((await fetch(`${base}/api/admin/metrics`)).status, 401);
    assert.equal((await fetch(`${base}/api/admin/login`, json({ user: "joseph", password: "mal" }))).status, 401);
    const ok = await fetch(`${base}/api/admin/login`, json({ user: "joseph", password: "clave-super-segura" }));
    assert.equal(ok.status, 200);
    const setCookie = ok.headers.get("set-cookie");
    assert.match(setCookie, /HttpOnly/); assert.match(setCookie, /SameSite=Strict/);
    const cookie = setCookie.split(";")[0];
    const m = await fetch(`${base}/api/admin/metrics?days=14`, { headers: { cookie } });
    assert.equal(m.status, 200);
    assert.equal((await m.json()).series.length, 14);
    await fetch(`${base}/api/admin/logout`, json({}, { cookie }));
    assert.equal((await fetch(`${base}/api/admin/metrics`, { headers: { cookie } })).status, 401);
  });
});

test("HTTP: login bloqueado tras 5 intentos", async () => {
  await withServer(async (base) => {
    for (let i = 0; i < 5; i++) await fetch(`${base}/api/admin/login`, json({ user: "x", password: "y" }, { "x-real-ip": "9.9.9.9" }));
    const r = await fetch(`${base}/api/admin/login`, json({ user: "joseph", password: "clave-super-segura" }, { "x-real-ip": "9.9.9.9" }));
    assert.equal(r.status, 429);
  });
});

test("HTTP: otro origen no puede tirar", async () => {
  await withServer(async (base) => {
    const r = await fetch(`${base}/api/roll`, json({ mode: "code" }, { origin: "https://malo.com" }));
    assert.equal(r.status, 403);
    const ok = await fetch(`${base}/api/roll`, json({ mode: "code" }));
    assert.equal(ok.status, 200);
    assert.ok((await ok.json()).tier);
  });
});

test("HTTP: búsqueda acepta usuario o nombre visible y prioriza a quien juega", async () => {
  const fake = async (url, init) => {
    const u = String(url);
    const reply = (data) => ({ ok: true, json: async () => ({ data }) });
    if (u.includes("/usernames/users")) {
      const name = JSON.parse(init.body).usernames[0];
      return reply(name.toLowerCase() === "pepitogamer" ? [{ id: 111, name: "PepitoGamer", displayName: "Pepito ⭐" }] : []);
    }
    if (u.includes("/users/search")) return reply([{ id: 555, name: "pepito_fake", displayName: "Pepito" }, { id: 111, name: "PepitoGamer", displayName: "Pepito ⭐" }]);
    if (u.includes("avatar-headshot")) return reply([{ targetId: 111, state: "Completed", imageUrl: "https://tr.rbxcdn.com/abc/150/150/AvatarHeadshot/Png" }]);
    return { ok: false };
  };
  await withServer(async (base, db, c) => {
    seedPlayer(db, c); // el juego ya vio a PepitoGamer (nombre visible "Pepito ⭐")
    const byDisplay = await (await fetch(`${base}/api/players/search?q=${encodeURIComponent("Pepito ⭐")}`)).json();
    assert.equal(byDisplay.players[0].userId, 111);
    assert.equal(byDisplay.players[0].played, true);
    const byUser = await (await fetch(`${base}/api/players/search?q=@pepitogamer`)).json();
    assert.equal(byUser.players[0].userId, 111);
    assert.equal(byUser.players[0].avatar, "https://tr.rbxcdn.com/abc/150/150/AvatarHeadshot/Png");
    // un jugador que solo salió en la búsqueda también puede tirar
    const roll = await fetch(`${base}/api/roll`, json({ mode: "user", userId: 555 }));
    assert.equal(roll.status, 200);
  }, fake);
});

// ---------- Panel: códigos y regalos ----------
import { adminCreateCodes, adminGift, adminListCodes } from "../src/logic.js";

test("panel: códigos del staff saltan nivel y tope, y son de un solo uso", () => {
  const db = openDb(":memory:"); const c = cfg();
  const t0 = Date.parse("2026-11-20T15:00:00Z");
  assert.equal(adminCreateCodes(db, { tier: "epic", count: 1 }).error, "bad_tier");
  const r = adminCreateCodes(db, { tier: "mythic", count: 3, days: 7 }, t0);
  assert.equal(r.codes.length, 3);
  r.codes.forEach((code) => assert.match(code, CODE_RE));
  assert.equal(r.expiresAt, t0 + 7 * 86_400_000);
  const p = { userId: 777, name: "Nuevo_Jugador", level: 1 };
  // el jugador ya tiene sus 5 míticas del día por la página
  gamePull(db, c, { players: [{ ...p, level: 50 }] }, t0);
  for (let i = 0; i < 5; i++) doRoll(db, c, { mode: "user", userId: 777 }, t0, MYTHIC);
  const a = gameRedeem(db, c, { ...p, code: r.codes[0] }, t0); // nivel 1 y tope lleno: igual entra
  assert.equal(a.ok, true); assert.equal(a.reward.source, "admin");
  assert.equal(gameRedeem(db, c, { userId: 778, name: "Otro_Jugador", level: 1, code: r.codes[0] }, t0).error, "used");
  assert.equal(gameRedeem(db, c, { ...p, code: r.codes[1] }, t0 + 8 * 86_400_000).error, "expired");
  const list = adminListCodes(db, t0);
  assert.equal(list.length, 3);
  assert.equal(list.find((x) => x.code === r.codes[0]).status, "redeemed");
  assert.equal(list.find((x) => x.code === r.codes[0]).name, "Nuevo_Jugador");
});

test("panel: regalo directo llega aunque no tenga el nivel y no gasta el tope", () => {
  const db = openDb(":memory:"); const c = cfg();
  seedPlayer(db, c, { level: 2 });
  assert.equal(adminGift(db, c, { userId: 999, tier: "mythic" }).error, "unknown_player");
  assert.equal(adminGift(db, c, { userId: 111, tier: "dorado" }).error, "bad_tier");
  const g = adminGift(db, c, { userId: 111, tier: "rare", count: 50 });
  assert.equal(g.sent, 10); // tope por envío
  adminGift(db, c, { userId: 111, tier: "mythic", count: 2 });
  const pull = gamePull(db, c, { players: [{ userId: 111, name: "PepitoGamer", level: 2 }] });
  assert.equal(pull.rewards.length, 12);
  assert.ok(pull.rewards.every((x) => x.source === "admin"));
  // sus 5 míticas diarias de la página siguen disponibles
  seedPlayer(db, c, { level: 20 });
  assert.equal(doRoll(db, c, { mode: "user", userId: 111 }, Date.now(), MYTHIC).remaining.mythic, 4);
});

test("HTTP: acciones del panel exigen sesión", async () => {
  await withServer(async (base, db, c) => {
    seedPlayer(db, c);
    assert.equal((await fetch(`${base}/api/admin/codes`, json({ tier: "mythic", count: 1 }))).status, 401);
    assert.equal((await fetch(`${base}/api/admin/gift`, json({ userId: 111, tier: "mythic" }))).status, 401);
    const login = await fetch(`${base}/api/admin/login`, json({ user: "joseph", password: "clave-super-segura" }));
    const cookie = login.headers.get("set-cookie").split(";")[0];
    const codes = await (await fetch(`${base}/api/admin/codes`, json({ tier: "legendary", count: 2 }, { cookie }))).json();
    assert.equal(codes.codes.length, 2);
    const gift = await (await fetch(`${base}/api/admin/gift`, json({ userId: 111, tier: "mythic", count: 1 }, { cookie }))).json();
    assert.equal(gift.ok, true);
    const other = await fetch(`${base}/api/admin/gift`, json({ userId: 111, tier: "mythic" }, { cookie, origin: "https://malo.com" }));
    assert.equal(other.status, 403);
    const list = await (await fetch(`${base}/api/admin/codes`, { headers: { cookie } })).json();
    assert.equal(list.codes.length, 2);
  });
});
