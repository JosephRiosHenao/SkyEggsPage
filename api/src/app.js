// Rutas HTTP de la API (sin dependencias externas).
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { doRoll, gamePull, gameAck, gameRedeem, recordVisit, metrics, remainingToday, adminCreateCodes, adminListCodes, adminGift } from "./logic.js";
import { searchPlayers } from "./roblox.js";
import { safeEqual, verifyPassword, createSession, checkSession, getSession, deleteSession, readCookie, COOKIE, SESSION_MS, USER_COOKIE, USER_SESSION_MS } from "./auth.js";
import { discordEnabled, authorizeUrl, fetchDiscordIdentity, rolesFrom, notifyMods, botEnabled, rolesForTier, rolesForStaff, setMemberRoles, diagnoseBot, listMembersWithRoles, getMember } from "./discord.js";
import * as S from "./staff.js";
import { publicStaffProgram } from "./staffProgram.js";
import { getStaffSettings, staffSettingsInfo, saveStaffSettings, resetStaffSettings, ANNOUNCE_EVENTS, MENTIONABLE } from "./staffSettings.js";
import { pollDiscordChannels, discordChannelsStatus } from "./discordActivity.js";
import { homeFeed } from "./home.js";
import { evaluateCreators, setCreatorTier, legacyList, noticeList, tierOf } from "./lifecycle.js";
import { publicCreators, clearPublicCache, creatorsDashboard, creatorDetail, publicStaff } from "./insights.js";
import { announce, announceOnce, reviewerRanks } from "./announce.js";
import { LEVEL_KEYS } from "./program.js";
import { publicProgram } from "./program.js";
import { tx } from "./db.js";
import * as C from "./creators.js";
import { probeViews, updateYtDlp } from "./views.js";
import { verifyInteraction, interactionsEnabled, REPLY, EPHEMERAL } from "./bot.js";
import { announceVideo, refreshVideoMessage, handleVideoButton, resendVideo } from "./videos.js";
import { receiveEggAlert, updateEggAlert, handleEggButton, expireOldAlerts, refreshEggMessage, resendEggAlert } from "./eggAlerts.js";
import { saveCatalog, catalog, assetImage, syncAssets, assetStatus } from "./assets.js";

// Límite simple por clave (ventana deslizante en memoria).
export class Limiter {
  constructor(max, windowMs) { this.max = max; this.windowMs = windowMs; this.hits = new Map(); }
  take(key, now = Date.now()) {
    const arr = (this.hits.get(key) || []).filter((t) => now - t < this.windowMs);
    if (arr.length >= this.max) { this.hits.set(key, arr); return false; }
    arr.push(now);
    this.hits.set(key, arr);
    if (this.hits.size > 50_000) this.hits.delete(this.hits.keys().next().value);
    return true;
  }
}

class HttpError extends Error { constructor(status, code, field = null) { super(code); this.status = status; this.code = code; this.field = field; } }

// Lee las vistas de una evidencia y guarda el resultado (no lanza).
export async function probeEvidence(db, cfg, id, url, probe, log = console, now = Date.now()) {
  let r;
  try { r = await probe(cfg, url); } catch (e) { r = { ok: false, error: e.message }; }
  const out = C.applyProbe(db, cfg, id, r, now);
  if (!r.ok) log.warn(`[views] evidencia ${id}: ${r.error}`);
  // Vistas nuevas: se actualiza el anuncio de Discord (si cambió bastante).
  else refreshVideoMessage(db, cfg, id).catch(() => {});
  return out;
}

// Refresca, uno por uno y sin prisa, las evidencias automáticas que toca revisar.
export function startViewsTracker({ db, cfg, probe = probeViews, log = console }) {
  if (!cfg.views.enabled) return () => {};
  let running = false;
  let lastUpdate = 0;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      if (Date.now() - lastUpdate > 24 * 3_600_000) { lastUpdate = Date.now(); updateYtDlp(cfg, log); }
      for (const ev of C.dueForProbe(db, cfg)) {
        await probeEvidence(db, cfg, ev.id, ev.url, probe, log);
        await new Promise((r) => setTimeout(r, 4000));
      }
    } catch (e) { log.error("[views]", e); } finally { running = false; }
  };
  const timer = setInterval(tick, 15 * 60_000);
  setTimeout(tick, 30_000);
  return () => { clearInterval(timer); };
}

// Pone/quita los roles de Discord de cada cambio de rango (si hay bot). Nunca lanza.
export async function runRoleJobs(db, cfg, jobs, fetchImpl = fetch, log = console) {
  if (!jobs?.length || !botEnabled(cfg)) return [];
  const results = [];
  for (const job of jobs) {
    if (!job) continue;
    // Trabajo de staff (staffRank) o de creador (tierKey).
    const isStaff = job.staffRank !== undefined;
    const roles = isStaff ? rolesForStaff(cfg, job.staffRank) : rolesForTier(cfg, job.tierKey);
    const r = await setMemberRoles(cfg, job.discordId, roles, `Sky Eggs ${isStaff ? "staff" : "creadores"}: ${job.reason || job.staffRank || job.tierKey}`, fetchImpl);
    // No está en el servidor: el rol queda pendiente y se pone solo cuando se una (sweepPendingRoles / login).
    if (r.notMember) {
      db.prepare("UPDATE discord_users SET in_guild = 0 WHERE id = ?").run(String(job.discordId));
      C.audit(db, { id: "system", name: "Bot de Discord", role: "system" }, "discord.roles_pending", `#${job.discordId}`, { rango: isStaff ? `staff ${job.staffRank}` : job.tierKey, motivo: "todavía no está en el servidor: se pondrá solo cuando se una" });
      results.push(r);
      continue;
    }
    if (r.ok && isStaff) db.prepare("UPDATE discord_users SET staff_discord = ? WHERE id = ?").run(job.staffRank === "None" ? null : job.staffRank, String(job.discordId));
    else if (r.ok) db.prepare("UPDATE discord_users SET is_creator = ? WHERE id = ?").run(job.tierKey === "None" ? 0 : 1, String(job.discordId));
    else log.warn(`[discord] roles de ${job.discordId}: ${r.errors.join(", ")}`);
    C.audit(db, { id: "system", name: "Bot de Discord", role: "system" }, r.ok ? "discord.roles" : "discord.roles_error", `#${job.discordId}`, { rango: isStaff ? `staff ${job.staffRank}` : job.tierKey, hecho: r.done.join(" ") || null, errores: r.errors.join(" · ") || null });
    results.push(r);
  }
  return results;
}

// Rangos automáticos: revisa a los creadores cada 15 min (ascensos, avisos y bajadas).
// Roles que tocan según la página (creador aprobado con rango, staff vinculado con rango).
export function wantedRoleJobs(db, cfg, discordId, memberRoles = null) {
  const jobs = [];
  const c = db.prepare("SELECT * FROM creators WHERE discord_id = ? AND link_status = 'approved'").get(String(discordId));
  if (c) {
    const tier = tierOf(c);
    if (tier && tier !== "None") {
      const want = rolesForTier(cfg, tier).add;
      if (!memberRoles || want.some((r) => !memberRoles.includes(r))) jobs.push({ discordId: String(discordId), tierKey: tier, reason: "rol pendiente (se unió al servidor)" });
    }
  }
  const s = db.prepare("SELECT rank FROM staff WHERE discord_id = ? AND link_status = 'approved' AND rank != 'None'").get(String(discordId));
  if (s) {
    const want = rolesForStaff(cfg, s.rank).add;
    if (!memberRoles || want.some((r) => !memberRoles.includes(r))) jobs.push({ discordId: String(discordId), staffRank: s.rank, reason: "rol pendiente (se unió al servidor)" });
  }
  return jobs;
}

// Cada 10 min: quien fue aprobado sin estar en el servidor (o sin el rol) y ya se unió recibe su rol.
// Discord no avisa por REST cuando alguien entra, así que se pregunta por cada pendiente (máx. 25 por vuelta).
export async function sweepPendingRoles(db, cfg, fetchImpl = fetch, log = console) {
  if (!botEnabled(cfg)) return { checked: 0, fixed: 0 };
  const rows = db.prepare(`
    SELECT d.id FROM discord_users d
    WHERE (EXISTS (SELECT 1 FROM creators c WHERE c.discord_id = d.id AND c.link_status = 'approved' AND COALESCE(c.tier, 'Creator') != 'None') AND (d.is_creator = 0 OR d.in_guild = 0))
       OR (EXISTS (SELECT 1 FROM staff s WHERE s.discord_id = d.id AND s.link_status = 'approved' AND s.rank != 'None') AND (d.in_guild = 0 OR COALESCE(d.staff_discord, '') != (SELECT rank FROM staff WHERE discord_id = d.id)))
    ORDER BY d.last_login DESC LIMIT 25`).all();
  let fixed = 0;
  for (const { id } of rows) {
    const m = await getMember(cfg, id, fetchImpl);
    if (!m.ok || !m.member) continue;
    db.prepare("UPDATE discord_users SET in_guild = 1 WHERE id = ?").run(id);
    const res = await runRoleJobs(db, cfg, wantedRoleJobs(db, cfg, id, m.member.roles || []), fetchImpl, log);
    if (!res.length) db.prepare("UPDATE discord_users SET is_creator = CASE WHEN EXISTS (SELECT 1 FROM creators WHERE discord_id = ? AND link_status = 'approved') THEN 1 ELSE is_creator END WHERE id = ?").run(id, id);
    if (res.some((r) => r.ok)) fixed++;
  }
  if (fixed) log.info(`[discord] ${fixed} rol(es) pendiente(s) puesto(s)`);
  return { checked: rows.length, fixed };
}

export function startLifecycle({ db, cfg, fetchImpl = fetch, log = console }) {
  let running = false;
  let lastDiscordSync = 0;
  // Actividad del staff en Discord: cada 5 min lee los canales elegidos por el Admin.
  let polling = false;
  let sweeping = false;
  const sweepTimer = setInterval(async () => {
    if (sweeping) return;
    sweeping = true;
    try { await sweepPendingRoles(db, cfg, fetchImpl, log); } catch (e) { log.error("[discord] roles pendientes", e); } finally { sweeping = false; }
  }, 10 * 60_000);
  const pollTimer = setInterval(async () => {
    if (polling || !botEnabled(cfg)) return;
    polling = true;
    try {
      const out = await pollDiscordChannels(db, cfg, getStaffSettings(db, cfg), fetchImpl);
      if (out.errors.length) log.warn(`[staff] Discord: ${out.errors.join(" | ")}`);
    } catch (e) { log.error("[staff] Discord", e); } finally { polling = false; }
  }, 5 * 60_000);
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      // Alertas de huevos de servidores que ya cerraron: pasan a "se fue".
      for (const id of expireOldAlerts(db)) await refreshEggMessage(db, cfg, id, fetchImpl).catch(() => {});
      // Imágenes del catálogo que faltan (las nuevas de cada update del juego).
      syncAssets(db, cfg, fetchImpl, log).catch(() => {});
      const out = evaluateCreators(db, cfg);
      if (out.changes.length || out.warnings) {
        log.info(`[creadores] ${out.changes.length} cambio(s) de rango, ${out.warnings} aviso(s)`);
        clearPublicCache();
      }
      await runRoleJobs(db, cfg, out.roleJobs, fetchImpl, log);
      // Staff: cierre de mes, avisos y (cada 30 min) roles de Discord del staff.
      const st = S.evaluateStaff(db, cfg);
      if (st.removed || st.warnings || st.removalWarnings) log.info(`[staff] ${st.removed} fuera por tareas, ${st.removalWarnings} con plazo para excusa, ${st.warnings} aviso(s)`);
      await runRoleJobs(db, cfg, st.roleJobs, fetchImpl, log);
      // Recordatorio al staff antiguo: 3 días y 1 día antes de la fecha límite para vincular.
      for (const days of [3, 1]) {
        const left = cfg.staff.linkDeadline - Date.now();
        if (left > 0 && left <= days * 86_400_000) {
          const pending = S.legacyPendingCount(db);
          if (pending) await announceOnce(db, cfg, `link_deadline_${cfg.staff.linkDeadline}_${days}`, "link_deadline",
            { text: `⏳ **Staff antiguo**: ${days === 1 ? "mañana" : `en ${days} días`} vence el plazo para vincular Discord + Roblox. Entra a ${cfg.siteUrl}/creadores/panel/ con Discord y vincula tu cuenta, o pierdes el rango en el juego y en Discord.` }, fetchImpl);
        }
      }
      if (botEnabled(cfg) && Date.now() - lastDiscordSync > 30 * 60_000) {
        lastDiscordSync = Date.now();
        const members = await listMembersWithRoles(cfg, Object.values(cfg.discord.staffRoles), fetchImpl);
        if (members) await runRoleJobs(db, cfg, S.syncDiscordStaff(db, cfg, members), fetchImpl, log);
        else log.warn("[staff] no se pudo listar a los miembros de Discord: activa «Server Members Intent» en el bot");
      }
    } catch (e) { log.error("[creadores]", e); } finally { running = false; }
  };
  const timer = setInterval(tick, 15 * 60_000);
  setTimeout(tick, 20_000);
  return () => { clearInterval(timer); clearInterval(pollTimer); clearInterval(sweepTimer); };
}

export function createApp({ db, cfg, fetchImpl = fetch, log = console, probe = (c, u) => probeViews(c, u, fetchImpl) }) {
  C.setGrace(cfg);
  const limits = {
    roll: new Limiter(cfg.rollsPerMinute, 60_000),
    search: new Limiter(20, 60_000),
    visit: new Limiter(10, 60_000),
    login: new Limiter(5, 15 * 60_000),
    redeem: new Limiter(10, 60_000),
    oauth: new Limiter(20, 10 * 60_000),
    apply: new Limiter(5, 3_600_000),
    upload: new Limiter(30, 3_600_000),
    creator: new Limiter(60, 60_000),
    publicList: new Limiter(30, 60_000),
  };
  const ipOf = (req) => String(req.headers[cfg.ipHeader] || req.socket.remoteAddress || "?").split(",")[0].trim().slice(0, 64);
  // Identificador de visitante no reversible (cambia cada día).
  const visitorOf = (req, day) =>
    createHash("sha256").update(`${cfg.gameKey}|${day}|${ipOf(req)}|${req.headers["user-agent"] || ""}`).digest("hex").slice(0, 32);
  const today = () => new Date(Date.now() + cfg.tzOffsetMin * 60_000).toISOString().slice(0, 10);

  async function readJson(req, maxBytes = 8192) {
    const type = String(req.headers["content-type"] || "");
    if (!type.startsWith("application/json")) throw new HttpError(415, "json_required");
    let size = 0;
    const chunks = [];
    for await (const c of req) {
      size += c.length;
      if (size > maxBytes) throw new HttpError(413, "too_large");
      chunks.push(c);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { throw new HttpError(400, "bad_json"); }
  }

  function send(res, status, body, headers = {}) {
    res.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...headers,
    });
    res.end(JSON.stringify(body));
  }

  // Las peticiones del navegador que cambian algo deben venir de nuestra propia página.
  function checkOrigin(req) {
    const origin = req.headers.origin;
    if (!origin) return; // fetch del mismo origen sin Origin (algunos navegadores en GET) o herramientas
    let host;
    try { host = new URL(origin).host; } catch { throw new HttpError(403, "bad_origin"); }
    if (host !== req.headers.host) throw new HttpError(403, "bad_origin");
  }

  function requireGame(req) {
    const key = req.headers["x-game-key"];
    if (!key || !safeEqual(key, cfg.gameKey)) throw new HttpError(401, "unauthorized");
  }

  // Usuario de Discord con sesión (o null). Los roles se leen de Discord en cada login.
  function currentUser(req) {
    const s = getSession(db, readCookie(req.headers.cookie, USER_COOKIE), "discord");
    return s ? S.withStaffRoles(db, cfg, C.getDiscordUser(db, s.discord_id)) : null;
  }
  // Hay que estar en el servidor de Discord de Sky Eggs: sin eso no sabemos sus roles.
  // Y tener su cuenta de Roblox vinculada (obligatorio desde 2026-11-24): sin eso no sabemos su rango del juego.
  function requireUser(req, { allowUnlinked = false } = {}) {
    const u = currentUser(req);
    if (!u) throw new HttpError(401, "login_required");
    if (!u.roles.inGuild) throw new HttpError(403, "join_guild");
    if (!u.roblox && !allowUnlinked) throw new HttpError(403, "link_roblox");
    return u;
  }
  // Pone los roles que le faltan a alguien que ya está en el servidor (tras vincular o comprobar).
  async function reconcileRoles(discordId) {
    const m = await getMember(cfg, discordId, fetchImpl);
    if (!m.ok || !m.member) return [];
    return runRoleJobs(db, cfg, wantedRoleJobs(db, cfg, discordId, m.member.roles || []), fetchImpl, log);
  }
  const passwordAdmin = (req) => checkSession(db, readCookie(req.headers.cookie, COOKIE));
  // Quién hace una acción de staff (queda en el registro con su nombre).
  // min: "admin" | "moderator" (por defecto) | "modjr" | "helper". El actor lleva su rango de staff.
  function staffActor(req, adminOnly = false, min = "moderator") {
    if (passwordAdmin(req)) return { id: `local:${cfg.adminUser}`, name: `${cfg.adminUser} (panel)`, role: "admin", staffRank: null };
    const u = currentUser(req);
    if (u && !u.roles.inGuild) throw new HttpError(403, "join_guild");
    if (u && !u.roblox) throw new HttpError(403, "link_roblox");
    const name = u && (u.globalName ? `${u.globalName} (@${u.username})` : `@${u.username}`);
    if (u && u.roles.admin) return { id: u.id, name, role: "admin", staffRank: u.roles.staffRank };
    const need = adminOnly ? "admin" : min;
    const role = u?.roles.moderator ? "moderator" : u?.roles.modjr ? "modjr" : u?.roles.helper ? "helper" : null;
    const order = { helper: 1, modjr: 2, moderator: 3, admin: 4 };
    if (u && role && order[role] >= order[need]) return { id: u.id, name, role, staffRank: u.roles.staffRank };
    throw new HttpError(u ? 403 : 401, u ? "forbidden" : "unauthorized");
  }
  const staffMember = (req, min) => staffActor(req, false, min);
  function requireAdmin(req) { return staffActor(req, true); }
  function requireCreatorOrStaff(req) {
    const u = requireUser(req);
    if (!u.roles.creator && !u.roles.admin && !u.roles.staffLinked) throw new HttpError(403, "creator_only");
    if (!limits.creator.take(u.id)) throw new HttpError(429, "slow_down");
    return u;
  }
  function requireCreator(req) {
    const u = requireUser(req);
    if (!u.roles.creator && !u.roles.admin) throw new HttpError(403, "creator_only");
    if (!limits.creator.take(u.id)) throw new HttpError(429, "slow_down");
    return u;
  }
  // Errores de reglas del programa → 400/403/404 con su código.
  // Bienvenidas y ascensos del staff en el canal de anuncios (las bajadas no se anuncian).
  const NAME = { Helper: "Helper", ModeratorJr: "Moderator Jr", Moderator: "Moderator" };
  function celebrate(job) {
    if (!job || !job.staffRank || job.staffRank === "None") return;
    const m = /staff (\w+) → (\w+)/.exec(job.reason || "");
    const from = m?.[1];
    const order = ["None", "Helper", "ModeratorJr", "Moderator"];
    if (from && order.indexOf(job.staffRank) <= order.indexOf(from)) return;
    const s = S.getStaff(db, job.discordId);
    const text = from === "None" || !from
      ? `🎉 ¡Demos la bienvenida a <@${job.discordId}> (${s?.roblox_name || ""}) como nuevo **Helper** del staff!`
      : `⬆️ ¡<@${job.discordId}> (${s?.roblox_name || ""}) ahora es **${NAME[job.staffRank]}**! Felicidades.`;
    announce(db, cfg, "staff_rank", { text, users: [job.discordId] }, fetchImpl);
  }
  const run = (fn) => { try { return fn(); } catch (e) { if (e instanceof C.Fail) throw new HttpError(e.status, e.code, e.field || null); throw e; } };

  async function readImage(req, maxBytes = 5 * 1024 * 1024) {
    const type = String(req.headers["content-type"] || "").split(";")[0].trim();
    const ext = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" }[type];
    if (!ext) throw new HttpError(415, "image_required");
    let size = 0;
    const chunks = [];
    for await (const c of req) {
      size += c.length;
      if (size > maxBytes) throw new HttpError(413, "too_large");
      chunks.push(c);
    }
    const buf = Buffer.concat(chunks);
    const magic = {
      png: buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
      jpg: buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff,
      webp: buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP",
    }[ext];
    if (!magic) throw new HttpError(415, "bad_image");
    return { buf, ext };
  }
  const safeNext = (n) => (typeof n === "string" && /^\/(creadores|admin)(\/[A-Za-z0-9_#\-\/]*)?$/.test(n) ? n : "/creadores/panel/");

  const cookie = (value, maxAgeS) =>
    `${COOKIE}=${value}; Path=/api/admin; HttpOnly; SameSite=Strict; Max-Age=${maxAgeS}${cfg.cookieSecure ? "; Secure" : ""}`;
  const sec = cfg.cookieSecure ? "; Secure" : "";
  const userCookie = (value, maxAgeS) => `${USER_COOKIE}=${value}; Path=/api; HttpOnly; SameSite=Lax; Max-Age=${maxAgeS}${sec}`;
  // El estado de OAuth vuelve desde discord.com (navegación entre sitios): SameSite=Lax.
  const stateCookie = (value, maxAgeS) => `se_oauth=${value}; Path=/api/auth; HttpOnly; SameSite=Lax; Max-Age=${maxAgeS}${sec}`;
  const fail = (u, code) => `${u}${u.includes("?") ? "&" : "?"}error=${code}`;

  const routes = {
    "GET /api/health": () => ({ ok: true }),

    "POST /api/visit": async (req) => {
      checkOrigin(req);
      if (limits.visit.take(ipOf(req))) recordVisit(db, cfg, visitorOf(req, today()));
      return { ok: true };
    },

    "GET /api/players/search": async (req, url) => {
      if (!limits.search.take(ipOf(req))) throw new HttpError(429, "slow_down");
      return searchPlayers(db, url.searchParams.get("q") || "", { fetchImpl, timeoutMs: cfg.robloxTimeoutMs, onlyPlayed: url.searchParams.get("played") === "1" });
    },

    "GET /api/players/remaining": async (req, url) => {
      const userId = Number(url.searchParams.get("userId"));
      if (!Number.isSafeInteger(userId) || userId <= 0) throw new HttpError(400, "bad_user");
      return { remaining: remainingToday(db, cfg, userId), limits: cfg.maxPerDay };
    },

    "POST /api/roll": async (req) => {
      checkOrigin(req);
      if (!limits.roll.take(ipOf(req))) throw new HttpError(429, "slow_down");
      const body = await readJson(req, 512);
      const mode = body.mode === "code" ? "code" : "user";
      const userId = Number(body.userId);
      if (mode === "user" && (!Number.isSafeInteger(userId) || userId <= 0)) throw new HttpError(400, "bad_user");
      try {
        return doRoll(db, cfg, { mode, userId, visitor: visitorOf(req, today()) });
      } catch (err) {
        if (err.message === "unknown_player") throw new HttpError(400, "unknown_player");
        throw err;
      }
    },

    // ----- Juego (servidores de Roblox) -----
    "POST /api/game/pull": async (req) => { requireGame(req); return gamePull(db, cfg, await readJson(req, 64_000)); },
    "POST /api/game/ack": async (req) => { requireGame(req); return gameAck(db, await readJson(req, 32_000)); },
    // Alertas de huevos absurdos (el bot publica en Discord) y catálogo de assets del juego.
    "POST /api/game/egg-alert": async (req) => { requireGame(req); return receiveEggAlert(db, cfg, await readJson(req, 8192), fetchImpl, log); },
    "POST /api/game/egg-alert/update": async (req) => { requireGame(req); return updateEggAlert(db, cfg, await readJson(req, 2048), fetchImpl); },
    "POST /api/game/catalog": async (req) => {
      requireGame(req);
      const b = await readJson(req, 400_000);
      const out = saveCatalog(db, b.items);
      syncAssets(db, cfg, fetchImpl, log).catch((e) => log.warn(`[assets] ${e.message}`));
      return out;
    },
    // Catálogo público (para la web): huevos y mascotas con su imagen guardada en la página.
    "GET /api/catalog": async (req) => {
      if (!limits.publicList.take(ipOf(req))) throw new HttpError(429, "slow_down");
      return { items: catalog(db, cfg) };
    },
    // Estado del bot: botones, canales, últimas alertas y anuncios, imágenes guardadas.
    "GET /api/mod/bot/status": async (req) => {
      staffActor(req);
      const d = cfg.discord;
      return {
        bot: botEnabled(cfg), interactions: interactionsEnabled(cfg), interactionsUrl: `${cfg.siteUrl}/api/discord/interactions`,
        videoChannel: d.videoChannel, videoPingRole: d.videoPingRole || null, eggChannel: d.eggChannel, eggPingRole: d.eggPingRole || null, eggLang: d.eggLang,
        assets: { ...assetStatus(db), apiKey: Boolean(cfg.roblox.apiKey) },
        alerts: db.prepare("SELECT id, asset, place, studio, status, grabbed_by_name, created_at, message_id IS NOT NULL AS posted, post_error FROM egg_alerts ORDER BY id DESC LIMIT 8").all(),
        videos: db.prepare("SELECT id, title, platform, url, views, announce_msg IS NOT NULL AS posted, announce_error, reviewed_at FROM evidences WHERE status = 'approved' ORDER BY reviewed_at DESC LIMIT 8").all(),
      };
    },
    // Prueba: alerta [STUDIO] con un huevo del catálogo (o el último que salió).
    "POST /api/mod/bot/test-egg": async (req) => {
      checkOrigin(req); const a = requireAdmin(req);
      const egg = db.prepare("SELECT * FROM game_assets WHERE kind = 'egg' ORDER BY RANDOM() LIMIT 1").get();
      const out = await receiveEggAlert(db, cfg, {
        key: `test:${Date.now()}`, studio: true, asset: egg?.name || "Moon Egg", rarity: egg?.rarity || "Legendary", size: "absurdo",
        weight: 777, value: 1_000_000, place: "Prueba", iconId: egg?.asset_id || null, jobId: "studio", players: 1, maxPlayers: 12,
        i18n: { es: { place: "Prueba desde el panel" }, en: { place: "Test from the panel" }, pt: { place: "Teste do painel" } },
      }, fetchImpl, log);
      C.audit(db, a, "bot.test_egg", null, { id: out.id });
      return out;
    },
    // Volver a publicar el anuncio de un video aprobado que no salió (p. ej. el bot no tenía permisos).
    "POST /api/mod/bot/announce-video": async (req) => {
      checkOrigin(req); const a = staffActor(req);
      const b = await readJson(req, 256);
      // resend: borra el anuncio anterior y lo publica otra vez con el formato actual (para probar cambios).
      const out = b.resend === true ? await resendVideo(db, cfg, b.id, fetchImpl, log) : await announceVideo(db, cfg, b.id, fetchImpl, log);
      C.audit(db, a, b.resend === true ? "bot.resend_video" : "bot.announce_video", null, { id: Number(b.id), ok: out.sent, motivo: out.reason || null });
      return out;
    },
    // Reenviar una alerta de huevo (borra la anterior y publica de nuevo con el formato actual).
    "POST /api/mod/bot/resend-egg": async (req) => {
      checkOrigin(req); const a = staffActor(req);
      const b = await readJson(req, 256);
      const out = await resendEggAlert(db, cfg, b.id, fetchImpl, log);
      C.audit(db, a, "bot.resend_egg", null, { id: Number(b.id), ok: out.sent, motivo: out.reason || null });
      return out;
    },
    "GET /api/mod/assets": async (req) => { staffActor(req); return { ...assetStatus(db), apiKey: Boolean(cfg.roblox.apiKey), items: catalog(db, cfg) }; },
    "POST /api/mod/assets/sync": async (req) => {
      checkOrigin(req); const a = requireAdmin(req);
      const b = await readJson(req, 256);
      // Sin catálogo no hay nada que bajar: llega cuando arranca un servidor del juego (versión publicada).
      const { total } = assetStatus(db);
      if (!total) return { ok: true, started: false, total: 0 };
      syncAssets(db, cfg, fetchImpl, log, { force: b.force === true }).catch(() => {});
      C.audit(db, a, "assets.sync", null, { force: b.force === true });
      return { ok: true, started: true, total };
    },
    // Botones de Discord (Interactions Endpoint URL). Discord firma cada petición.
    "POST /api/discord/interactions": async (req) => {
      const chunks = []; let size = 0;
      for await (const c of req) { size += c.length; if (size > 64_000) throw new HttpError(413, "too_large"); chunks.push(c); }
      const raw = Buffer.concat(chunks);
      if (!verifyInteraction(cfg.discord.publicKey, req.headers["x-signature-ed25519"], req.headers["x-signature-timestamp"], raw)) throw new HttpError(401, "bad_signature");
      let it;
      try { it = JSON.parse(raw.toString("utf8")); } catch { throw new HttpError(400, "bad_json"); }
      if (it.type === 1) return { type: REPLY.PONG };
      if (it.type !== 3) return { type: REPLY.MESSAGE, data: { content: "🥚", flags: EPHEMERAL } };
      const id = String(it.data?.custom_id || "");
      let out;
      try {
        out = id.startsWith("v") ? await handleVideoButton(db, cfg, it, fetchImpl) : await handleEggButton(db, cfg, it, fetchImpl);
      } catch (e) {
        log.error("[discord] botón", e);
        out = { type: REPLY.MESSAGE, data: { content: "Algo salió mal. Inténtalo de nuevo.", flags: EPHEMERAL } };
      }
      // Confirmación privada aparte (cuando el botón actualiza el mensaje público).
      if (out.followup) {
        const text = out.followup; delete out.followup;
        setTimeout(() => fetchImpl(`https://discord.com/api/v10/webhooks/${it.application_id}/${it.token}`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ content: text, flags: EPHEMERAL, allowed_mentions: { parse: [] } }),
        }).catch(() => {}), 400);
      }
      return out;
    },
    "POST /api/game/redeem": async (req) => {
      requireGame(req);
      const body = await readJson(req, 2048);
      if (!limits.redeem.take(`u${Number(body.userId) || 0}`)) return { ok: false, error: "slow_down" };
      return gameRedeem(db, cfg, body);
    },

    "POST /api/game/staff/report": async (req) => {
      requireGame(req);
      const body = await readJson(req, 4096);
      const out = S.recordReport(db, body);
      if (out.ok) announce(db, cfg, "game_report", { text: `📣 **Reporte del juego**: ${String(body.reporterName).slice(0, 20)} reportó a **${String(body.targetName).slice(0, 20)}**${body.online ? " (en el servidor ahora)" : ""}. Atiéndelo en ${cfg.siteUrl}/creadores/panel/#staff-reportes` }, fetchImpl);
      return out;
    },

    // ----- Panel -----
    "POST /api/admin/login": async (req) => {
      checkOrigin(req);
      const ip = ipOf(req);
      if (!limits.login.take(ip)) throw new HttpError(429, "too_many_attempts");
      const body = await readJson(req, 1024);
      const userOk = safeEqual(String(body.user || ""), cfg.adminUser);
      const passOk = verifyPassword(String(body.password || ""), cfg.adminPasswordHash);
      if (!userOk || !passOk) {
        log.warn(`[admin] login fallido desde ${ip}`);
        throw new HttpError(401, "bad_credentials");
      }
      log.info(`[admin] login correcto desde ${ip}`);
      return { status: 200, body: { ok: true }, headers: { "set-cookie": cookie(createSession(db), SESSION_MS / 1000) } };
    },
    "POST /api/admin/logout": async (req) => {
      checkOrigin(req);
      deleteSession(db, readCookie(req.headers.cookie, COOKIE));
      return { status: 200, body: { ok: true }, headers: { "set-cookie": cookie("", 0) } };
    },
    "GET /api/admin/me": async (req) => { const a = requireAdmin(req); return { ok: true, user: a.name }; },
    "GET /api/admin/metrics": async (req, url) => {
      requireAdmin(req);
      return metrics(db, cfg, Number(url.searchParams.get("days")) || 30);
    },
    "GET /api/admin/codes": async (req) => { requireAdmin(req); return { codes: adminListCodes(db) }; },
    "POST /api/admin/codes": async (req) => {
      checkOrigin(req);
      const actor = requireAdmin(req);
      const out = adminCreateCodes(db, await readJson(req, 512));
      if (out.ok) {
        log.info(`[admin] ${out.codes.length} código(s) ${out.tier} generados por ${actor.name}`);
        C.audit(db, actor, "codes.create", null, { tier: out.tier, count: out.codes.length, expiresAt: out.expiresAt });
      }
      return out;
    },
    "POST /api/admin/gift": async (req) => {
      checkOrigin(req);
      const actor = requireAdmin(req);
      const out = adminGift(db, cfg, await readJson(req, 512));
      if (out.ok) {
        log.info(`[admin] regalo ${out.sent}x ${out.tier} a ${out.player.name} (${out.player.userId}) por ${actor.name}`);
        C.audit(db, actor, "gift.send", `${out.player.name} (${out.player.userId})`, { tier: out.tier, count: out.sent });
      }
      return out;
    },

    // ----- Login con Discord -----
    "GET /api/auth/discord/login": async (req, url) => {
      const next = safeNext(url.searchParams.get("next"));
      if (!discordEnabled(cfg)) return { redirect: fail(next, "discord_off") };
      if (!limits.oauth.take(ipOf(req))) return { redirect: fail(next, "slow_down") };
      const state = randomBytes(24).toString("base64url");
      db.prepare("DELETE FROM oauth_states WHERE created_at < ?").run(Date.now() - 10 * 60_000);
      db.prepare("INSERT INTO oauth_states (state, next, created_at) VALUES (?, ?, ?)").run(state, next, Date.now());
      return { redirect: authorizeUrl(cfg, state), headers: { "set-cookie": stateCookie(state, 600) } };
    },
    "GET /api/auth/discord/callback": async (req, url) => {
      const state = url.searchParams.get("state") || "";
      const row = db.prepare("SELECT next, created_at FROM oauth_states WHERE state = ?").get(state);
      const cookieState = readCookie(req.headers.cookie, "se_oauth");
      const clear = stateCookie("", 0);
      if (!row || !cookieState || !safeEqual(cookieState, state) || Date.now() - row.created_at > 10 * 60_000) {
        return { redirect: fail("/creadores/panel/", "login_expired"), headers: { "set-cookie": clear } };
      }
      db.prepare("DELETE FROM oauth_states WHERE state = ?").run(state);
      const code = url.searchParams.get("code");
      if (!code) return { redirect: fail(row.next, "login_cancelled"), headers: { "set-cookie": clear } };
      let ident;
      try { ident = await fetchDiscordIdentity(cfg, code, fetchImpl); } catch (e) {
        log.warn(`[discord] login falló: ${e.message}`);
        return { redirect: fail(row.next, "discord_error"), headers: { "set-cookie": clear } };
      }
      const roles = rolesFrom(cfg, ident.member);
      C.upsertDiscordUser(db, ident.user, roles);
      // Aprobado antes de unirse al servidor (o sin el rol): se le pone ahora que está.
      if (roles.inGuild) await runRoleJobs(db, cfg, wantedRoleJobs(db, cfg, ident.user.id, ident.member?.roles || []), fetchImpl, log);
      const token = createSession(db, Date.now(), "discord", String(ident.user.id), USER_SESSION_MS);
      log.info(`[discord] login ${ident.user.username} (${ident.user.id}) admin=${roles.admin} mod=${roles.moderator} creador=${roles.creator}`);
      return { redirect: row.next, headers: { "set-cookie": [clear, userCookie(token, USER_SESSION_MS / 1000)] } };
    },
    "POST /api/auth/logout": async (req) => {
      checkOrigin(req);
      deleteSession(db, readCookie(req.headers.cookie, USER_COOKIE));
      return { status: 200, body: { ok: true }, headers: { "set-cookie": userCookie("", 0) } };
    },
    "GET /api/me": async (req) => {
      const u = currentUser(req);
      if (!u) return { status: 200, body: { user: null, discord: discordEnabled(cfg) } };
      const acked = new Set(db.prepare("SELECT program FROM onboarding WHERE discord_id = ?").all(String(u.id)).map((r) => r.program));
      return { user: u, discord: true, application: C.myApplication(db, u.id), staffApplication: S.myStaffApplication(db, u.id),
        onboarding: { creator: acked.has("creator"), staff: acked.has("staff") } };
    },
    // Bienvenida: el creador o el staff confirma que vio los videos y entendió el programa (una vez).
    "POST /api/onboarding/ack": async (req) => {
      checkOrigin(req);
      const u = requireUser(req);
      const b = await readJson(req, 128);
      const program = b?.program;
      const r = u.roles;
      const allowed = program === "creator" ? r.creator : program === "staff" ? (r.staffLinked || (r.moderator && !r.admin)) : false;
      if (!allowed) throw new HttpError(403, "forbidden");
      db.prepare("INSERT OR IGNORE INTO onboarding (discord_id, program, acked_at) VALUES (?, ?, ?)").run(String(u.id), program, Date.now());
      return { ok: true };
    },

    // ----- Programa de creadores -----
    // Cuenta de Roblox del usuario (obligatoria para usar el panel).
    "POST /api/account/roblox": async (req) => {
      checkOrigin(req);
      const u = requireUser(req, { allowUnlinked: true });
      if (!limits.apply.take(`r${u.id}`)) throw new HttpError(429, "slow_down");
      const b = await readJson(req, 256);
      const out = run(() => C.linkAccount(db, u.id, b.robloxUserId));
      C.audit(db, { id: u.id, name: u.globalName ? `${u.globalName} (@${u.username})` : `@${u.username}`, role: "user" }, "account.roblox", `@${out.roblox.name}`, { roblox: out.roblox.userId });
      // Si ya era creador o staff aprobado y le faltaba el rol en Discord, se pone ahora.
      await reconcileRoles(u.id);
      return out;
    },
    "GET /api/creators/program": async () => publicProgram(cfg),
    // Carrusel: creadores aprobados que no ocultaron su perfil (nombre, foto, rango y redes).
    "GET /api/staff/public": async (req) => {
      if (!limits.publicList.take(ipOf(req))) throw new HttpError(429, "slow_down");
      return publicStaff(db, cfg, fetchImpl);
    },
    "POST /api/staff/public-profile": async (req) => {
      checkOrigin(req);
      const u = requireUser(req);
      const b = await readJson(req, 256);
      const r = db.prepare("UPDATE staff SET public_profile = ? WHERE discord_id = ? AND link_status = 'approved'").run(b.on ? 1 : 0, String(u.id));
      if (!r.changes) throw new HttpError(403, "not_staff");
      return { ok: true, publicProfile: Boolean(b.on) };
    },
    "GET /api/creators/public": async (req) => {
      if (!limits.publicList.take(ipOf(req))) throw new HttpError(429, "slow_down");
      return publicCreators(db, cfg, fetchImpl);
    },
    "POST /api/creators/public-profile": async (req) => {
      checkOrigin(req);
      const u = requireCreator(req);
      const body = await readJson(req, 256);
      const out = run(() => C.setPublicProfile(db, u.id, body.on === true));
      clearPublicCache();
      return out;
    },
    "POST /api/creators/apply": async (req) => {
      checkOrigin(req);
      const u = requireUser(req);
      if (!limits.apply.take(u.id)) throw new HttpError(429, "slow_down");
      const body = await readJson(req, 8192);
      const out = run(() => C.submitApplication(db, u.id, body));
      announce(db, cfg, "creator_application", { text: `📝 **Nueva solicitud de creador** de @${u.username}. Revísala en ${cfg.siteUrl}/creadores/panel/#mod-solicitudes` }, fetchImpl);
      return out;
    },
    "GET /api/creators/me": async (req) => {
      const u = requireUser(req);
      if (!u.roles.creator && !u.roles.admin) throw new HttpError(403, "creator_only");
      return C.creatorState(db, cfg, u.id);
    },
    "POST /api/creators/link": async (req) => {
      checkOrigin(req);
      const u = requireCreator(req);
      const body = await readJson(req, 512);
      const out = run(() => C.requestLink(db, u.id, body.userId));
      announce(db, cfg, "creator_link", { text: `🔗 El creador @${u.username} pidió vincular la cuenta de Roblox @${out.roblox.name}: ${cfg.siteUrl}/creadores/panel/#mod-vinculos` }, fetchImpl);
      return out;
    },
    "POST /api/creators/upload": async (req) => {
      checkOrigin(req);
      const u = requireCreatorOrStaff(req);
      if (!limits.upload.take(u.id)) throw new HttpError(429, "slow_down");
      const { buf, ext } = await readImage(req);
      mkdirSync(cfg.uploadsDir, { recursive: true });
      const file = `${C.saveUploadName()}.${ext}`;
      writeFileSync(join(cfg.uploadsDir, file), buf, { mode: 0o640 });
      db.prepare("INSERT INTO audit (ts, actor_id, actor_name, actor_role, action, target, details) VALUES (?, ?, ?, 'creator', 'upload', ?, NULL)")
        .run(Date.now(), u.id, `@${u.username}`, file);
      return { ok: true, file };
    },
    "POST /api/creators/evidence": async (req) => {
      checkOrigin(req);
      const u = requireCreator(req);
      const body = await readJson(req, 4096);
      const out = run(() => C.addEvidence(db, u.id, body));
      announce(db, cfg, "creator_evidence", { text: `📹 **Nuevo video de creador** de @${u.username} para anotar las vistas: ${cfg.siteUrl}/creadores/panel/#mod-evidencias` }, fetchImpl);
      // Primera lectura de vistas en segundo plano (el moderador ya la ve al revisar).
      if (out.track === "auto" && cfg.views.enabled) probeEvidence(db, cfg, out.id, body.url, probe, log);
      return out;
    },
    "POST /api/creators/recount": async (req) => {
      checkOrigin(req);
      const u = requireCreator(req);
      const body = await readJson(req, 512);
      return run(() => C.requestRecount(db, u.id, body.id));
    },
    "POST /api/creators/claim": async (req) => {
      checkOrigin(req);
      const u = requireCreator(req);
      const body = await readJson(req, 512);
      const out = run(() => C.claimPack(db, cfg, u.id, body));
      C.audit(db, { id: u.id, name: `@${u.username}`, role: "creator" }, "claim", out.roblox, { pack: out.pack, period: out.period });
      return out;
    },
    "POST /api/creators/bonus": async (req) => {
      checkOrigin(req);
      const u = requireCreator(req);
      const body = await readJson(req, 512);
      const out = run(() => C.requestBonus(db, u.id, body.evidenceId));
      announce(db, cfg, "creator_bonus", { text: `💰 @${u.username} pidió un **bono de ${out.robux} Robux** por un video: ${cfg.siteUrl}/creadores/panel/#mod-bonos` }, fetchImpl);
      return out;
    },
    "POST /api/creators/special": async (req) => {
      checkOrigin(req);
      const u = requireCreator(req);
      const body = await readJson(req, 2048);
      const out = run(() => C.requestSpecial(db, cfg, u.id, body));
      announce(db, cfg, "creator_special", { text: `👑 @${u.username} pasó las 100.000 vistas del mes y envió un **pedido especial**: ${cfg.siteUrl}/creadores/panel/#mod-especiales` }, fetchImpl);
      return out;
    },

    // ----- Programa de staff -----
    "GET /api/staff/program": async () => publicStaffProgram(cfg, getStaffSettings(db, cfg)),
    // Inicio del panel: pendientes por prioridad y accesos rápidos según el rol.
    "GET /api/home": async (req) => {
      const u = requireUser(req);
      const r = u.roles;
      const actor = { id: u.id, name: u.globalName ? `${u.globalName} (@${u.username})` : `@${u.username}`, role: r.admin ? "admin" : r.moderator ? "moderator" : r.modjr ? "modjr" : r.helper ? "helper" : "user", staffRank: r.staffRank };
      return homeFeed(db, cfg, u, actor);
    },
    "POST /api/staff/excuse": async (req) => {
      checkOrigin(req);
      const u = requireUser(req);
      if (!limits.creator.take(u.id)) throw new HttpError(429, "slow_down");
      const body = await readJson(req, 4096);
      const out = run(() => S.submitExcuse(db, cfg, u.id, body));
      const rank = S.getStaff(db, u.id)?.rank;
      announce(db, cfg, "staff_excuse", { text: `📝 @${u.username} (${rank}) presentó una **excusa** (${out.scope === "week" ? "semana del" : "mes"} ${out.period}): ${cfg.siteUrl}/creadores/panel/#staff-excusas-revision`, auto: reviewerRanks(rank) }, fetchImpl);
      return out;
    },
    "GET /api/staff/me": async (req) => { const u = requireUser(req); return S.myStaffState(db, cfg, u); },
    "POST /api/staff/apply": async (req) => {
      checkOrigin(req);
      const u = requireUser(req);
      if (!limits.apply.take(`s${u.id}`)) throw new HttpError(429, "slow_down");
      const body = await readJson(req, 40_000);
      const out = run(() => S.submitStaffApplication(db, u.id, body));
      announce(db, cfg, "staff_application", { text: `🛟 **Nueva solicitud de Helper** de @${u.username}: ${cfg.siteUrl}/creadores/panel/#staff-solicitudes` }, fetchImpl);
      return out;
    },
    "POST /api/staff/link": async (req) => {
      checkOrigin(req);
      const u = requireUser(req);
      const body = await readJson(req, 512);
      const out = run(() => tx(db, () => S.requestStaffLink(db, cfg, u, body)));
      if (out.job) await runRoleJobs(db, cfg, [out.job], fetchImpl, log);
      if (!out.auto) announce(db, cfg, "staff_link", { text: `🔗 @${u.username} (${out.rank}) pidió vincular la cuenta de Roblox @${out.roblox.name}: ${cfg.siteUrl}/creadores/panel/#staff-solicitudes` }, fetchImpl);
      return { ok: true, auto: out.auto, rank: out.rank };
    },
    "POST /api/staff/evidence": async (req) => {
      checkOrigin(req);
      const u = requireUser(req);
      if (!limits.creator.take(u.id)) throw new HttpError(429, "slow_down");
      const body = await readJson(req, 4096);
      const out = run(() => S.addStaffEvidence(db, u.id, body));
      const rank = S.getStaff(db, u.id)?.rank;
      announce(db, cfg, "staff_evidence", { text: `🧾 @${u.username} (${rank}) subió una evidencia de sus tareas: ${cfg.siteUrl}/creadores/panel/#staff-revision`, auto: reviewerRanks(rank) }, fetchImpl);
      return out;
    },
    "POST /api/staff/promotion": async (req) => {
      checkOrigin(req);
      const a = staffMember(req, "helper");
      const body = await readJson(req, 2048);
      const out = run(() => S.requestPromotion(db, a, body, Date.now(), cfg));
      announce(db, cfg, "staff_promotion", { text: `⬆️ Pedido de **ascenso a ${out.to === "ModeratorJr" ? "Moderator Jr" : "Moderator"}** (lo pidió ${a.name}): ${cfg.siteUrl}/creadores/panel/#staff-ascensos`, auto: out.to === "Moderator" ? ["Admin"] : ["Moderator"] }, fetchImpl);
      return out;
    },

    // ----- Moderación del staff -----
    "GET /api/mod/staff": async (req) => { staffMember(req, "modjr"); return { ...S.staffDashboard(db, cfg), bot: botEnabled(cfg) }; },
    "GET /api/mod/staff/applications": async (req) => { staffActor(req); return { applications: S.staffApplicationsQueue(db) }; },
    "POST /api/mod/staff/application": async (req) => {
      checkOrigin(req); const a = staffActor(req); const b = await readJson(req, 2048);
      const out = run(() => tx(db, () => S.reviewStaffApplication(db, a, b)));
      const r = out.job ? await runRoleJobs(db, cfg, [out.job], fetchImpl, log) : [];
      celebrate(out.job);
      return { ok: true, status: out.status, discordRole: !out.job ? null : botEnabled(cfg) ? (r[0]?.ok ? "ok" : r[0]?.notMember ? "pending_join" : "error") : "manual" };
    },
    "POST /api/mod/staff/link": async (req) => {
      checkOrigin(req); const a = staffActor(req); const b = await readJson(req, 1024);
      const out = run(() => tx(db, () => S.reviewStaffLink(db, a, b)));
      if (out.job) await runRoleJobs(db, cfg, [out.job], fetchImpl, log);
      return { ok: true };
    },
    "GET /api/mod/staff/evidence": async (req) => { const a = staffMember(req, "modjr"); return { evidences: S.staffEvidenceQueue(db, a) }; },
    "POST /api/mod/staff/evidence": async (req) => { checkOrigin(req); const a = staffMember(req, "modjr"); const b = await readJson(req, 2048); return run(() => S.reviewStaffEvidence(db, a, b)); },
    "POST /api/mod/staff/rank": async (req) => {
      checkOrigin(req); const a = staffActor(req); const b = await readJson(req, 1024);
      const out = run(() => tx(db, () => S.changeStaffRank(db, a, b)));
      const r = await runRoleJobs(db, cfg, [out.job], fetchImpl, log);
      celebrate(out.job);
      return { ok: true, discord: botEnabled(cfg) ? (r[0]?.ok ? "ok" : r[0]?.notMember ? "pending_join" : "error") : "manual" };
    },
    "POST /api/mod/staff/promotion": async (req) => {
      checkOrigin(req); const a = staffActor(req); const b = await readJson(req, 1024);
      const out = run(() => tx(db, () => S.reviewPromotion(db, a, b)));
      if (out.job) await runRoleJobs(db, cfg, [out.job], fetchImpl, log);
      celebrate(out.job);
      return { ok: true };
    },
    "GET /api/mod/staff/excuses": async (req) => { const a = staffMember(req, "modjr"); return { excuses: S.excuseQueue(db, a) }; },
    "POST /api/mod/staff/excuse": async (req) => { checkOrigin(req); const a = staffMember(req, "modjr"); const b = await readJson(req, 2048); return run(() => tx(db, () => S.reviewExcuse(db, cfg, a, b))); },
    // Ajustes del staff (solo el Admin los cambia; el resto del staff puede verlos).
    "GET /api/mod/staff/settings": async (req) => {
      staffMember(req, "modjr");
      const s = getStaffSettings(db, cfg);
      return { ...staffSettingsInfo(db, cfg), channels: discordChannelsStatus(db, s), bot: botEnabled(cfg), announceEvents: ANNOUNCE_EVENTS, mentionable: MENTIONABLE, announceChannel: cfg.discord.announceChannel };
    },
    "POST /api/mod/staff/settings": async (req) => {
      checkOrigin(req); const a = requireAdmin(req); const b = await readJson(req, 16_384);
      const out = run(() => (b.reset ? resetStaffSettings(db, cfg, a) : saveStaffSettings(db, cfg, a, b)));
      return { ...out, channels: discordChannelsStatus(db, out.settings) };
    },
    // Lee ya los canales de Discord (para probar la configuración).
    "POST /api/mod/staff/discord-poll": async (req) => {
      checkOrigin(req); requireAdmin(req);
      const s = getStaffSettings(db, cfg);
      if (!botEnabled(cfg)) throw new HttpError(400, "no_bot");
      const out = await pollDiscordChannels(db, cfg, s, fetchImpl);
      return { ...out, channels: discordChannelsStatus(db, s) };
    },
    "GET /api/mod/reports": async (req, url) => { staffMember(req, "modjr"); return { reports: S.reportsList(db, url.searchParams.get("status") || "open") }; },
    "POST /api/mod/report": async (req) => { checkOrigin(req); const a = staffMember(req, "modjr"); const b = await readJson(req, 2048); return run(() => S.reviewReport(db, a, b)); },
    // Diagnóstico del bot de Discord: qué falta para poner roles (y si un usuario está en el servidor).
    "GET /api/mod/discord/check": async (req, url) => {
      staffActor(req);
      const userId = url.searchParams.get("userId");
      const roles = { "Content Creator": cfg.discord.roles.creator, ...Object.fromEntries(Object.entries(cfg.discord.staffRoles).map(([k, v]) => [k, v])) };
      for (const [k, v] of Object.entries(cfg.discord.levelRoles || {})) if (v) roles[`Creator ${k}`] = v;
      return diagnoseBot(cfg, roles, userId && /^\d{5,25}$/.test(userId) ? userId : null, fetchImpl);
    },
    "POST /api/mod/staff/sync": async (req) => {
      checkOrigin(req); requireAdmin(req);
      const members = await listMembersWithRoles(cfg, Object.values(cfg.discord.staffRoles), fetchImpl);
      if (!members) throw new HttpError(400, "members_intent");
      const jobs = S.syncDiscordStaff(db, cfg, members);
      await runRoleJobs(db, cfg, jobs, fetchImpl, log);
      return { ok: true, members: members.length, changes: jobs.length };
    },

    // ----- Moderación (moderadores y admin) -----
    "GET /api/mod/queue": async (req) => {
      const a = staffMember(req, "modjr");
      const mod = a.role === "admin" || a.role === "moderator";
      const empty = { applications: [], links: [], evidences: [], bonuses: [], specials: [] };
      // Conteos del staff para la barra lateral.
      const staffCounts = {
        reports: db.prepare("SELECT COUNT(*) AS n FROM reports WHERE status = 'open'").get().n,
        evidence: S.staffEvidenceQueue(db, a).length,
        excuses: S.excuseQueue(db, a).length,
        applications: mod ? db.prepare("SELECT COUNT(*) AS n FROM staff_applications WHERE status IN ('pending','contacted')").get().n : 0,
        promotions: mod ? db.prepare("SELECT COUNT(*) AS n FROM staff_promotions WHERE status = 'pending'").get().n : 0,
        links: mod ? db.prepare("SELECT COUNT(*) AS n FROM staff WHERE link_status = 'pending'").get().n : 0,
      };
      return { actor: a, ...(mod ? C.modQueue(db, a) : empty), staff: staffCounts };
    },
    "GET /api/mod/applications": async (req, url) => { staffActor(req); return { applications: C.modApplications(db, url.searchParams.get("status") || "all") }; },
    "GET /api/mod/creators": async (req) => { staffActor(req); return { ...creatorsDashboard(db, cfg), bot: botEnabled(cfg) }; },
    "GET /api/mod/creator": async (req, url) => {
      staffActor(req);
      const d = creatorDetail(db, url.searchParams.get("discordId") || "");
      if (!d) throw new HttpError(404, "not_found");
      return d;
    },
    "GET /api/mod/notices": async (req, url) => { staffActor(req); return { notices: noticeList(db, { limit: Number(url.searchParams.get("limit")) || 200 }) }; },
    "GET /api/mod/legacy": async (req) => { staffActor(req); return { legacy: legacyList(db), deadline: cfg.creators.legacyDeadline, days: cfg.creators.legacyNoticeDays }; },
    // Corrección manual del rango (o "None" para sacarlo del programa). Avisa por el buzón y en Discord.
    "POST /api/mod/creator/tier": async (req) => {
      checkOrigin(req);
      const a = staffActor(req);
      const b = await readJson(req, 1024);
      const tier = String(b.tier || "");
      if (tier !== "None" && !LEVEL_KEYS.includes(tier)) throw new HttpError(400, "bad_tier");
      if (String(b.discordId) === String(a.id)) throw new HttpError(403, "own_item");
      const job = run(() => tx(db, () => setCreatorTier(db, a, b.discordId, tier, tier === "None" ? "removed" : null)));
      if (!job) throw new HttpError(400, "same_tier");
      clearPublicCache();
      const roles = await runRoleJobs(db, cfg, [job], fetchImpl, log);
      return { ok: true, tier, discord: botEnabled(cfg) ? (roles[0]?.ok ? "ok" : "error") : "manual" };
    },
    "GET /api/mod/audit": async (req, url) => { staffActor(req); return { audit: C.auditList(db, Number(url.searchParams.get("limit")) || 150) }; },
    "POST /api/mod/application": async (req) => {
      checkOrigin(req); const a = staffActor(req); const b = await readJson(req, 2048);
      const out = run(() => C.reviewApplication(db, a, b));
      if (out.status === "approved") {
        const app = db.prepare("SELECT discord_id FROM applications WHERE id = ?").get(Number(b.id));
        clearPublicCache();
        if (app && botEnabled(cfg)) {
          const r = await runRoleJobs(db, cfg, [{ discordId: app.discord_id, tierKey: "Creator", reason: "solicitud aprobada" }], fetchImpl, log);
          out.discordRole = r[0]?.ok ? "ok" : r[0]?.notMember ? "pending_join" : "error";
        } else out.discordRole = "manual";
      }
      // Rechazada: si tenía el rol de Content Creator (p. ej. creador antiguo), se le quita.
      if (out.status === "rejected" && botEnabled(cfg)) {
        const app = db.prepare("SELECT discord_id FROM applications WHERE id = ?").get(Number(b.id));
        const linked = app && db.prepare("SELECT 1 FROM creators WHERE discord_id = ? AND link_status = 'approved'").get(app.discord_id);
        if (app && !linked) {
          const r = await runRoleJobs(db, cfg, [{ discordId: app.discord_id, tierKey: "None", reason: "solicitud rechazada" }], fetchImpl, log);
          out.discordRole = r[0]?.ok ? "removed" : "error";
        }
      }
      return out;
    },
    // Corregir datos de una solicitud (redes repetidas, video en vez del canal, correo).
    "POST /api/mod/application/edit": async (req) => {
      checkOrigin(req); const a = staffActor(req); const b = await readJson(req, 8192);
      const out = run(() => C.editApplication(db, a, b));
      clearPublicCache(); // el carrusel público muestra las redes
      return out;
    },
    "POST /api/mod/link": async (req) => { checkOrigin(req); const a = staffActor(req); const b = await readJson(req, 2048); return run(() => C.reviewLink(db, a, b)); },
    "POST /api/mod/evidence": async (req) => {
      checkOrigin(req); const a = staffActor(req); const b = await readJson(req, 2048);
      const out = run(() => C.reviewEvidence(db, a, b));
      // Aprobada: se anuncia en el canal de videos de Discord (una sola vez). Vistas fijadas: se actualiza.
      if (b.action === "approve" && out.status === "approved") announceVideo(db, cfg, b.id, fetchImpl, log);
      else if (b.action === "update") refreshVideoMessage(db, cfg, b.id, fetchImpl).catch(() => {});
      // Las vistas nuevas pueden subir el rango al momento.
      try {
        const ev = evaluateCreators(db, cfg);
        if (ev.changes.length) { clearPublicCache(); out.rankChanges = ev.changes.length; }
        runRoleJobs(db, cfg, ev.roleJobs, fetchImpl, log);
      } catch (e) { log.error("[creadores]", e); }
      return out;
    },
    "POST /api/mod/evidence/probe": async (req) => {
      checkOrigin(req); const a = staffActor(req);
      const b = await readJson(req, 256);
      const ev = db.prepare("SELECT id, url, status, track FROM evidences WHERE id = ?").get(Number(b.id));
      if (!ev) throw new HttpError(404, "not_found");
      if (!cfg.views.enabled) throw new HttpError(400, "views_off");
      const out = await probeEvidence(db, cfg, ev.id, ev.url, probe, log);
      C.audit(db, a, "evidence.probe", null, { id: ev.id, ok: out?.ok, views: out?.views ?? null, error: out?.error ?? null });
      return out;
    },
    "POST /api/mod/bonus": async (req) => {
      checkOrigin(req); const a = staffActor(req); const b = await readJson(req, 2048);
      const out = run(() => C.reviewBonus(db, a, b));
      if (out.status === "pending_admin") announce(db, cfg, "creator_bonus_admin", { text: `💰 Un bono de Robux de creador quedó **listo para el Admin** (lo revisó ${a.name}): ${cfg.siteUrl}/creadores/panel/#mod-bonos` }, fetchImpl);
      return out;
    },
    "POST /api/mod/special": async (req) => { checkOrigin(req); const a = staffActor(req, true); const b = await readJson(req, 2048); return run(() => C.reviewSpecial(db, a, b)); },
  };

  // Archivos de evidencias: solo los ve su dueño o el staff.
  function serveFile(req, res, name) {
    if (!/^[a-f0-9]{32}\.(png|jpg|webp)$/.test(name)) throw new HttpError(404, "not_found");
    let allowed = false;
    try { staffActor(req); allowed = true; } catch {
      const u = currentUser(req);
      allowed = Boolean(u && (db.prepare("SELECT 1 FROM evidences WHERE file = ? AND discord_id = ?").get(name, u.id)
        || db.prepare("SELECT 1 FROM staff_evidence WHERE file = ? AND discord_id = ?").get(name, u.id)));
    }
    if (!allowed) throw new HttpError(403, "forbidden");
    const path = join(cfg.uploadsDir, name);
    if (!existsSync(path)) throw new HttpError(404, "not_found");
    const type = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" }[name.split(".").pop()];
    res.writeHead(200, {
      "content-type": type, "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox", "content-disposition": "inline",
    });
    res.end(readFileSync(path));
  }

  // Imágenes del juego guardadas en la página (solo assets del catálogo: no es un proxy abierto).
  async function serveAsset(res, name) {
    const id = Number((name.match(/^(\d{5,20})(\.png)?$/) || [])[1]);
    if (!id || !db.prepare("SELECT 1 FROM game_assets WHERE asset_id = ?").get(id)) throw new HttpError(404, "not_found");
    const img = await assetImage(db, cfg, id, fetchImpl);
    if (!img) throw new HttpError(404, "not_found");
    res.writeHead(200, { "content-type": img.type, "cache-control": "public, max-age=86400", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox" });
    res.end(img.bytes);
  }

  return async function handler(req, res) {
    const url = new URL(req.url, "http://local");
    const route = routes[`${req.method} ${url.pathname}`];
    try {
      if (req.method === "GET" && url.pathname.startsWith("/api/files/")) return serveFile(req, res, url.pathname.slice(11));
      if (req.method === "GET" && url.pathname.startsWith("/api/media/asset/")) return await serveAsset(res, url.pathname.slice(17));
      if (!route) throw new HttpError(404, "not_found");
      const out = await route(req, url);
      if (out && out.redirect) {
        res.writeHead(302, { location: out.redirect, "cache-control": "no-store", ...(out.headers || {}) });
        return res.end();
      }
      if (out && out.status && out.body) send(res, out.status, out.body, out.headers);
      else send(res, 200, out);
    } catch (err) {
      if (err instanceof HttpError) return send(res, err.status, err.field ? { error: err.code, field: err.field } : { error: err.code });
      log.error("[api]", err);
      send(res, 500, { error: "server_error" });
    }
  };
}
