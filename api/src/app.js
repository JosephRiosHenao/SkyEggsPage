// Rutas HTTP de la API (sin dependencias externas).
import { createHash } from "node:crypto";
import { doRoll, gamePull, gameAck, gameRedeem, recordVisit, metrics, remainingToday, adminCreateCodes, adminListCodes, adminGift } from "./logic.js";
import { searchPlayers } from "./roblox.js";
import { safeEqual, verifyPassword, createSession, checkSession, deleteSession, readCookie, COOKIE, SESSION_MS } from "./auth.js";

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

  function requireAdmin(req) {
    if (!checkSession(db, readCookie(req.headers.cookie, COOKIE))) throw new HttpError(401, "unauthorized");
  }

  const cookie = (value, maxAgeS) =>
    `${COOKIE}=${value}; Path=/api/admin; HttpOnly; SameSite=Strict; Max-Age=${maxAgeS}${cfg.cookieSecure ? "; Secure" : ""}`;

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
    "GET /api/admin/me": async (req) => { requireAdmin(req); return { ok: true, user: cfg.adminUser }; },
    "GET /api/admin/metrics": async (req, url) => {
      requireAdmin(req);
      return metrics(db, cfg, Number(url.searchParams.get("days")) || 30);
    },
    "GET /api/admin/codes": async (req) => { requireAdmin(req); return { codes: adminListCodes(db) }; },
    "POST /api/admin/codes": async (req) => {
      checkOrigin(req); requireAdmin(req);
      const out = adminCreateCodes(db, await readJson(req, 512));
      if (out.ok) log.info(`[admin] ${out.codes.length} código(s) ${out.tier} generados desde ${ipOf(req)}`);
      return out;
    },
    "POST /api/admin/gift": async (req) => {
      checkOrigin(req); requireAdmin(req);
      const out = adminGift(db, cfg, await readJson(req, 512));
      if (out.ok) log.info(`[admin] regalo ${out.sent}x ${out.tier} a ${out.player.name} (${out.player.userId}) desde ${ipOf(req)}`);
      return out;
    },
  };

  return async function handler(req, res) {
    const url = new URL(req.url, "http://local");
    const route = routes[`${req.method} ${url.pathname}`];
    try {
      if (!route) throw new HttpError(404, "not_found");
      const out = await route(req, url);
      if (out && out.status && out.body) send(res, out.status, out.body, out.headers);
      else send(res, 200, out);
    } catch (err) {
      if (err instanceof HttpError) return send(res, err.status, { error: err.code });
      log.error("[api]", err);
      send(res, 500, { error: "server_error" });
    }
  };
}
