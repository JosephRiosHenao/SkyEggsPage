// Búsqueda de cuentas de Roblox: acepta el nombre de usuario (@usuario) o el nombre visible.
// Primero mira los jugadores que el juego ya vio conectados (fuente fiable), luego las APIs públicas de Roblox.

const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;

export function normalizeQuery(raw) {
  if (typeof raw !== "string") return "";
  return raw.normalize("NFKC").replace(/^\s*@/, "").replace(/\s+/g, " ").trim().slice(0, 32);
}

const cache = new Map(); // q → { at, users }
const CACHE_MS = 10 * 60 * 1000;

async function getJson(fetchImpl, url, init, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { ...init, signal: ctrl.signal, headers: { accept: "application/json", ...(init?.headers || {}) } });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Devuelve [{ userId, name, displayName }] desde Roblox (usuario exacto + búsqueda por nombre visible).
async function robloxLookup(q, { fetchImpl, timeoutMs }) {
  const hit = cache.get(q.toLowerCase());
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.users;

  const found = new Map();
  const jobs = [];
  if (USERNAME_RE.test(q)) {
    jobs.push(
      getJson(fetchImpl, "https://users.roblox.com/v1/usernames/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ usernames: [q], excludeBannedUsers: true }),
      }, timeoutMs).then((j) => {
        for (const u of j?.data || []) found.set(u.id, { userId: u.id, name: u.name, displayName: u.displayName });
      }),
    );
  }
  if (q.length >= 3) {
    jobs.push(
      getJson(fetchImpl, `https://users.roblox.com/v1/users/search?keyword=${encodeURIComponent(q)}&limit=10`, {}, timeoutMs).then((j) => {
        for (const u of j?.data || []) if (!found.has(u.id)) found.set(u.id, { userId: u.id, name: u.name, displayName: u.displayName });
      }),
    );
  }
  await Promise.all(jobs);
  const users = [...found.values()].filter((u) => Number.isSafeInteger(u.userId) && u.userId > 0 && typeof u.name === "string");
  cache.set(q.toLowerCase(), { at: Date.now(), users });
  if (cache.size > 2000) cache.delete(cache.keys().next().value);
  return users;
}

export async function avatars(ids, { fetchImpl, timeoutMs }) {
  if (!ids.length) return new Map();
  const j = await getJson(
    fetchImpl,
    `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${ids.join(",")}&size=150x150&format=Png&isCircular=false`,
    {},
    timeoutMs,
  );
  const out = new Map();
  for (const t of j?.data || []) {
    if (t.state === "Completed" && typeof t.imageUrl === "string" && /^https:\/\/[a-z0-9.-]+\.rbxcdn\.com\//.test(t.imageUrl)) out.set(t.targetId, t.imageUrl);
  }
  return out;
}

export async function searchPlayers(db, rawQuery, opts) {
  const q = normalizeQuery(rawQuery);
  if (q.length < 3) return { query: q, players: [] };
  const qlc = q.toLowerCase();
  const now = Date.now();

  // 1) Jugadores que ya entraron al juego: exacto por usuario o nombre visible, luego por prefijo.
  const local = db.prepare(`
    SELECT user_id AS userId, name, display_name AS displayName, played,
      CASE WHEN name_lc = :q THEN 0 WHEN display_lc = :q THEN 1 ELSE 2 END AS rank
    FROM players
    WHERE played = 1 AND (name_lc = :q OR display_lc = :q OR name_lc LIKE :p ESCAPE '\\' OR display_lc LIKE :p ESCAPE '\\')
    ORDER BY rank, last_seen DESC LIMIT 6
  `).all({ q: qlc, p: qlc.replace(/[\\%_]/g, "\\$&") + "%" });

  // Solo jugadores de Sky Eggs (vinculación de creadores): no se consulta Roblox.
  if (opts.onlyPlayed) {
    const pics = await avatars(local.map((u) => u.userId), opts);
    return {
      query: q,
      players: local.map((u) => ({ userId: u.userId, name: u.name, displayName: u.displayName, played: true, exact: u.rank <= 1, avatar: pics.get(u.userId) || null })),
    };
  }

  // 2) Roblox (usuario exacto y búsqueda que también mira el nombre visible).
  const remote = await robloxLookup(q, opts);
  const upsert = db.prepare(`
    INSERT INTO players (user_id, name, display_name, name_lc, display_lc, played, first_seen, last_seen)
    VALUES (?, ?, ?, ?, ?, 0, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET name = excluded.name, display_name = excluded.display_name,
      name_lc = excluded.name_lc, display_lc = excluded.display_lc
  `);
  for (const u of remote) {
    const dn = u.displayName || u.name;
    upsert.run(u.userId, u.name, dn, u.name.toLowerCase(), dn.toLowerCase(), now, now);
  }

  // Unir, quitar repetidos y ordenar: primero quien juega Sky Eggs y coincide exacto.
  const played = new Set(
    db.prepare(`SELECT user_id FROM players WHERE played = 1 AND user_id IN (${[...remote.map((u) => u.userId), 0].join(",")})`)
      .all().map((r) => r.user_id),
  );
  const merged = new Map();
  for (const u of local) merged.set(u.userId, { ...u, played: true });
  for (const u of remote) {
    if (merged.has(u.userId)) continue;
    const dn = u.displayName || u.name;
    const rank = u.name.toLowerCase() === qlc ? 0 : dn.toLowerCase() === qlc ? 1 : 3;
    merged.set(u.userId, { userId: u.userId, name: u.name, displayName: dn, played: played.has(u.userId), rank });
  }
  const list = [...merged.values()]
    .sort((a, b) => (b.played - a.played) || (a.rank - b.rank))
    .slice(0, 6);

  const pics = await avatars(list.map((u) => u.userId), opts);
  return {
    query: q,
    players: list.map((u) => ({
      userId: u.userId,
      name: u.name,
      displayName: u.displayName,
      played: Boolean(u.played),
      exact: u.rank <= 1,
      avatar: pics.get(u.userId) || null,
    })),
  };
}
