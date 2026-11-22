// Rutas HTTP de la API (sin dependencias externas).
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { doRoll, gamePull, gameAck, gameRedeem, recordVisit, metrics, remainingToday, adminCreateCodes, adminListCodes, adminGift } from "./logic.js";
import { searchPlayers } from "./roblox.js";
import { safeEqual, verifyPassword, createSession, checkSession, getSession, deleteSession, readCookie, COOKIE, SESSION_MS, USER_COOKIE, USER_SESSION_MS } from "./auth.js";
import { discordEnabled, authorizeUrl, fetchDiscordIdentity, rolesFrom, notifyMods } from "./discord.js";
import { publicProgram } from "./program.js";
import * as C from "./creators.js";

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

class HttpError extends Error { constructor(status, code) { super(code); this.status = status; this.code = code; } }

export function createApp({ db, cfg, fetchImpl = fetch, log = console }) {
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
    return s ? C.getDiscordUser(db, s.discord_id) : null;
  }
  function requireUser(req) {
    const u = currentUser(req);
    if (!u) throw new HttpError(401, "login_required");
    return u;
  }
  const passwordAdmin = (req) => checkSession(db, readCookie(req.headers.cookie, COOKIE));
  // Quién hace una acción de staff (queda en el registro con su nombre).
  function staffActor(req, adminOnly = false) {
    if (passwordAdmin(req)) return { id: `local:${cfg.adminUser}`, name: `${cfg.adminUser} (panel)`, role: "admin" };
    const u = currentUser(req);
    if (u && u.roles.admin) return { id: u.id, name: u.globalName ? `${u.globalName} (@${u.username})` : `@${u.username}`, role: "admin" };
    if (!adminOnly && u && u.roles.moderator) return { id: u.id, name: u.globalName ? `${u.globalName} (@${u.username})` : `@${u.username}`, role: "moderator" };
    throw new HttpError(u ? 403 : 401, u ? "forbidden" : "unauthorized");
  }
  function requireAdmin(req) { return staffActor(req, true); }
  function requireCreator(req) {
    const u = requireUser(req);
    if (!u.roles.creator && !u.roles.admin) throw new HttpError(403, "creator_only");
    if (!limits.creator.take(u.id)) throw new HttpError(429, "slow_down");
    return u;
  }
  // Errores de reglas del programa → 400/403/404 con su código.
  const run = (fn) => { try { return fn(); } catch (e) { if (e instanceof C.Fail) throw new HttpError(e.status, e.code); throw e; } };

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
      return searchPlayers(db, url.searchParams.get("q") || "", { fetchImpl, timeoutMs: cfg.robloxTimeoutMs });
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
    "POST /api/game/redeem": async (req) => {
      requireGame(req);
      const body = await readJson(req, 2048);
      if (!limits.redeem.take(`u${Number(body.userId) || 0}`)) return { ok: false, error: "slow_down" };
      return gameRedeem(db, cfg, body);
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
      return { user: u, discord: true, application: C.myApplication(db, u.id) };
    },

    // ----- Programa de creadores -----
    "GET /api/creators/program": async () => publicProgram(cfg),
    "POST /api/creators/apply": async (req) => {
      checkOrigin(req);
      const u = requireUser(req);
      if (!limits.apply.take(u.id)) throw new HttpError(429, "slow_down");
      const body = await readJson(req, 8192);
      const out = run(() => C.submitApplication(db, u.id, body));
      notifyMods(cfg, `📝 Nueva solicitud al programa de creadores de @${u.username}: ${cfg.siteUrl}/creadores/panel/#moderacion`, fetchImpl);
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
      notifyMods(cfg, `🔗 @${u.username} pidió vincular la cuenta de Roblox @${out.roblox.name}.`, fetchImpl);
      return out;
    },
    "POST /api/creators/upload": async (req) => {
      checkOrigin(req);
      const u = requireCreator(req);
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
      notifyMods(cfg, `📹 Nueva evidencia de @${u.username} para revisar en ${cfg.siteUrl}/creadores/panel/#moderacion`, fetchImpl);
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
      notifyMods(cfg, `💰 @${u.username} pidió un bono de ${out.robux} Robux por un video.`, fetchImpl);
      return out;
    },
    "POST /api/creators/special": async (req) => {
      checkOrigin(req);
      const u = requireCreator(req);
      const body = await readJson(req, 2048);
      const out = run(() => C.requestSpecial(db, cfg, u.id, body));
      notifyMods(cfg, `👑 @${u.username} pasó las 100.000 vistas del mes y envió un pedido especial al admin.`, fetchImpl);
      return out;
    },

    // ----- Moderación (moderadores y admin) -----
    "GET /api/mod/queue": async (req) => { const a = staffActor(req); return { actor: a, ...C.modQueue(db, a) }; },
    "GET /api/mod/applications": async (req, url) => { staffActor(req); return { applications: C.modApplications(db, url.searchParams.get("status") || "all") }; },
    "GET /api/mod/creators": async (req) => { staffActor(req); return { creators: C.creatorsOverview(db) }; },
    "GET /api/mod/audit": async (req, url) => { staffActor(req); return { audit: C.auditList(db, Number(url.searchParams.get("limit")) || 150) }; },
    "POST /api/mod/application": async (req) => { checkOrigin(req); const a = staffActor(req); const b = await readJson(req, 2048); return run(() => C.reviewApplication(db, a, b)); },
    "POST /api/mod/link": async (req) => { checkOrigin(req); const a = staffActor(req); const b = await readJson(req, 2048); return run(() => C.reviewLink(db, a, b)); },
    "POST /api/mod/evidence": async (req) => { checkOrigin(req); const a = staffActor(req); const b = await readJson(req, 2048); return run(() => C.reviewEvidence(db, a, b)); },
    "POST /api/mod/bonus": async (req) => { checkOrigin(req); const a = staffActor(req); const b = await readJson(req, 2048); return run(() => C.reviewBonus(db, a, b)); },
    "POST /api/mod/special": async (req) => { checkOrigin(req); const a = staffActor(req, true); const b = await readJson(req, 2048); return run(() => C.reviewSpecial(db, a, b)); },
  };

  // Archivos de evidencias: solo los ve su dueño o el staff.
  function serveFile(req, res, name) {
    if (!/^[a-f0-9]{32}\.(png|jpg|webp)$/.test(name)) throw new HttpError(404, "not_found");
    let allowed = false;
    try { staffActor(req); allowed = true; } catch {
      const u = currentUser(req);
      allowed = Boolean(u && db.prepare("SELECT 1 FROM evidences WHERE file = ? AND discord_id = ?").get(name, u.id));
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

  return async function handler(req, res) {
    const url = new URL(req.url, "http://local");
    const route = routes[`${req.method} ${url.pathname}`];
    try {
      if (req.method === "GET" && url.pathname.startsWith("/api/files/")) return serveFile(req, res, url.pathname.slice(11));
      if (!route) throw new HttpError(404, "not_found");
      const out = await route(req, url);
      if (out && out.redirect) {
        res.writeHead(302, { location: out.redirect, "cache-control": "no-store", ...(out.headers || {}) });
        return res.end();
      }
      if (out && out.status && out.body) send(res, out.status, out.body, out.headers);
      else send(res, 200, out);
    } catch (err) {
      if (err instanceof HttpError) return send(res, err.status, { error: err.code });
      log.error("[api]", err);
      send(res, 500, { error: "server_error" });
    }
  };
}
