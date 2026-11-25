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
  const evCols = () => { try { return cols("evidences"); } catch { return []; } };
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
      status TEXT NOT NULL DEFAULT 'pending',   -- pending | contacted | approved | rejected | removed (salió: puede volver a aplicar)
      created_at INTEGER NOT NULL,
      reviewed_by TEXT, reviewed_at INTEGER, review_note TEXT
    );
    CREATE INDEX IF NOT EXISTS applications_discord ON applications(discord_id, created_at);
    CREATE TABLE IF NOT EXISTS creators (
      discord_id TEXT PRIMARY KEY,
      roblox_user_id INTEGER,
      roblox_name TEXT,
      roblox_display TEXT,
      link_status TEXT NOT NULL DEFAULT 'none',  -- none | pending | approved | rejected | removed (salió del programa)
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
  // Vistas automáticas: track 'auto' (se refresca sola) o 'manual' (vistas fijas del moderador).
  for (const [c, def] of [
    ["track", "TEXT NOT NULL DEFAULT 'manual'"], ["auto_views", "INTEGER"], ["auto_checked_at", "INTEGER"],
    ["auto_error", "TEXT"], ["auto_fails", "INTEGER NOT NULL DEFAULT 0"], ["auto_meta", "TEXT"], ["track_until", "INTEGER"],
  ]) if (!evCols().includes(c)) db.exec(`ALTER TABLE evidences ADD COLUMN ${c} ${def}`);
  if (!cols("applications").includes("roblox_user_id")) db.exec("ALTER TABLE applications ADD COLUMN roblox_user_id INTEGER");
  // Correcciones de un moderador (redes repetidas, un video en vez del canal…).
  for (const [c, def] of [["edited_by", "TEXT"], ["edited_at", "INTEGER"]]) if (!cols("applications").includes(c)) db.exec(`ALTER TABLE applications ADD COLUMN ${c} ${def}`);

  // ---------- Rangos automáticos, avisos al buzón y creadores antiguos ----------
  // players.creator_tier: nivel de creador que el juego reporta en cada pull (0 = ninguno, 1 = Creator … 5 = Elite).
  if (!cols("players").includes("creator_tier")) db.exec("ALTER TABLE players ADD COLUMN creator_tier INTEGER");
  // creators.tier: rango que decide la página (Creator/Active/Viral/Star/Elite o 'None' si se le quitó).
  for (const [c, def] of [
    ["tier", "TEXT"], ["tier_changed_at", "INTEGER"], ["warn_week", "INTEGER"], ["eval_week", "INTEGER"],
    ["public_profile", "INTEGER NOT NULL DEFAULT 1"],
    ["idle_weeks", "INTEGER NOT NULL DEFAULT 0"],   // semanas completas seguidas sin video
  ]) if (!cols("creators").includes(c)) db.exec(`ALTER TABLE creators ADD COLUMN ${c} ${def}`);
  db.exec(`
    CREATE TABLE IF NOT EXISTS notices (
      id INTEGER PRIMARY KEY,
      roblox_user_id INTEGER NOT NULL,
      discord_id TEXT,
      kind TEXT NOT NULL,             -- welcome | promoted | demotion_warning | demoted | legacy_join | legacy_removed | removed | tier_set
      param TEXT,
      reward_id TEXT,                 -- fila de rewards que lo lleva al buzón del juego
      actor TEXT,                     -- quién lo provocó (sistema o moderador)
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS notices_ts ON notices(created_at);
    CREATE INDEX IF NOT EXISTS notices_user ON notices(roblox_user_id, created_at);
    CREATE TABLE IF NOT EXISTS legacy_creators (
      roblox_user_id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      game_tier INTEGER NOT NULL,
      status TEXT NOT NULL,           -- notified | applied | approved | removed
      notified_at INTEGER NOT NULL,
      deadline_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      removed_at INTEGER
    );
  `);
  // ---------- Programa de staff (2026-11-23) ----------
  if (!cols("discord_users").includes("staff_discord")) db.exec("ALTER TABLE discord_users ADD COLUMN staff_discord TEXT");
  if (!cols("players").includes("staff_tier")) db.exec("ALTER TABLE players ADD COLUMN staff_tier INTEGER");
  db.exec(`
    CREATE TABLE IF NOT EXISTS staff (
      discord_id TEXT PRIMARY KEY,
      roblox_user_id INTEGER,
      roblox_name TEXT,
      roblox_display TEXT,
      rank TEXT NOT NULL,             -- Helper | ModeratorJr | Moderator | None (fuera)
      link_status TEXT NOT NULL,      -- pending | approved
      legacy INTEGER NOT NULL DEFAULT 0,   -- ya era staff antes del programa
      joined_at INTEGER NOT NULL,
      rank_changed_at INTEGER,
      strikes INTEGER NOT NULL DEFAULT 0,  -- meses seguidos sin cumplir las tareas
      eval_month TEXT,                -- último mes cerrado
      warn_month TEXT,                -- mes en que se le avisó
      reviewed_by TEXT, reviewed_at INTEGER, note TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS staff_roblox ON staff(roblox_user_id) WHERE link_status = 'approved' AND rank != 'None';
    CREATE TABLE IF NOT EXISTS staff_applications (
      id INTEGER PRIMARY KEY,
      discord_id TEXT NOT NULL,
      roblox_user_id INTEGER NOT NULL,
      roblox_name TEXT NOT NULL,
      answers TEXT NOT NULL,          -- JSON {pregunta: respuesta}
      status TEXT NOT NULL DEFAULT 'pending',  -- pending | contacted | approved | rejected
      created_at INTEGER NOT NULL,
      reviewed_by TEXT, reviewed_at INTEGER, review_note TEXT
    );
    CREATE INDEX IF NOT EXISTS staff_apps_discord ON staff_applications(discord_id, id);
    CREATE TABLE IF NOT EXISTS staff_evidence (
      id INTEGER PRIMARY KEY,
      discord_id TEXT NOT NULL,
      task TEXT NOT NULL,
      month TEXT NOT NULL,            -- AAAA-MM
      amount INTEGER NOT NULL,        -- lo que pide sumar
      approved INTEGER,               -- lo que sumó el moderador
      url TEXT, file TEXT, note TEXT,
      status TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | rejected
      created_at INTEGER NOT NULL,
      reviewed_by TEXT, reviewed_id TEXT, reviewed_at INTEGER, review_note TEXT
    );
    CREATE INDEX IF NOT EXISTS staff_ev_owner ON staff_evidence(discord_id, month, status);
    CREATE TABLE IF NOT EXISTS staff_days (
      day TEXT NOT NULL, user_id INTEGER NOT NULL,
      seconds INTEGER NOT NULL DEFAULT 0, duty_seconds INTEGER NOT NULL DEFAULT 0,
      actions INTEGER NOT NULL DEFAULT 0, sanctions INTEGER NOT NULL DEFAULT 0, helps INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (day, user_id)
    );
    CREATE TABLE IF NOT EXISTS staff_hours (
      hour TEXT NOT NULL, user_id INTEGER NOT NULL, seconds INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (hour, user_id)
    );
    CREATE TABLE IF NOT EXISTS pull_hours (
      hour TEXT NOT NULL, job_id TEXT NOT NULL, players INTEGER NOT NULL,
      PRIMARY KEY (hour, job_id)
    );
    CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY,
      reporter_id INTEGER NOT NULL, reporter_name TEXT NOT NULL,
      target_id INTEGER NOT NULL, target_name TEXT NOT NULL,
      reason TEXT NOT NULL, online INTEGER NOT NULL DEFAULT 0, job_id TEXT,
      status TEXT NOT NULL DEFAULT 'open',   -- open | resolved | dismissed
      created_at INTEGER NOT NULL,
      resolved_by TEXT, resolved_id TEXT, resolved_at INTEGER, note TEXT
    );
    CREATE INDEX IF NOT EXISTS reports_status ON reports(status, created_at);
    CREATE TABLE IF NOT EXISTS staff_promotions (
      id INTEGER PRIMARY KEY,
      discord_id TEXT NOT NULL,
      from_rank TEXT NOT NULL, to_rank TEXT NOT NULL,
      requested_by TEXT NOT NULL, requested_id TEXT NOT NULL, reason TEXT,
      status TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | rejected
      created_at INTEGER NOT NULL,
      reviewed_by TEXT, reviewed_at INTEGER, review_note TEXT
    );
    CREATE TABLE IF NOT EXISTS staff_legacy_game (
      roblox_user_id INTEGER PRIMARY KEY,
      name TEXT NOT NULL, staff_tier INTEGER NOT NULL,
      status TEXT NOT NULL,           -- notified | linked | removed
      notified_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS staff_legacy_discord (
      discord_id TEXT PRIMARY KEY,
      username TEXT, rank TEXT, seen_at INTEGER NOT NULL,
      status TEXT NOT NULL,           -- pending | linked | removed
      removed_at INTEGER
    );
  `);
  // ---------- Staff: ajustes, Discord, excusas y resultados por mes (2026-11-23) ----------
  if (!cols("staff").includes("removal_due_at")) db.exec("ALTER TABLE staff ADD COLUMN removal_due_at INTEGER");
  if (!cols("staff").includes("public_profile")) db.exec("ALTER TABLE staff ADD COLUMN public_profile INTEGER NOT NULL DEFAULT 1");
  if (!cols("staff_days").includes("afk_seconds")) db.exec("ALTER TABLE staff_days ADD COLUMN afk_seconds INTEGER NOT NULL DEFAULT 0");
  db.exec("CREATE TABLE IF NOT EXISTS staff_month_results (discord_id TEXT NOT NULL, month TEXT NOT NULL, percent INTEGER NOT NULL, complete INTEGER NOT NULL, excused INTEGER NOT NULL DEFAULT 0, strike INTEGER NOT NULL DEFAULT 0, evaluated_at INTEGER NOT NULL, PRIMARY KEY (discord_id, month))");
  if (!cols("staff_month_results").includes("performance")) db.exec("ALTER TABLE staff_month_results ADD COLUMN performance INTEGER NOT NULL DEFAULT 0");
  if (!cols("players").includes("job_id")) db.exec("ALTER TABLE players ADD COLUMN job_id TEXT");
  // Cuenta de Roblox de cada usuario del panel (obligatoria desde 2026-11-24). Se rellena con lo que ya se sabía.
  if (!cols("discord_users").includes("roblox_user_id")) {
    db.exec("ALTER TABLE discord_users ADD COLUMN roblox_user_id INTEGER");
    db.exec("ALTER TABLE discord_users ADD COLUMN roblox_linked_at INTEGER");
    const known = db.prepare(`
      SELECT d.id,
        COALESCE(
          (SELECT roblox_user_id FROM creators WHERE discord_id = d.id AND link_status IN ('approved','pending','removed')),
          (SELECT roblox_user_id FROM staff WHERE discord_id = d.id AND roblox_user_id IS NOT NULL),
          (SELECT roblox_user_id FROM applications WHERE discord_id = d.id AND roblox_user_id IS NOT NULL ORDER BY (status = 'approved') DESC, id DESC LIMIT 1)
        ) AS rid
      FROM discord_users d`).all();
    const used = new Set();
    const set = db.prepare("UPDATE discord_users SET roblox_user_id = ?, roblox_linked_at = ? WHERE id = ?");
    for (const k of known) if (k.rid && !used.has(k.rid)) { used.add(k.rid); set.run(k.rid, Date.now(), k.id); }
  }
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS discord_users_roblox ON discord_users(roblox_user_id) WHERE roblox_user_id IS NOT NULL");
  // Bot de Discord (2026-11-24): imágenes del juego, alertas de huevos y anuncios de videos con botones.
  db.exec(`
    CREATE TABLE IF NOT EXISTS game_assets (
      asset_id INTEGER PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL, rarity TEXT,
      file TEXT, source TEXT, fetched_at INTEGER, error TEXT, updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS egg_alerts (
      id INTEGER PRIMARY KEY,
      alert_key TEXT NOT NULL UNIQUE,      -- jobId:contador (lo pone el juego)
      job_id TEXT, place_id INTEGER, studio INTEGER NOT NULL DEFAULT 0,
      asset TEXT NOT NULL, rarity TEXT, size TEXT, weight REAL, value REAL,
      place TEXT, icon_id INTEGER, players INTEGER, max_players INTEGER,
      i18n TEXT,                           -- nombres traducidos que manda el juego { en: {...}, es: {...} }
      created_at INTEGER NOT NULL,
      channel_id TEXT, message_id TEXT, image_url TEXT, post_error TEXT,
      status TEXT NOT NULL DEFAULT 'active', -- active | grabbed | gone
      grabbed_by_id INTEGER, grabbed_by_name TEXT, ended_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS egg_alerts_time ON egg_alerts(created_at);
    CREATE TABLE IF NOT EXISTS egg_going (alert_id INTEGER NOT NULL, discord_id TEXT NOT NULL, PRIMARY KEY (alert_id, discord_id));
    -- Servidores del juego vivos (cada /game/pull): para saber si hay espacio al tocar "Unirse".
    CREATE TABLE IF NOT EXISTS live_servers (job_id TEXT PRIMARY KEY, players INTEGER NOT NULL, last_pull INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS video_likes (evidence_id INTEGER NOT NULL, discord_id TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (evidence_id, discord_id));
  `);
  for (const [c, def] of [["announce_channel", "TEXT"], ["announce_msg", "TEXT"], ["announce_views", "INTEGER"], ["announce_error", "TEXT"]])
    if (!cols("evidences").includes(c)) db.exec(`ALTER TABLE evidences ADD COLUMN ${c} ${def}`);
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_by TEXT, updated_at INTEGER NOT NULL
    );
    -- Ventanas de N minutos con al menos un mensaje del miembro en los canales elegidos.
    CREATE TABLE IF NOT EXISTS staff_discord_windows (
      discord_id TEXT NOT NULL, win INTEGER NOT NULL, day TEXT NOT NULL,
      PRIMARY KEY (discord_id, win)
    );
    CREATE INDEX IF NOT EXISTS sdw_day ON staff_discord_windows(discord_id, day);
    CREATE TABLE IF NOT EXISTS staff_discord_days (
      day TEXT NOT NULL, discord_id TEXT NOT NULL, messages INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (day, discord_id)
    );
    CREATE TABLE IF NOT EXISTS discord_cursors (
      channel_id TEXT PRIMARY KEY, last_id TEXT, name TEXT, updated_at INTEGER NOT NULL, error TEXT
    );
    CREATE TABLE IF NOT EXISTS staff_excuses (
      id INTEGER PRIMARY KEY,
      discord_id TEXT NOT NULL,
      scope TEXT NOT NULL,            -- week | month
      period TEXT NOT NULL,           -- lunes AAAA-MM-DD (semana) o AAAA-MM (mes)
      reason TEXT NOT NULL, url TEXT,
      status TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | rejected
      created_at INTEGER NOT NULL,
      reviewed_by TEXT, reviewed_id TEXT, reviewed_at INTEGER, review_note TEXT
    );
    CREATE INDEX IF NOT EXISTS staff_excuses_owner ON staff_excuses(discord_id, scope, period);
    CREATE TABLE IF NOT EXISTS staff_month_results (
      discord_id TEXT NOT NULL, month TEXT NOT NULL,
      percent INTEGER NOT NULL, complete INTEGER NOT NULL, excused INTEGER NOT NULL DEFAULT 0, strike INTEGER NOT NULL DEFAULT 0,
      evaluated_at INTEGER NOT NULL,
      PRIMARY KEY (discord_id, month)
    );
    -- Bienvenida del programa (modal con videos): se confirma una sola vez por programa (2026-11-24).
    CREATE TABLE IF NOT EXISTS onboarding (
      discord_id TEXT NOT NULL, program TEXT NOT NULL,   -- creator | staff
      acked_at INTEGER NOT NULL,
      PRIMARY KEY (discord_id, program)
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
