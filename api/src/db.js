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
