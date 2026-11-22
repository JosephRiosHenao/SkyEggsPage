// Base de datos SQLite (archivo en el volumen /data).
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export function openDb(path) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 3000;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS rolls (
      id INTEGER PRIMARY KEY,
      ts INTEGER NOT NULL,
      day TEXT NOT NULL,
      tier TEXT NOT NULL,
      mode TEXT NOT NULL,            -- user | code
      user_id INTEGER,
      visitor TEXT,
      outcome TEXT NOT NULL          -- none | reward | code | capped
    );
    CREATE INDEX IF NOT EXISTS rolls_day ON rolls(day, tier);

    CREATE TABLE IF NOT EXISTS rewards (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      tier TEXT NOT NULL,
      source TEXT NOT NULL,          -- user | code
      day TEXT NOT NULL,             -- día que cuenta para el límite
      created_at INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',  -- pending | delivered
      delivered_at INTEGER,
      code TEXT
    );
    CREATE INDEX IF NOT EXISTS rewards_user_day ON rewards(user_id, day, tier);
    CREATE INDEX IF NOT EXISTS rewards_pending ON rewards(status, user_id);

    CREATE TABLE IF NOT EXISTS codes (
      code TEXT PRIMARY KEY,
      tier TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      visitor TEXT,
      redeemed_by INTEGER,
      redeemed_at INTEGER,
      reward_id TEXT
    );

    CREATE TABLE IF NOT EXISTS players (
      user_id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      display_name TEXT NOT NULL,
      name_lc TEXT NOT NULL,
      display_lc TEXT NOT NULL,
      played INTEGER NOT NULL DEFAULT 0,   -- 1 si el juego lo ha visto conectado
      level INTEGER,
      first_seen INTEGER NOT NULL,
      last_seen INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS players_name ON players(name_lc);
    CREATE INDEX IF NOT EXISTS players_display ON players(display_lc);

    CREATE TABLE IF NOT EXISTS visits (
      day TEXT NOT NULL, visitor TEXT NOT NULL, hits INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (day, visitor)
    );
    CREATE TABLE IF NOT EXISTS server_days (
      day TEXT NOT NULL, job_id TEXT NOT NULL, pulls INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (day, job_id)
    );
    CREATE TABLE IF NOT EXISTS player_days (
      day TEXT NOT NULL, user_id INTEGER NOT NULL,
      PRIMARY KEY (day, user_id)
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
    );
  `);
  // Migraciones simples (columnas nuevas en bases ya creadas).
  const cols = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
  if (!cols("codes").includes("origin")) db.exec("ALTER TABLE codes ADD COLUMN origin TEXT NOT NULL DEFAULT 'web'");
  // Sesiones de Discord además de la del admin por contraseña.
  if (!cols("sessions").includes("kind")) db.exec("ALTER TABLE sessions ADD COLUMN kind TEXT NOT NULL DEFAULT 'admin'");
  if (!cols("sessions").includes("discord_id")) db.exec("ALTER TABLE sessions ADD COLUMN discord_id TEXT");
  // Premios de creador: kind 'creator' (pack) o 'tier' (registrar nivel en el juego).
  for (const [c, def] of [["kind", "TEXT NOT NULL DEFAULT 'pet'"], ["pack", "TEXT"], ["period", "TEXT"]]) {
    if (!cols("rewards").includes(c)) db.exec(`ALTER TABLE rewards ADD COLUMN ${c} ${def}`);
  }

  // ---------- Programa de creadores ----------
  db.exec(`
    CREATE TABLE IF NOT EXISTS discord_users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      global_name TEXT,
      avatar TEXT,
      in_guild INTEGER NOT NULL DEFAULT 0,
      is_admin INTEGER NOT NULL DEFAULT 0,
      is_mod INTEGER NOT NULL DEFAULT 0,
      is_creator INTEGER NOT NULL DEFAULT 0,
      first_login INTEGER NOT NULL,
      last_login INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS oauth_states (
      state TEXT PRIMARY KEY, next TEXT NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS applications (
      id INTEGER PRIMARY KEY,
      discord_id TEXT NOT NULL,
      roblox_name TEXT NOT NULL,
      email TEXT,
      platforms TEXT NOT NULL,        -- JSON [{type,url,followers}]
      about TEXT NOT NULL,
      sample_url TEXT,
      status TEXT NOT NULL DEFAULT 'pending',   -- pending | contacted | approved | rejected
      created_at INTEGER NOT NULL,
      reviewed_by TEXT, reviewed_at INTEGER, review_note TEXT
    );
    CREATE INDEX IF NOT EXISTS applications_discord ON applications(discord_id, created_at);
    CREATE TABLE IF NOT EXISTS creators (
      discord_id TEXT PRIMARY KEY,
      roblox_user_id INTEGER,
      roblox_name TEXT,
      roblox_display TEXT,
      link_status TEXT NOT NULL DEFAULT 'none',  -- none | pending | approved | rejected
      link_code TEXT,
      link_requested_at INTEGER,
      link_reviewed_by TEXT, link_reviewed_at INTEGER, link_note TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS creators_roblox ON creators(roblox_user_id) WHERE link_status = 'approved';
    CREATE TABLE IF NOT EXISTS evidences (
      id INTEGER PRIMARY KEY,
      discord_id TEXT NOT NULL,
      kind TEXT NOT NULL,             -- video | live
      platform TEXT NOT NULL,
      url TEXT NOT NULL,
      title TEXT,
      published_on TEXT NOT NULL,     -- AAAA-MM-DD (hora de Colombia)
      week INTEGER NOT NULL,
      month TEXT NOT NULL,            -- AAAA-MM
      file TEXT,
      note TEXT,
      status TEXT NOT NULL DEFAULT 'pending',   -- pending | approved | rejected
      views INTEGER NOT NULL DEFAULT 0,
      recount INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      reviewed_by TEXT, reviewed_at INTEGER, review_note TEXT
    );
    CREATE INDEX IF NOT EXISTS evidences_owner ON evidences(discord_id, status, week, month);
    CREATE UNIQUE INDEX IF NOT EXISTS evidences_url ON evidences(url) WHERE status != 'rejected';
    CREATE TABLE IF NOT EXISTS claims (
      id INTEGER PRIMARY KEY,
      discord_id TEXT NOT NULL,
      period_type TEXT NOT NULL,      -- week | month
      period_key TEXT NOT NULL,       -- 2968 | 2026-11
      pack TEXT NOT NULL,
      views INTEGER NOT NULL,
      videos INTEGER NOT NULL,
      reward_id TEXT,
      created_at INTEGER NOT NULL,
      UNIQUE (discord_id, period_type, period_key)
    );
    CREATE TABLE IF NOT EXISTS bonuses (
      id INTEGER PRIMARY KEY,
      evidence_id INTEGER NOT NULL UNIQUE,
      discord_id TEXT NOT NULL,
      views INTEGER NOT NULL,
      robux INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending_mod',  -- pending_mod | pending_admin | approved | paid | rejected
      created_at INTEGER NOT NULL,
      mod_by TEXT, mod_id TEXT, mod_at INTEGER,
      admin_by TEXT, admin_at INTEGER,
      paid_by TEXT, paid_at INTEGER,
      note TEXT
    );
    CREATE TABLE IF NOT EXISTS specials (
      id INTEGER PRIMARY KEY,
      discord_id TEXT NOT NULL,
      month TEXT NOT NULL,
      views INTEGER NOT NULL,
      request TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | rejected | done
      created_at INTEGER NOT NULL,
      reviewed_by TEXT, reviewed_at INTEGER, review_note TEXT,
      UNIQUE (discord_id, month)
    );
    CREATE TABLE IF NOT EXISTS audit (
      id INTEGER PRIMARY KEY,
      ts INTEGER NOT NULL,
      actor_id TEXT NOT NULL,
      actor_name TEXT NOT NULL,
      actor_role TEXT NOT NULL,
      action TEXT NOT NULL,
      target TEXT,
      details TEXT
    );
    CREATE INDEX IF NOT EXISTS audit_ts ON audit(ts);
  `);
  return db;
}

// Ejecuta fn dentro de una transacción (todo o nada).
export function tx(db, fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
