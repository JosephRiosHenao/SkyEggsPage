import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db.js";
import { gamePull, gameAck } from "../src/logic.js";
import * as C from "../src/creators.js";
import * as S from "../src/staff.js";
import { QUESTIONS } from "../src/staffProgram.js";
import { rolesForStaff, diagnoseBot, explainDiscordError } from "../src/discord.js";

const ROLE = { admin: "1560889139375898775", moderator: "1563742282392543312", creator: "1561051688125730897" };
const STAFF_ROLES = { Helper: "1563735797444771961", ModeratorJr: "1563736116300087337", Moderator: "1563736465522036736" };
const cfg = () => ({
  gameKey: "k".repeat(40), minLevel: 0, tzOffsetMin: -300, maxPerDay: { mythic: 5, legendary: 5 }, robloxTimeoutMs: 300, uploadsDir: mkdtempSync(join(tmpdir(), "st-")),
  discord: { clientId: "a", clientSecret: "b", guildId: "999", roles: ROLE, staffRoles: STAFF_ROLES, botToken: "tok", levelRoles: {} },
  creators: { claimGraceDaysWeek: 3, claimGraceDaysMonth: 5, autoTiers: true, warnDaysBefore: 3, demotionGraceHours: 24, legacyNoticeDays: 3, legacyDeadline: Date.parse("2027-01-01T00:00:00-05:00") },
  staff: { linkDeadline: Date.parse("2026-12-01T00:00:00-05:00"), failMonthsToRemove: 2, warnDay: 20, graceDays: 3 },
});
const pend = (db, uid) => db.prepare("SELECT kind, pack, period FROM rewards WHERE user_id = ? AND status = 'pending' ORDER BY created_at, rowid").all(uid).map((r) => `${r.kind}:${r.pack}${r.period ? `:${r.period}` : ""}`);
const deliverAll = (db) => db.prepare("UPDATE rewards SET status = 'delivered'").run();
const answers = () => Object.fromEntries(QUESTIONS.map((q) => [q.key, q.type === "yesno" ? "si" : "Respuesta suficientemente larga para pasar."]));
const play = (db, c, uid, name, extra = {}, now = Date.now()) => gamePull(db, c, { jobId: "job1", players: [{ userId: uid, name, displayName: name, level: 20, ...extra }] }, now);
const user = (db, id, roles = {}) => { C.upsertDiscordUser(db, { id, username: `u${id}` }, { inGuild: true, ...roles }); return C.getDiscordUser(db, id); };
const actor = (id, role, staffRank = null) => ({ id, name: `@${id}`, role, staffRank });

test("solicitud de Helper: formulario, aprobación, rango en el juego y en Discord", () => {
  const db = openDb(":memory:"); const c = cfg(); const t = Date.parse("2026-11-24T10:00:00-05:00");
  play(db, c, 1001, "Ayudante_1", {}, t);
  user(db, "10001");
  assert.throws(() => S.submitStaffApplication(db, "10001", { robloxUserId: 1001, answers: {} , age13: true }, t), /missing_answer/);
  const app = S.submitStaffApplication(db, "10001", { robloxUserId: 1001, answers: answers(), age13: true }, t);
  assert.throws(() => S.submitStaffApplication(db, "10001", { robloxUserId: 1001, answers: answers(), age13: true }, t), /already_pending/);
  assert.equal(S.staffApplicationsQueue(db)[0].answers.why.length > 10, true);
  // Un Moderator Jr no aprueba solicitudes; un Moderator sí
  assert.throws(() => S.reviewStaffApplication(db, actor("m2", "modjr", "ModeratorJr"), { id: app.id, action: "approve" }, t), /forbidden/);
  const out = S.reviewStaffApplication(db, actor("m3", "moderator", "Moderator"), { id: app.id, action: "approve" }, t);
  assert.deepEqual(out.job, { discordId: "10001", staffRank: "Helper", reason: "staff None → Helper" });
  assert.equal(S.getStaff(db, "10001").rank, "Helper");
  assert.deepEqual(pend(db, 1001), ["staffset:Helper", "notice:staff_welcome:Helper"]);
  const u = S.withStaffRoles(db, c, C.getDiscordUser(db, "10001"), t);
  assert.equal(u.roles.helper, true);
  assert.equal(u.roles.modjr, false);
  assert.deepEqual(rolesForStaff(c, "Helper"), { add: [STAFF_ROLES.Helper], remove: [STAFF_ROLES.ModeratorJr, STAFF_ROLES.Moderator] });
  assert.deepEqual(rolesForStaff(c, "None").add, []);
});

test("staff antiguo: se vincula solo si el juego ya lo vio con la etiqueta; después del 1/12 pierde el rango", () => {
  const db = openDb(":memory:"); const c = cfg(); const t = Date.parse("2026-11-24T10:00:00-05:00");
  // Moderator Jr antiguo: el juego lo reporta con staffTier 2 → aviso de vincular
  play(db, c, 2002, "Viejo_ModJr", { staffTier: 2 }, t);
  assert.deepEqual(pend(db, 2002), ["notice:staff_link_reminder:30/11/2026"]);
  deliverAll(db);
  const u = S.withStaffRoles(db, c, user(db, "20002", { staffDiscord: "ModeratorJr" }), t);
  assert.equal(u.roles.modjr, true); // antes de la fecha límite vale el rol de Discord
  const link = S.requestStaffLink(db, c, u, { userId: 2002 }, t);
  assert.equal(link.auto, true);
  assert.equal(S.getStaff(db, "20002").rank, "ModeratorJr");
  assert.equal(link.job.staffRank, "ModeratorJr");
  // Otro antiguo sin etiqueta en el juego: queda pendiente y lo confirma un Moderator
  play(db, c, 2003, "Sin_Tag", {}, t);
  const u3 = user(db, "20003", { staffDiscord: "Helper" });
  assert.equal(S.requestStaffLink(db, c, u3, { userId: 2003 }, t).auto, false);
  S.reviewStaffLink(db, actor("m", "moderator", "Moderator"), { discordId: "20003", action: "approve" }, t);
  assert.equal(S.getStaff(db, "20003").rank, "Helper");
  // Después de la fecha límite: quien sigue con la etiqueta sin vincular la pierde al entrar
  const dec2 = Date.parse("2026-12-02T10:00:00-05:00");
  play(db, c, 2004, "Nunca_Vinculo", { staffTier: 3 }, dec2);
  assert.deepEqual(pend(db, 2004), ["staffset:None", "notice:staff_removed:link"]);
  play(db, c, 2004, "Nunca_Vinculo", { staffTier: 3 }, dec2 + 60_000);
  assert.deepEqual(pend(db, 2004), ["staffset:None", "notice:staff_removed:link"]);
  // Y el rol de Discord ya no da permisos
  const late = S.withStaffRoles(db, c, user(db, "20005", { staffDiscord: "Moderator" }), dec2);
  assert.equal(late.roles.moderator, false);
  assert.throws(() => S.requestStaffLink(db, c, late, { userId: 2004 }, dec2), /link_deadline/);
  // Sincronización de Discord: los no vinculados pierden el rol; los vinculados quedan con el suyo
  const jobs = S.syncDiscordStaff(db, c, [
    { id: "20005", username: "x", roles: [STAFF_ROLES.Moderator] },
    { id: "20002", username: "y", roles: [STAFF_ROLES.ModeratorJr, STAFF_ROLES.Helper] },
  ], dec2);
  assert.deepEqual(jobs.map((j) => `${j.discordId}:${j.staffRank}`), ["20005:None", "20002:ModeratorJr"]);
});

test("actividad del juego, tareas con evidencias y revisión por rango superior", () => {
  const db = openDb(":memory:"); const c = cfg(); const t = Date.parse("2026-11-02T10:00:00-05:00");
  play(db, c, 3001, "Helper_Activo", {}, t);
  user(db, "30001");
  const app = S.submitStaffApplication(db, "30001", { robloxUserId: 3001, answers: answers(), age13: true }, t);
  S.reviewStaffApplication(db, actor("adm", "admin"), { id: app.id, action: "approve" }, t);
  // 2 h conectado, 1 h en servicio, 3 sanciones
  let now = t;
  for (let i = 0; i < 120; i++) {
    now += 60_000;
    play(db, c, 3001, "Helper_Activo", { staffTier: 1, duty: i < 60, staffActions: i === 5 ? { total: 4, sanctions: 3, helps: 1 } : null }, now);
  }
  S.recordReport(db, { reporterId: 3001, reporterName: "Helper_Activo", targetId: 77, targetName: "Troll", reason: "insultos en el chat" }, now);
  let st = S.myStaffState(db, c, S.withStaffRoles(db, c, C.getDiscordUser(db, "30001"), now), now);
  const task = (k) => st.current.tasks.find((x) => x.key === k);
  assert.equal(task("playtime").value, 2);
  assert.equal(task("duty").value, 1);
  assert.equal(task("moderation").value, 4); // 3 sanciones + 1 reporte
  assert.equal(task("reviews"), undefined); // los Helpers no tienen esa tarea
  // Evidencia de invitaciones: la revisa un rango superior
  const ev = S.addStaffEvidence(db, "30001", { task: "invites", amount: 12, url: "https://discord.com/x", note: "contador de invitaciones" }, now);
  assert.throws(() => S.reviewStaffEvidence(db, actor("30001", "helper", "Helper"), { id: ev.id, action: "approve" }, now), /own_item/);
  assert.throws(() => S.reviewStaffEvidence(db, actor("h2", "helper", "Helper"), { id: ev.id, action: "approve" }, now), /forbidden/);
  S.reviewStaffEvidence(db, actor("j1", "modjr", "ModeratorJr"), { id: ev.id, action: "approve", amount: 10 }, now);
  st = S.myStaffState(db, c, S.withStaffRoles(db, c, C.getDiscordUser(db, "30001"), now), now);
  assert.equal(task("invites").value, 10);
  assert.equal(st.current.complete, false);
  // Reporte resuelto por un Moderator Jr: cuenta como revisión suya
  const r = S.reportsList(db)[0];
  assert.throws(() => S.reviewReport(db, actor("j1", "modjr", "ModeratorJr"), { id: r.id, action: "resolve" }, now), /note_required/);
  S.reviewReport(db, actor("j1", "modjr", "ModeratorJr"), { id: r.id, action: "resolve", note: "Kick y advertencia" }, now);
  assert.equal(S.reportsList(db, "resolved").length, 1);
  // Panel: horas, en línea y cobertura por hora
  const d = S.staffDashboard(db, c, now);
  assert.equal(d.summary.total, 1);
  assert.equal(d.members[0].online, true);
  assert.equal(d.coverage.staffMinutes.reduce((a, b) => a + b, 0) > 0, true);
});

test("ascensos: Helper → Jr lo aprueba un Moderator; Jr → Moderator solo el Admin", () => {
  const db = openDb(":memory:"); const c = cfg(); const t = Date.parse("2026-11-24T10:00:00-05:00");
  play(db, c, 4001, "Sube_1", {}, t); user(db, "40001");
  const app = S.submitStaffApplication(db, "40001", { robloxUserId: 4001, answers: answers(), age13: true }, t);
  S.reviewStaffApplication(db, actor("adm", "admin"), { id: app.id, action: "approve" }, t);
  const req1 = S.requestPromotion(db, actor("40001", "helper", "Helper"), { reason: "Cumplí mis tareas dos meses seguidos." }, t);
  assert.equal(req1.to, "ModeratorJr");
  const p1 = S.staffDashboard(db, c, t).promotions[0];
  S.reviewPromotion(db, actor("m", "moderator", "Moderator"), { id: p1.id, action: "approve" }, t);
  assert.equal(S.getStaff(db, "40001").rank, "ModeratorJr");
  S.requestPromotion(db, actor("40001", "modjr", "ModeratorJr"), { reason: "Quiero ser Moderator, llevo meses." }, t);
  const p2 = S.staffDashboard(db, c, t).promotions[0];
  assert.throws(() => S.reviewPromotion(db, actor("m", "moderator", "Moderator"), { id: p2.id, action: "approve" }, t), /admin_only/);
  const out = S.reviewPromotion(db, actor("adm", "admin"), { id: p2.id, action: "approve" }, t);
  assert.equal(out.job.staffRank, "Moderator");
  assert.ok(pend(db, 4001).includes("staffset:Moderator"));
  // Un Moderator no puede quitar a otro Moderator; el Admin sí
  assert.throws(() => S.changeStaffRank(db, actor("m", "moderator", "Moderator"), { discordId: "40001", rank: "None" }, t), /admin_only/);
});

test("tareas: 2 meses seguidos sin cumplir sacan del staff; el primer mes incompleto no cuenta", () => {
  const db = openDb(":memory:"); const c = cfg(); const t = Date.parse("2026-11-10T10:00:00-05:00");
  play(db, c, 5001, "Flojo_1", {}, t); user(db, "50001");
  const app = S.submitStaffApplication(db, "50001", { robloxUserId: 5001, answers: answers(), age13: true }, t);
  S.reviewStaffApplication(db, actor("adm", "admin"), { id: app.id, action: "approve" }, t);
  deliverAll(db);
  // Noviembre empezó a mitad: no cuenta
  S.evaluateStaff(db, c, Date.parse("2026-12-04T10:00:00-05:00"));
  assert.equal(S.getStaff(db, "50001").strikes, 0);
  // Aviso el 20 de diciembre
  const w = S.evaluateStaff(db, c, Date.parse("2026-12-20T10:00:00-05:00"));
  assert.equal(w.warnings, 1);
  // Diciembre incompleto → 1 strike; enero incompleto → fuera
  S.evaluateStaff(db, c, Date.parse("2027-01-04T10:00:00-05:00"));
  assert.equal(S.getStaff(db, "50001").strikes, 1);
  const out = S.evaluateStaff(db, c, Date.parse("2027-02-04T10:00:00-05:00"));
  assert.equal(out.removed, 1);
  assert.equal(S.getStaff(db, "50001").rank, "None");
  assert.ok(pend(db, 5001).includes("staffset:None"));
  assert.ok(pend(db, 5001).includes("notice:staff_removed:tasks"));
  // Puede volver a aplicar
  assert.ok(S.submitStaffApplication(db, "50001", { robloxUserId: 5001, answers: answers(), age13: true }, Date.parse("2027-02-05T10:00:00-05:00")).ok);
});

test("diagnóstico del bot: explica el 404 de Discord", async () => {
  assert.match(explainDiscordError(404, { code: 10004 }), /NO está en el servidor/);
  assert.match(explainDiscordError(404, { code: 10007 }), /ya no está en el servidor/);
  assert.match(explainDiscordError(403, { code: 50013 }), /POR ENCIMA/);
  const c = cfg();
  const fake = async (url) => {
    if (url.endsWith("/users/@me")) return { ok: true, status: 200, json: async () => ({ id: "555", username: "SkyEggsBot" }) };
    return { ok: false, status: 404, json: async () => ({ code: 10004, message: "Unknown Guild" }) };
  };
  const d = await diagnoseBot(c, { "Content Creator": ROLE.creator }, null, fake);
  assert.equal(d.ok, false);
  assert.equal(d.checks.at(-1).label, "El bot está dentro del servidor");
  assert.match(d.checks.at(-1).detail, /NO está en el servidor/);
  // Todo bien: rol del bot por encima
  const ok = async (url) => {
    const j = (b) => ({ ok: true, status: 200, json: async () => b });
    if (url.endsWith("/users/@me")) return j({ id: "555", username: "SkyEggsBot" });
    if (url.endsWith("/guilds/999")) return j({ id: "999", name: "Sky Eggs" });
    if (url.endsWith("/roles")) return j([{ id: "999", position: 0, permissions: "0", name: "@everyone" }, { id: "b", position: 10, permissions: String(1n << 28n), name: "Bot" }, { id: ROLE.creator, position: 5, permissions: "0", name: "Content Creator" }]);
    if (url.endsWith("/members/555")) return j({ roles: ["b"] });
    return j({});
  };
  const d2 = await diagnoseBot(c, { "Content Creator": ROLE.creator }, null, ok);
  assert.equal(d2.ok, true, JSON.stringify(d2.checks));
});
