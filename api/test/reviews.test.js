import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db.js";
import * as C from "../src/creators.js";
import * as S from "../src/staff.js";
import { postReview, resolveReview, handleReviewButton, sweepReviews, canResolve } from "../src/reviews.js";

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


// Usuarios con Roblox vinculado (obligatorio para revisar, igual que en el panel).
function user(db, id, username, roles, robloxId, staffRank) {
  C.upsertDiscordUser(db, { id, username, global_name: username[0].toUpperCase() + username.slice(1) }, { inGuild: true, ...roles });
  db.prepare("INSERT OR IGNORE INTO players (user_id, name, display_name, name_lc, display_lc, played, level, first_seen, last_seen) VALUES (?, ?, ?, ?, ?, 1, 20, ?, ?)")
    .run(robloxId, username, username, username, username, now, now);
  db.prepare("UPDATE discord_users SET roblox_user_id = ? WHERE id = ?").run(robloxId, id);
  if (staffRank) db.prepare("INSERT INTO staff (discord_id, roblox_user_id, roblox_name, roblox_display, rank, link_status, joined_at) VALUES (?, ?, ?, ?, ?, 'approved', ?)").run(id, robloxId, username, username, staffRank, now);
}
function seed(db) {
  user(db, "10001", "sandoval_25", {}, 555, "Helper");
  user(db, "20001", "ana", { moderator: true }, 556);
  user(db, "40001", "leo", {}, 557, "ModeratorJr");
  user(db, "50001", "jefe", { admin: true }, 558);
  C.upsertDiscordUser(db, { id: "30001", username: "jugador" }, { inGuild: true });
  db.prepare("INSERT INTO staff_evidence (discord_id, task, month, amount, url, note, created_at) VALUES ('10001', 'helps', '2026-11', 3, 'https://youtu.be/abc', 'Ayudé a tres jugadores en el juego', ?)").run(now);
  return Number(db.prepare("SELECT id FROM staff_evidence").get().id);
}
const click = (rid, action, uid, extra = {}) => ({ type: 3, application_id: "app", token: "t", data: { custom_id: `rv:${rid}:${action}` }, member: { user: { id: uid, username: "x", global_name: uid === "40001" ? "Leo" : "Ana" } }, ...extra });
const submit = (rid, action, uid, fields) => ({
  type: 5, data: { custom_id: `rv:${rid}:${action}`, components: Object.entries(fields).map(([k, v]) => ({ type: 1, components: [{ type: 4, custom_id: k, value: v }] })) },
  member: { user: { id: uid, username: "x", global_name: "Leo" } },
});
// Igual que app.js: revisión del panel + cerrar la tarjeta.
const actFor = (db, c, impl) => async (kind, a, b) => {
  if (kind !== "staff_evidence") throw new Error("solo evidencias en esta prueba");
  try { S.reviewStaffEvidence(db, a, b); } catch (e) { const err = new Error(e.code); err.code = e.code; throw err; }
  await resolveReview(db, c, kind, b.id, { status: b.action === "approve" ? "approved" : "rejected", by: a.name, note: b.note }, impl);
};

test("la tarjeta va al canal del staff con contexto, quién la resuelve y botones", async () => {
  const db = openDb(":memory:"); const c = cfg(); const id = seed(db);
  const { impl, calls } = fakeDiscord();
  const r = await postReview(db, c, "staff_evidence", id, impl, now);
  assert.equal(r.sent, true);
  const post = calls.find((x) => x.method === "POST" && x.url.includes("/messages"));
  assert.match(post.url, new RegExp(`/channels/${CHANNEL}/messages$`));
  assert.match(post.body.content, /Sandoval_25|sandoval_25/);
  const embed = post.body.embeds[0];
  assert.match(embed.title, /Ayudas a jugadores/);
  assert.match(embed.author.name, /Helper/);
  assert.equal(embed.url, "https://skyeggs.pro/creadores/panel/#staff-revision");
  const f = (n) => embed.fields.find((x) => x.name === n)?.value;
  assert.match(f("Pide sumar"), /^3/);
  assert.equal(f("Discord"), "<@10001>");
  assert.equal(f("🛡️ Lo resuelve"), "Moderator Jr, Moderator o Admin");
  assert.match(f("📈 Progreso del mes en esta tarea"), /Si se aprueba/);
  const [links, acts] = post.body.components;
  assert.ok(links.components.some((b) => b.url === "https://skyeggs.pro/creadores/panel/#staff-revision" && b.label === "Abrir en el panel"));
  assert.ok(links.components.some((b) => b.url === "https://www.roblox.com/users/555/profile"));
  assert.deepEqual(acts.components.map((b) => b.label), ["Aprobar", "Rechazar", "Lo reviso yo", "Ver detalles"]);
  const row = db.prepare("SELECT * FROM review_posts").get();
  assert.equal(row.message_id, "m1");
  assert.equal(row.status, "open");
});

test("quién puede resolver cada tipo", () => {
  const A = (role, staffRank = null, id = "x") => ({ id, role, staffRank });
  const helperEv = { owner: "1", ownerRank: "Helper" }, jrEv = { owner: "1", ownerRank: "ModeratorJr" }, modEv = { owner: "1", ownerRank: "Moderator" };
  assert.equal(canResolve("staff_evidence", helperEv, A("modjr", "ModeratorJr")), null);
  assert.equal(canResolve("staff_evidence", jrEv, A("modjr", "ModeratorJr")), "forbidden");
  assert.equal(canResolve("staff_evidence", jrEv, A("moderator", "Moderator")), null);
  assert.equal(canResolve("staff_excuse", modEv, A("moderator", "Moderator")), "forbidden");
  assert.equal(canResolve("staff_excuse", modEv, A("admin")), null);
  assert.equal(canResolve("staff_application", { owner: "1" }, A("modjr", "ModeratorJr")), "forbidden");
  assert.equal(canResolve("staff_application", { owner: "1" }, A("moderator")), null);
  assert.equal(canResolve("staff_link", { owner: "1", ownerRank: "Moderator" }, A("moderator", "Moderator")), "forbidden");
  assert.equal(canResolve("staff_link", { owner: "1", ownerRank: "Helper" }, A("moderator", "Moderator")), null);
  assert.equal(canResolve("creator_evidence", { owner: "1" }, A("modjr", "ModeratorJr")), "forbidden");
  assert.equal(canResolve("creator_evidence", { owner: "1" }, A("moderator")), null);
  assert.equal(canResolve("creator_link", { owner: "x" }, A("admin", null, "x")), "own_item");
});

test("Aprobar desde Discord: formulario con la cantidad, se aprueba y la tarjeta se edita", async () => {
  const db = openDb(":memory:"); const c = cfg(); const id = seed(db);
  const { impl, calls } = fakeDiscord();
  await postReview(db, c, "staff_evidence", id, impl, now);
  const rid = db.prepare("SELECT id FROM review_posts").get().id;
  const form = await handleReviewButton(db, c, click(rid, "approve", "40001"), { fetchImpl: impl });
  assert.equal(form.type, 9);
  const amount = form.data.components[0].components[0];
  assert.equal(amount.custom_id, "amount");
  assert.equal(amount.value, "3");
  const out = await handleReviewButton(db, c, submit(rid, "approve", "40001", { amount: "2", note: "Solo dos se ven en el video" }), { act: actFor(db, c, impl), fetchImpl: impl });
  assert.equal(out.type, 6);
  assert.match(await out.defer(), /Aprobada/);
  const ev = db.prepare("SELECT status, approved, reviewed_by FROM staff_evidence WHERE id = ?").get(id);
  assert.equal(ev.status, "approved");
  assert.equal(ev.approved, 2);
  assert.match(ev.reviewed_by, /Leo/);
  const patch = calls.find((x) => x.method === "PATCH");
  assert.match(patch.url, new RegExp(`/channels/${CHANNEL}/messages/m1$`));
  assert.match(patch.body.content, /✅ \*\*Aprobado\*\* por .*Leo/);
  const embed = patch.body.embeds[0];
  assert.match(embed.title, /✅ Aprobado/);
  assert.equal(embed.color, 0x22c55e);
  assert.ok(embed.fields.some((f) => f.name === "✅ Aprobado por" && f.value.includes("Leo")));
  assert.ok(embed.fields.some((f) => f.name === "Cuándo" && /tardó/.test(f.value)));
  assert.ok(embed.fields.some((f) => f.name === "Nota" && f.value.includes("Solo dos")));
  const labels = patch.body.components.flatMap((r) => r.components.map((b) => b.label));
  assert.ok(labels.includes("Abrir en el panel"));
  assert.ok(!labels.some((l) => /Aprobar|Rechazar|reviso|Liberar/.test(l)));
  assert.equal(db.prepare("SELECT status FROM review_posts").get().status, "approved");
});

test("Rechazar pide motivo; si otro ya la resolvió, avisa y no rompe nada", async () => {
  const db = openDb(":memory:"); const c = cfg(); const id = seed(db);
  const { impl } = fakeDiscord();
  await postReview(db, c, "staff_evidence", id, impl, now);
  const rid = db.prepare("SELECT id FROM review_posts").get().id;
  const form = await handleReviewButton(db, c, click(rid, "reject", "20001"), {});
  const note = form.data.components[0].components[0];
  assert.equal(note.custom_id, "note");
  assert.equal(note.required, true);
  // Mientras tanto otro lo aprueba en el panel
  S.reviewStaffEvidence(db, { id: "40001", name: "Leo", role: "modjr", staffRank: "ModeratorJr" }, { id, action: "approve" });
  const out = await handleReviewButton(db, c, submit(rid, "reject", "20001", { note: "No se ve nada" }), { act: actFor(db, c, impl), fetchImpl: impl });
  assert.match(await out.defer(), /ya la revisó/);
  assert.equal(db.prepare("SELECT status FROM review_posts").get().status, "approved"); // el barrido la cerró
});

test("los botones respetan el rango: jugador, el dueño y un rango que no alcanza", async () => {
  const db = openDb(":memory:"); const c = cfg();
  seed(db);
  // Evidencia de un Moderator Jr: la resuelven Moderator o Admin, no otro Jr.
  db.prepare("INSERT INTO staff_evidence (discord_id, task, month, amount, note, created_at) VALUES ('40001', 'helps', '2026-11', 1, 'x', ?)").run(now);
  const jrEv = Number(db.prepare("SELECT MAX(id) AS id FROM staff_evidence").get().id);
  const { impl } = fakeDiscord();
  await postReview(db, c, "staff_evidence", jrEv, impl, now);
  const rid = db.prepare("SELECT id FROM review_posts").get().id;
  assert.match((await handleReviewButton(db, c, click(rid, "approve", "30001"))).data.content, /Vincula tu cuenta de Roblox/);
  assert.match((await handleReviewButton(db, c, click(rid, "approve", "40001"))).data.content, /Es tuya/);
  assert.match((await handleReviewButton(db, c, click(rid, "claim", "10001"))).data.content, /Moderator o Admin/);
  assert.equal((await handleReviewButton(db, c, click(rid, "approve", "20001"))).type, 9);
  assert.equal((await handleReviewButton(db, c, click(rid, "approve", "50001"))).type, 9);
});

test("«Lo reviso yo»: lo ve todo el canal, otro no se lo quita (salvo el Admin) y se libera", async () => {
  const db = openDb(":memory:"); const c = cfg(); const id = seed(db);
  const { impl } = fakeDiscord();
  await postReview(db, c, "staff_evidence", id, impl, now);
  const rid = db.prepare("SELECT id FROM review_posts").get().id;
  const took = await handleReviewButton(db, c, click(rid, "claim", "20001"));
  assert.equal(took.type, 7);
  assert.ok(took.data.embeds[0].fields.some((f) => f.name === "👀 Lo revisa" && f.value === "Ana"));
  assert.equal(took.data.components[1].components[2].label, "Liberar");
  assert.match((await handleReviewButton(db, c, click(rid, "claim", "40001"))).data.content, /Ya la está revisando Ana/);
  const released = await handleReviewButton(db, c, click(rid, "claim", "20001"));
  assert.equal(released.data.components[1].components[2].label, "Lo reviso yo");
});

test("«Ver detalles» solo para el staff", async () => {
  const db = openDb(":memory:"); const c = cfg(); const id = seed(db);
  const { impl } = fakeDiscord();
  await postReview(db, c, "staff_evidence", id, impl, now);
  const rid = db.prepare("SELECT id FROM review_posts").get().id;
  assert.match((await handleReviewButton(db, c, click(rid, "more", "10001"))).data.content, /solo para el staff/);
  const mod = await handleReviewButton(db, c, click(rid, "more", "20001"));
  assert.match(mod.data.content, /Ayudé a tres jugadores/);
  assert.match(mod.data.content, /Lo resuelve: Moderator Jr, Moderator o Admin/);
});

test("«contactado» no cierra; una solicitud nueva reemplaza a la anterior; el barrido cierra lo retirado", async () => {
  const db = openDb(":memory:"); const c = cfg(); const id = seed(db);
  const { impl } = fakeDiscord();
  await postReview(db, c, "staff_evidence", id, impl, now);
  assert.equal(await resolveReview(db, c, "staff_evidence", id, { status: "contacted", by: "Ana" }, impl, now), null);
  await postReview(db, c, "staff_evidence", id, impl, now + 1000);
  const rows = db.prepare("SELECT status, resolve_note FROM review_posts ORDER BY id").all();
  assert.equal(rows[0].status, "closed");
  assert.match(rows[0].resolve_note, /Reemplazada/);
  assert.equal(rows[1].status, "open");
  db.prepare("DELETE FROM staff_evidence WHERE id = ?").run(id);
  assert.equal((await sweepReviews(db, c, impl, now + 2000)).closed, 1);
  assert.equal(db.prepare("SELECT status FROM review_posts ORDER BY id DESC").get().status, "closed");
});

test("sin bot no queda tarjeta huérfana", async () => {
  const db = openDb(":memory:"); const c = cfg(); const id = seed(db);
  c.discord.botToken = "";
  const r = await postReview(db, c, "staff_evidence", id, async () => new Response("{}"), now);
  assert.equal(r.sent, false);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM review_posts").get().n, 0);
});

test("los 7 tipos arman su tarjeta y su formulario", async () => {
  const db = openDb(":memory:"); const c = cfg(); seed(db);
  const { impl, calls } = fakeDiscord();
  db.prepare("INSERT INTO staff_excuses (discord_id, scope, period, reason, created_at) VALUES ('10001', 'month', '2026-10', 'Estuve enfermo', ?)").run(now);
  db.prepare("INSERT INTO staff_applications (discord_id, roblox_user_id, roblox_name, answers, created_at) VALUES ('30001', 559, 'jugador', ?, ?)").run(JSON.stringify({ timezone: "Colombia", prior_staff: "no", help_experience: "Ayudo a mis amigos con los huevos todos los días en el juego" }), now);
  db.prepare("INSERT INTO staff (discord_id, roblox_user_id, roblox_name, roblox_display, rank, link_status, joined_at) VALUES ('60001', 560, 'viejo', 'Viejo', 'Helper', 'pending', ?)").run(now);
  db.prepare("INSERT INTO applications (discord_id, roblox_name, email, platforms, about, sample_url, created_at) VALUES ('30001', 'jugador', 'a@b.co', ?, 'Hago videos de Roblox', 'https://youtu.be/V7q6RxpdWgA', ?)").run(JSON.stringify([{ type: "YouTube", url: "https://youtube.com/@j", followers: 1200 }]), now);
  db.prepare("INSERT INTO evidences (discord_id, kind, platform, url, title, published_on, week, month, created_at, auto_views) VALUES ('30001', 'video', 'YouTube', 'https://youtu.be/V7q6RxpdWgA', 'Abrí 100 huevos', '2026-11-22', 47, '2026-11', ?, 4321)").run(now);
  db.prepare("INSERT INTO creators (discord_id, roblox_user_id, roblox_name, roblox_display, link_status) VALUES ('30001', 559, 'jugador', 'Jugador', 'pending')").run();
  const refs = {
    staff_excuse: db.prepare("SELECT id FROM staff_excuses").get().id, staff_application: db.prepare("SELECT id FROM staff_applications").get().id,
    staff_link: "60001", creator_application: db.prepare("SELECT id FROM applications").get().id,
    creator_evidence: db.prepare("SELECT id FROM evidences").get().id, creator_link: "30001",
  };
  for (const [kind, ref] of Object.entries(refs)) {
    const r = await postReview(db, c, kind, ref, impl, now);
    assert.equal(r.sent, true, kind);
    const post = db.prepare("SELECT id FROM review_posts WHERE kind = ?").get(kind);
    const form = await handleReviewButton(db, c, click(post.id, "approve", "50001"), {});
    assert.equal(form.type, 9, kind);
    if (kind === "creator_evidence") assert.equal(form.data.components[0].components[0].value, "4321");
  }
  const ev = calls.filter((x) => x.method === "POST").map((x) => x.body.embeds[0]).find((e) => /Abrí 100 huevos/.test(e.title));
  assert.equal(ev.image.url, "https://i.ytimg.com/vi/V7q6RxpdWgA/hqdefault.jpg");
});
