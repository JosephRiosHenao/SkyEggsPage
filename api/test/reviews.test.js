import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db.js";
import * as C from "../src/creators.js";
import { postReview, resolveReview, handleReviewButton } from "../src/reviews.js";

const CHANNEL = "1565510042851999834";
const ROLE = { admin: "1560889139375898775", moderator: "1563742282392543312", creator: "1561051688125730897" };
const STAFF_ROLES = { Helper: "1563735797444771961", ModeratorJr: "1563736116300087337", Moderator: "1563736465522036736" };
const cfg = () => ({
  gameKey: "k".repeat(40), minLevel: 0, tzOffsetMin: -300, maxPerDay: { mythic: 5, legendary: 5 }, robloxTimeoutMs: 300, uploadsDir: mkdtempSync(join(tmpdir(), "rv-")),
  siteUrl: "https://skyeggs.pro", roblox: { placeId: "77372347150746" },
  discord: { clientId: "a", clientSecret: "b", guildId: "999", roles: ROLE, staffRoles: STAFF_ROLES, botToken: "tok", announceChannel: CHANNEL, publicKey: "a".repeat(64), levelRoles: {}, videoChannel: "1", eggChannel: "2" },
  creators: { claimGraceDaysWeek: 3, claimGraceDaysMonth: 5, autoTiers: true, warnDaysBefore: 3, demotionGraceHours: 24, legacyNoticeDays: 3, legacyDeadline: Date.parse("2027-01-01T00:00:00-05:00") },
  staff: { linkDeadline: Date.parse("2026-12-01T00:00:00-05:00"), failMonthsToRemove: 2, warnDay: 20, graceDays: 3 },
});
const now = Date.parse("2026-11-24T10:00:00-05:00");

// fetch simulado: registra cada llamada y responde mensajes con id
function fakeDiscord() {
  const calls = [];
  let n = 0;
  const impl = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || "GET", body: init.body ? JSON.parse(init.body) : null });
    const body = String(url).includes("/messages") && init.method === "POST" ? { id: `m${++n}` } : {};
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  };
  return { impl, calls };
}

function seed(db) {
  C.upsertDiscordUser(db, { id: "10001", username: "sandoval_25", global_name: "Sandoval" }, { inGuild: true });
  C.upsertDiscordUser(db, { id: "20001", username: "mod_ana", global_name: "Ana" }, { inGuild: true, moderator: true });
  C.upsertDiscordUser(db, { id: "30001", username: "jugador" }, { inGuild: true });
  db.prepare("INSERT INTO staff (discord_id, roblox_user_id, roblox_name, roblox_display, rank, link_status, joined_at) VALUES ('10001', 555, 'sandoval_25', 'Sandoval', 'Helper', 'approved', ?)").run(now);
  db.prepare("INSERT INTO staff_evidence (discord_id, task, month, amount, url, note, created_at) VALUES ('10001', 'helps', '2026-11', 3, 'https://youtu.be/abc', 'Ayudé a tres jugadores en el juego', ?)").run(now);
  return Number(db.prepare("SELECT id FROM staff_evidence").get().id);
}

test("la tarjeta de revisión va al canal del staff con embed, enlaces y botones", async () => {
  const db = openDb(":memory:"); const c = cfg(); const id = seed(db);
  const { impl, calls } = fakeDiscord();
  const r = await postReview(db, c, "staff_evidence", id, impl, now);
  assert.equal(r.sent, true);
  const post = calls.find((x) => x.method === "POST");
  assert.match(post.url, new RegExp(`/channels/${CHANNEL}/messages$`));
  assert.match(post.body.content, /sandoval_25|Sandoval/);
  assert.match(post.body.content, /Ayuda|ayudas|Ayudas|helps|Ayudas a jugadores/i);
  const embed = post.body.embeds[0];
  assert.match(embed.title, /Ayudas a jugadores/);
  assert.equal(embed.url, "https://skyeggs.pro/creadores/panel/#staff-revision");
  assert.equal(embed.fields.find((f) => f.name === "Pide sumar").value, "3");
  const rows = post.body.components;
  assert.equal(rows.length, 2);
  assert.ok(rows[0].components.some((b) => b.url === "https://skyeggs.pro/creadores/panel/#staff-revision"));
  assert.ok(rows[1].components.some((b) => b.custom_id === `rv:${db.prepare("SELECT id FROM review_posts").get().id}:claim`));
  const row = db.prepare("SELECT * FROM review_posts").get();
  assert.equal(row.message_id, "m1");
  assert.equal(row.channel_id, CHANNEL);
  assert.equal(row.status, "open");
});

test("al aprobar en el panel el mensaje se edita: aprobado por, sin botones de acción", async () => {
  const db = openDb(":memory:"); const c = cfg(); const id = seed(db);
  const { impl, calls } = fakeDiscord();
  await postReview(db, c, "staff_evidence", id, impl, now);
  await resolveReview(db, c, "staff_evidence", id, { status: "approved", by: "Ana (@mod_ana)", note: "Bien hecho" }, impl, now + 60_000);
  const patch = calls.find((x) => x.method === "PATCH");
  assert.match(patch.url, new RegExp(`/channels/${CHANNEL}/messages/m1$`));
  const embed = patch.body.embeds[0];
  assert.match(embed.title, /✅/);
  assert.equal(embed.color, 0x22c55e);
  assert.ok(embed.fields.some((f) => f.name === "Aprobado por" && f.value.includes("Ana") && f.value.includes("mod_ana")));
  assert.ok(embed.fields.some((f) => f.name === "Nota" && f.value === "Bien hecho"));
  const labels = patch.body.components.flatMap((r) => r.components.map((b) => b.label));
  assert.ok(!labels.some((l) => /reviso|Liberar/.test(l))); // ya no se puede tomar
  assert.ok(labels.includes("Ver detalles"));
  assert.equal(db.prepare("SELECT status FROM review_posts").get().status, "approved");
  // Una segunda resolución no encuentra tarjeta abierta
  assert.equal(await resolveReview(db, c, "staff_evidence", id, { status: "rejected", by: "x" }, impl, now), null);
});

test("«contactado» no cierra la tarjeta y rechazar la marca como rechazada", async () => {
  const db = openDb(":memory:"); const c = cfg(); const id = seed(db);
  const { impl, calls } = fakeDiscord();
  await postReview(db, c, "staff_evidence", id, impl, now);
  assert.equal(await resolveReview(db, c, "staff_evidence", id, { status: "contacted", by: "Ana" }, impl, now), null);
  await resolveReview(db, c, "staff_evidence", id, { status: "rejected", by: "Ana" }, impl, now);
  assert.equal(db.prepare("SELECT status FROM review_posts").get().status, "rejected");
  assert.match(calls.find((x) => x.method === "PATCH").body.embeds[0].title, /❌/);
});

test("botón «Lo reviso yo»: lo toma el staff, lo ve todo el canal y se libera", async () => {
  const db = openDb(":memory:"); const c = cfg(); const id = seed(db);
  const { impl } = fakeDiscord();
  await postReview(db, c, "staff_evidence", id, impl, now);
  const rid = db.prepare("SELECT id FROM review_posts").get().id;
  const it = (uid) => ({ type: 3, data: { custom_id: `rv:${rid}:claim` }, member: { user: { id: uid, username: "x", global_name: "Ana" } } });
  const took = await handleReviewButton(db, c, it("20001"));
  assert.equal(took.type, 7); // UPDATE_MESSAGE
  assert.ok(took.data.embeds[0].fields.some((f) => f.name === "👀 Lo revisa" && f.value === "Ana"));
  assert.equal(took.data.components[1].components[0].label, "Liberar");
  const released = await handleReviewButton(db, c, it("20001"));
  assert.equal(released.data.components[1].components[0].label, "Lo reviso yo");
});

test("«Ver detalles» solo para el staff; un jugador no puede usar los botones", async () => {
  const db = openDb(":memory:"); const c = cfg(); const id = seed(db);
  const { impl } = fakeDiscord();
  await postReview(db, c, "staff_evidence", id, impl, now);
  const rid = db.prepare("SELECT id FROM review_posts").get().id;
  const fan = await handleReviewButton(db, c, { type: 3, data: { custom_id: `rv:${rid}:more` }, member: { user: { id: "30001" } } });
  assert.match(fan.data.content, /solo para el staff/);
  const mod = await handleReviewButton(db, c, { type: 3, data: { custom_id: `rv:${rid}:more` }, member: { user: { id: "20001" } } });
  assert.match(mod.data.content, /Ayudé a tres jugadores/);
});

test("sin bot o con el aviso apagado no queda tarjeta huérfana", async () => {
  const db = openDb(":memory:"); const c = cfg(); const id = seed(db);
  c.discord.botToken = "";
  const r = await postReview(db, c, "staff_evidence", id, async () => new Response("{}"), now);
  assert.equal(r.sent, false);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM review_posts").get().n, 0);
});
