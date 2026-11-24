// Ajustes del programa de staff que el Admin cambia desde el panel (2026-11-23).
// Se guardan en la tabla settings (clave "staff") como JSON y se mezclan con los valores por
// defecto: si falta algo (o es inválido), vale el de por defecto. Todo cambio pasa por audit().
import { Fail, audit } from "./creators.js";
import { RANK_KEYS, TASKS } from "./staffProgram.js";

const SNOWFLAKE = /^\d{15,25}$/;
export const MENTIONABLE = ["Helper", "ModeratorJr", "Moderator", "Admin", "Creator"];
// Avisos que puede mandar la página al canal del staff.
export const ANNOUNCE_EVENTS = {
  creator_application: { name: "Nueva solicitud de creador", on: true, mention: ["Moderator"] },
  creator_evidence: { name: "Nuevo video de creador por revisar", on: true, mention: ["Moderator"] },
  creator_link: { name: "Creador pide vincular su Roblox", on: true, mention: [] },
  creator_bonus: { name: "Bono de Robux pedido", on: true, mention: ["Moderator"] },
  creator_bonus_admin: { name: "Bono de Robux listo para el Admin", on: true, mention: ["Admin"] },
  creator_special: { name: "Pedido especial (100.000 vistas)", on: true, mention: ["Admin"] },
  staff_application: { name: "Nueva solicitud de Helper", on: true, mention: ["Moderator"] },
  staff_link: { name: "Staff antiguo pide vincular su cuenta", on: true, mention: ["Moderator"] },
  staff_evidence: { name: "Evidencia de tareas del staff", on: true, mention: [] },
  staff_excuse: { name: "Excusa del staff (menciona al rango superior)", on: true, mention: ["auto"] },
  staff_promotion: { name: "Pedido de ascenso (menciona a quien aprueba)", on: true, mention: ["auto"] },
  staff_rank: { name: "Bienvenidas y ascensos del staff", on: true, mention: [] },
  game_report: { name: "Reporte desde el juego (;Report)", on: true, mention: ["ModeratorJr", "Moderator"] },
  link_deadline: { name: "Recordatorio de vincular cuentas (3 y 1 día antes)", on: true, mention: ["Helper", "ModeratorJr", "Moderator"] },
};

export function defaultStaffSettings(cfg) {
  return {
    // Metas del mes por tarea y rango (0 = no se pide en ese rango).
    // Por tarea y rango: min = cuota obligatoria, goal = meta opcional (desempeño).
    targets: Object.fromEntries(TASKS.map((t) => [t.key, { min: { ...t.min }, goal: { ...t.goal } }])),
    // Cuota semanal de conexión (lunes a domingo): horas en el juego + crédito de Discord.
    // minGameHours: mínimo que tiene que ser en el juego aunque tenga mucha actividad en Discord.
    // Los rangos altos son los más ocupados (revisan el panel, deciden casos): piden menos horas.
    weekly: {
      Helper: { hours: 5, minGameHours: 2 },
      ModeratorJr: { hours: 4, minGameHours: 1.5 },
      Moderator: { hours: 3, minGameHours: 1 },
    },
    // Actividad en Discord: cada ventana de N minutos con al menos un mensaje en los canales
    // elegidos cuenta como N minutos de conexión × weight (máx. dailyCapMinutes por día).
    discord: { channels: [], windowMinutes: 5, weight: 1, dailyCapMinutes: 120, countsForDays: true },
    // Requisitos para pedir ascenso (el propio miembro). Un rango superior puede proponerlo igual.
    // minPerformance = % de las tareas opcionales (desempeño) del mes en curso o del último mes cerrado.
    promotion: {
      ModeratorJr: { minDays: 30, minPerformance: 60, completeMonths: 1 },
      Moderator: { minDays: 60, minPerformance: 75, completeMonths: 2 },
    },
    rules: {
      failMonthsToRemove: cfg.staff.failMonthsToRemove,
      warnDay: cfg.staff.warnDay,
      warnPercent: 50,
      graceDays: cfg.staff.graceDays,
      excuseDays: 5,          // días para presentar excusa antes de que se aplique la bajada
      maxExcusesPerYear: 4,
    },
    // Anuncios en el canal de Discord del staff. mention: rangos a mencionar (Helper, ModeratorJr,
    // Moderator, Admin, Creator = Content Creator). Las menciones de un mismo aviso se espacian
    // mentionEveryMinutes para no saturar; entre medias el aviso sale sin mención.
    announce: {
      enabled: true,
      mentionEveryMinutes: 30,
      events: Object.fromEntries(Object.entries(ANNOUNCE_EVENTS).map(([k, e]) => [k, { on: e.on, mention: [...e.mention] }])),
    },
  };
}

const num = (v, min, max, step = 1) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return Math.round(n / step) * step;
};

// Valida y normaliza un objeto de ajustes (parcial). Devuelve { value, errors }.
export function normalizeStaffSettings(cfg, input) {
  const d = defaultStaffSettings(cfg);
  const out = structuredClone(d);
  const errors = [];
  const src = input && typeof input === "object" ? input : {};
  const set = (path, v, fallback) => { if (v == null) { if (fallback !== undefined) errors.push(path); return fallback; } return v; };
  for (const t of TASKS) for (const kind of ["min", "goal"]) for (const r of RANK_KEYS) {
    const raw = src.targets?.[t.key]?.[kind]?.[r];
    if (raw === undefined) continue;
    out.targets[t.key][kind][r] = set(`targets.${t.key}.${kind}.${r}`, num(raw, 0, t.key === "weeks" ? 5 : 500), d.targets[t.key][kind][r]);
  }
  // La meta opcional nunca es menor que la cuota obligatoria.
  for (const t of TASKS) for (const r of RANK_KEYS) {
    const x = out.targets[t.key];
    if (x.goal[r] > 0 && x.goal[r] < x.min[r]) { x.goal[r] = x.min[r]; errors.push(`targets.${t.key}.goal.${r}`); }
  }
  for (const r of RANK_KEYS) {
    const w = src.weekly?.[r];
    if (!w) continue;
    if (w.hours !== undefined) out.weekly[r].hours = set(`weekly.${r}.hours`, num(w.hours, 0, 80, 0.5), d.weekly[r].hours);
    if (w.minGameHours !== undefined) out.weekly[r].minGameHours = set(`weekly.${r}.minGameHours`, num(w.minGameHours, 0, 80, 0.5), d.weekly[r].minGameHours);
    if (out.weekly[r].minGameHours > out.weekly[r].hours) { out.weekly[r].minGameHours = out.weekly[r].hours; errors.push(`weekly.${r}.minGameHours`); }
  }
  const dc = src.discord || {};
  if (dc.channels !== undefined) {
    const list = (Array.isArray(dc.channels) ? dc.channels : String(dc.channels).split(/[\s,]+/)).map((x) => String(x).trim()).filter(Boolean);
    const ok = [...new Set(list.filter((x) => SNOWFLAKE.test(x)))].slice(0, 25);
    if (ok.length !== list.length) errors.push("discord.channels");
    out.discord.channels = ok;
  }
  if (dc.windowMinutes !== undefined) out.discord.windowMinutes = set("discord.windowMinutes", num(dc.windowMinutes, 1, 30), d.discord.windowMinutes);
  if (dc.weight !== undefined) out.discord.weight = set("discord.weight", num(dc.weight, 0, 3, 0.05), d.discord.weight);
  if (dc.dailyCapMinutes !== undefined) out.discord.dailyCapMinutes = set("discord.dailyCapMinutes", num(dc.dailyCapMinutes, 0, 600), d.discord.dailyCapMinutes);
  if (dc.countsForDays !== undefined) out.discord.countsForDays = dc.countsForDays === true || dc.countsForDays === "true";
  for (const r of ["ModeratorJr", "Moderator"]) {
    const p = src.promotion?.[r];
    if (!p) continue;
    if (p.minDays !== undefined) out.promotion[r].minDays = set(`promotion.${r}.minDays`, num(p.minDays, 0, 365), d.promotion[r].minDays);
    if (p.minPerformance !== undefined) out.promotion[r].minPerformance = set(`promotion.${r}.minPerformance`, num(p.minPerformance, 0, 100), d.promotion[r].minPerformance);
    if (p.completeMonths !== undefined) out.promotion[r].completeMonths = set(`promotion.${r}.completeMonths`, num(p.completeMonths, 0, 6), d.promotion[r].completeMonths);
  }
  const ru = src.rules || {};
  const lim = { failMonthsToRemove: [0, 12], warnDay: [1, 28], warnPercent: [0, 100], graceDays: [0, 10], excuseDays: [0, 30], maxExcusesPerYear: [0, 24] };
  for (const [k, [a, b]] of Object.entries(lim)) if (ru[k] !== undefined) out.rules[k] = set(`rules.${k}`, num(ru[k], a, b), d.rules[k]);
  const an = src.announce || {};
  if (an.enabled !== undefined) out.announce.enabled = an.enabled === true || an.enabled === "true";
  if (an.mentionEveryMinutes !== undefined) out.announce.mentionEveryMinutes = set("announce.mentionEveryMinutes", num(an.mentionEveryMinutes, 0, 1440), d.announce.mentionEveryMinutes);
  for (const k of Object.keys(ANNOUNCE_EVENTS)) {
    const e = an.events?.[k];
    if (!e) continue;
    if (e.on !== undefined) out.announce.events[k].on = e.on === true || e.on === "true";
    if (e.mention !== undefined) {
      const list = (Array.isArray(e.mention) ? e.mention : []).filter((m) => MENTIONABLE.includes(m) || m === "auto");
      out.announce.events[k].mention = [...new Set(list)];
    }
  }
  return { value: out, errors };
}

let cache = null;
export function getStaffSettings(db, cfg) {
  const row = db.prepare("SELECT value, updated_at FROM settings WHERE key = 'staff'").get();
  if (cache && cache.at === (row?.updated_at ?? 0) && cache.db === db) return cache.value;
  let stored = {};
  try { stored = row ? JSON.parse(row.value) : {}; } catch { stored = {}; }
  const value = normalizeStaffSettings(cfg, stored).value;
  cache = { db, at: row?.updated_at ?? 0, value };
  return value;
}

export function staffSettingsInfo(db, cfg) {
  const row = db.prepare("SELECT updated_by, updated_at FROM settings WHERE key = 'staff'").get();
  return { settings: getStaffSettings(db, cfg), defaults: defaultStaffSettings(cfg), updatedBy: row?.updated_by || null, updatedAt: row?.updated_at || null };
}

// Solo el Admin. Guarda la versión normalizada y anota en el registro qué cambió.
export function saveStaffSettings(db, cfg, actor, body, now = Date.now()) {
  if (actor.role !== "admin") throw new Fail("admin_only", 403);
  const before = getStaffSettings(db, cfg);
  const merged = { ...before, ...(body?.settings || {}) };
  for (const k of ["targets", "weekly", "discord", "promotion", "rules", "announce"]) if (body?.settings?.[k]) merged[k] = deepMerge(before[k], body.settings[k]);
  const { value, errors } = normalizeStaffSettings(cfg, merged);
  if (errors.length) throw Object.assign(new Fail("bad_settings"), { field: errors[0] });
  db.prepare(`INSERT INTO settings (key, value, updated_by, updated_at) VALUES ('staff', ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`).run(JSON.stringify(value), actor.name, now);
  cache = null;
  audit(db, actor, "staff.settings", "Ajustes del staff", diff(before, value));
  return { ok: true, settings: value };
}

export function resetStaffSettings(db, cfg, actor, now = Date.now()) {
  if (actor.role !== "admin") throw new Fail("admin_only", 403);
  db.prepare("DELETE FROM settings WHERE key = 'staff'").run();
  cache = null;
  audit(db, actor, "staff.settings_reset", "Ajustes del staff", {});
  return { ok: true, settings: getStaffSettings(db, cfg) };
}

function deepMerge(a, b) {
  if (Array.isArray(b) || typeof b !== "object" || b === null) return b;
  const o = { ...(a || {}) };
  for (const [k, v] of Object.entries(b)) o[k] = typeof v === "object" && v && !Array.isArray(v) ? deepMerge(o[k], v) : v;
  return o;
}

function diff(a, b, prefix = "", out = {}) {
  for (const k of new Set([...Object.keys(a || {}), ...Object.keys(b || {})])) {
    const p = prefix ? `${prefix}.${k}` : k;
    const x = a?.[k], y = b?.[k];
    if (x && y && typeof x === "object" && typeof y === "object" && !Array.isArray(x)) diff(x, y, p, out);
    else if (JSON.stringify(x) !== JSON.stringify(y)) out[p] = `${JSON.stringify(x)} → ${JSON.stringify(y)}`;
  }
  return out;
}
