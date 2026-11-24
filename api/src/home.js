// Inicio del panel (2026-11-23): avisos y tareas pendientes de cada persona ordenados por prioridad,
// según su rol (Helper, Moderator Jr, Moderator, Admin), más accesos rápidos.
// priority: 1 = urgente, 2 = importante, 3 = cuando puedas. page = sección del panel.
import * as S from "./staff.js";
import { modQueue } from "./creators.js";
import { getStaffSettings } from "./staffSettings.js";
import { discordChannelsStatus } from "./discordActivity.js";
import { botEnabled } from "./discord.js";

const DAY = 86_400_000;
const HOUR = 3_600_000;
const OFFSET_MS = -5 * HOUR;
const n1 = (v) => String(v).replace(".", ",");
const fmtDate = (ms) => new Date(ms + OFFSET_MS).toISOString().slice(0, 10).split("-").reverse().join("/");

export function homeFeed(db, cfg, user, actor, now = Date.now()) {
  const items = [];
  const add = (priority, icon, title, detail, page, count = null) => items.push({ priority, icon, title, detail, page, count });
  const r = user.roles;
  const settings = getStaffSettings(db, cfg);
  let me = null;

  // ----- Mi staff -----
  if (r.staffRank && !r.staffLinked) {
    const days = Math.ceil((cfg.staff.linkDeadline - now) / DAY);
    add(days <= 3 ? 1 : 2, "🔗", "Vincula tu cuenta de Roblox", days > 0 ? `Te quedan ${days} día(s) (hasta el ${fmtDate(cfg.staff.linkDeadline - 1)}). Si no, pierdes el rango.` : "Ya pasó la fecha límite.", "staff-vincular");
  }
  if (r.staffLinked) {
    me = S.myStaffState(db, cfg, user, now);
    const w = me.week, cur = me.current;
    if (me.removalDueAt) add(1, "⛔", me.staff.rank === "Helper" ? "Vas a salir del staff" : "Vas a bajar de rango", `No cumpliste las cuotas obligatorias ${me.staff.strikes} meses seguidos. Si tuviste un motivo, presenta una excusa antes del ${fmtDate(me.removalDueAt)}.`, "staff-excusas");
    for (const x of me.excuses.filter((e) => e.status === "rejected" && now - e.createdAt < 7 * DAY)) add(2, "📝", "Tu excusa fue rechazada", x.reviewNote || "Revisa el motivo.", "staff-excusas");
    if (!w.met) {
      const dow = (new Date(now + OFFSET_MS).getUTCDay() + 6) % 7; // 0 = lunes
      const left = 7 - dow;
      // Atrasado: desde el miércoles, va por debajo del ritmo de la semana.
      const behind = dow >= 2 && w.missingHours > 0 && (w.totalHours / Math.max(0.1, w.targetHours)) < dow / 7;
      add(left <= 2 || behind ? 2 : 3, "⏱️", "Cuota de esta semana",
        `Llevas ${n1(w.totalHours)} de ${n1(w.targetHours)} h (${n1(w.gameHours)} h en el juego + ${n1(w.discordHours)} h en Discord). ${w.missingGameHours > 0 ? `Te faltan ${n1(w.missingGameHours)} h en el juego. ` : ""}Quedan ${left} día(s).`, "staff-tareas");
    }
    const dom = Number(new Date(now + OFFSET_MS).toISOString().slice(8, 10));
    if (!cur.complete && dom >= 15 && cur.percent < 60) add(dom >= settings.rules.warnDay ? 1 : 2, "📉", `Cuotas obligatorias al ${cur.percent} %`, `${cur.done}/${cur.required} cumplidas. Sube evidencias o presenta una excusa si no vas a poder.`, "staff-tareas");
    const pendingEv = cur.tasks.reduce((a, t) => a + (t.pending || 0), 0);
    if (pendingEv) add(3, "⏳", "Evidencias en revisión", `${pendingEv} esperando a un rango superior.`, "staff-tareas");
    if (me.promotion.next && me.promotion.eligible && !me.promotions.some((p) => p.status === "pending")) add(2, "⬆️", `Puedes pedir ascenso a ${me.promotion.next === "ModeratorJr" ? "Moderator Jr" : "Moderator"}`, "Cumples los requisitos.", "staff-tareas");
    if (me.staff.strikes > 0 && !me.removalDueAt) add(2, "⚠️", `${me.staff.strikes} mes(es) sin cumplir`, `Con ${settings.rules.failMonthsToRemove} seguidos bajas un rango${me.staff.rank === "Helper" ? " (sales del staff)" : ""}.`, "staff-tareas");
  }

  // ----- Colas de revisión -----
  if (r.modjr) {
    const open = db.prepare("SELECT COUNT(*) AS n, MIN(created_at) AS oldest FROM reports WHERE status = 'open'").get();
    if (open.n) add(now - open.oldest > 2 * HOUR ? 1 : 2, "📣", "Reportes del juego sin atender", `El más viejo es de hace ${Math.max(1, Math.round((now - open.oldest) / HOUR))} h.`, "staff-reportes", open.n);
    const ev = S.staffEvidenceQueue(db, actor).length;
    if (ev) add(2, "🧾", "Tareas del staff por revisar", "Aprueba o rechaza las evidencias de rangos inferiores.", "staff-revision", ev);
    const ex = S.excuseQueue(db, actor);
    if (ex.length) add(ex.some((x) => x.removal_due_at) ? 1 : 2, "📝", "Excusas por revisar", ex.some((x) => x.removal_due_at) ? "Alguien saldrá del staff si no se revisa a tiempo." : "Semanas o meses que no pudieron cumplir.", "staff-excusas-revision", ex.length);
  }
  if (r.moderator) {
    const apps = db.prepare("SELECT COUNT(*) AS n, MIN(created_at) AS oldest FROM staff_applications WHERE status IN ('pending','contacted')").get();
    if (apps.n) add(now - apps.oldest > 3 * DAY ? 1 : 2, "🛟", "Solicitudes de Helper", "Contacta, aprueba o rechaza.", "staff-solicitudes", apps.n);
    const links = db.prepare("SELECT COUNT(*) AS n FROM staff WHERE link_status = 'pending'").get().n;
    if (links) add(cfg.staff.linkDeadline - now < 3 * DAY ? 1 : 2, "🔗", "Cuentas de staff antiguo por confirmar", "Confirma que la cuenta de Roblox es suya.", "staff-solicitudes", links);
    const promos = db.prepare("SELECT to_rank FROM staff_promotions WHERE status = 'pending'").all();
    const mine = promos.filter((p) => r.admin || p.to_rank !== "Moderator").length;
    if (mine) add(2, "⬆️", "Ascensos por decidir", r.admin ? "Los ascensos a Moderator solo los apruebas tú." : "Ascensos a Moderator Jr.", "staff-ascensos", mine);
    const q = modQueue(db, actor);
    if (q.applications.length) add(2, "📝", "Solicitudes de creadores", "Nuevos aspirantes al programa.", "mod-solicitudes", q.applications.length);
    if (q.links.length) add(2, "🔗", "Vinculaciones de creadores", "Confirma sus cuentas de Roblox.", "mod-vinculos", q.links.length);
    if (q.evidences.length) add(2, "🎬", "Videos de creadores por revisar", "Anota las vistas.", "mod-evidencias", q.evidences.length);
    const bon = q.bonuses.filter((b) => (r.admin ? b.status !== "pending_mod" : b.status === "pending_mod")).length;
    if (bon) add(r.admin ? 1 : 2, "💰", r.admin ? "Bonos de Robux por aprobar o pagar" : "Bonos de Robux por revisar", "", "mod-bonos", bon);
    if (q.specials.length) add(1, "👑", "Pedidos especiales", "Creadores con más de 100.000 vistas en el mes.", "mod-especiales", q.specials.length);
    const removals = db.prepare("SELECT COUNT(*) AS n FROM staff WHERE removal_due_at IS NOT NULL AND link_status = 'approved' AND rank != 'None'").get().n;
    if (removals) add(2, "⛔", "Staff a punto de salir", "No cumplieron sus tareas y tienen plazo para excusarse.", "staff-equipo", removals);
  }

  // ----- Admin: configuración -----
  if (r.admin) {
    if (!botEnabled(cfg)) add(2, "🤖", "Falta el bot de Discord", "Sin él, los roles se ponen a mano y no se cuenta la actividad en Discord.", "admin-discord");
    else if (!settings.discord.channels.length) add(3, "💬", "Elige los canales de Discord que cuentan", "Así la actividad del staff en Discord suma a su cuota semanal.", "admin-staff-ajustes");
    else for (const c of discordChannelsStatus(db, settings).filter((c) => c.error)) add(2, "💬", `No se puede leer #${c.name || c.id}`, c.error, "admin-staff-ajustes");
    const legacy = db.prepare("SELECT COUNT(*) AS n FROM staff_legacy_discord WHERE status = 'pending'").get().n + db.prepare("SELECT COUNT(*) AS n FROM staff_legacy_game WHERE status = 'notified'").get().n;
    if (legacy && now < cfg.staff.linkDeadline) add(3, "⏳", "Staff antiguo sin vincular", `Fecha límite: ${fmtDate(cfg.staff.linkDeadline - 1)}.`, "staff-antiguos", legacy);
  }

  items.sort((a, b) => a.priority - b.priority || (b.count || 0) - (a.count || 0));

  // ----- Accesos rápidos por rol -----
  const quick = [];
  const q = (label, page, icon) => quick.push({ label, page, icon });
  if (r.staffLinked) { q("Subir evidencia", "staff-tareas", "📸"); q("Presentar excusa", "staff-excusas", "📝"); q("Comandos y funciones", "staff-guia", "🛡️"); }
  if (r.modjr) { q("Reportes", "staff-reportes", "📣"); q("Revisar tareas", "staff-revision", "🧾"); q("Equipo", "staff-equipo", "📈"); }
  if (r.moderator) { q("Solicitudes de Helper", "staff-solicitudes", "🛟"); q("Creadores", "mod-creadores", "📊"); }
  if (r.admin) { q("Ajustes del staff", "admin-staff-ajustes", "⚙️"); q("Prueba tu suerte", "admin-suerte", "🥚"); q("Bot de Discord", "admin-discord", "🤖"); }

  const team = r.modjr ? (() => {
    const d = S.staffDashboard(db, cfg, now);
    return { online: d.summary.online, total: d.summary.total, weekMet: d.summary.weekMet, atRisk: d.summary.atRisk, reportsOpen: d.summary.reportsOpen,
      onlineNow: d.members.filter((m) => m.online).map((m) => ({ name: m.roblox?.name || m.discord, rank: m.rank })) };
  })() : null;

  return { items, quick, me: me ? { rank: me.staff.rank, week: me.week, month: { percent: me.current.percent, performance: me.current.performance, done: me.current.done, required: me.current.required, complete: me.current.complete, excused: me.current.excused }, promotion: me.promotion, strikes: me.staff.strikes } : null, team };
}
