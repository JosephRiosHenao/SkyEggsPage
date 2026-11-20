// Login del panel: contraseña con scrypt, sesión aleatoria guardada como hash, cookie HttpOnly.
import { scryptSync, randomBytes, timingSafeEqual, createHash } from "node:crypto";

export function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt:${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function verifyPassword(password, stored) {
  const m = /^scrypt:([0-9a-f]{32}):([0-9a-f]{128})$/.exec(stored || "");
  if (!m || typeof password !== "string" || password.length > 256) return false;
  const hash = scryptSync(password, Buffer.from(m[1], "hex"), 64, { N: 16384, r: 8, p: 1 });
  return timingSafeEqual(hash, Buffer.from(m[2], "hex"));
}

export function safeEqual(a, b) {
  const ha = createHash("sha256").update(String(a)).digest();
  const hb = createHash("sha256").update(String(b)).digest();
  return timingSafeEqual(ha, hb);
}

const sha = (s) => createHash("sha256").update(s).digest("hex");
export const SESSION_MS = 12 * 3_600_000;
export const COOKIE = "se_admin";

export function createSession(db, now = Date.now()) {
  const token = randomBytes(32).toString("base64url");
  db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now);
  db.prepare("INSERT INTO sessions (token_hash, created_at, expires_at) VALUES (?, ?, ?)").run(sha(token), now, now + SESSION_MS);
  return token;
}

export function checkSession(db, token, now = Date.now()) {
  if (!token || token.length > 100) return false;
  const row = db.prepare("SELECT expires_at FROM sessions WHERE token_hash = ?").get(sha(token));
  return Boolean(row && row.expires_at > now);
}

export function deleteSession(db, token) {
  if (token) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha(token));
}

export function readCookie(header, name) {
  for (const part of (header || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}
