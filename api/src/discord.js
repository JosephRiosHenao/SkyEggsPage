// Login con Discord (OAuth2) y lectura de roles del servidor de Discord del juego.
// Scopes: identify (quién eres) + guilds.members.read (tus roles en nuestro servidor). Sin bot.

const API = "https://discord.com/api/v10";

export function discordEnabled(cfg) {
  const d = cfg.discord;
  return Boolean(d.clientId && d.clientSecret && d.guildId);
}

export function authorizeUrl(cfg, state) {
  const p = new URLSearchParams({
    client_id: cfg.discord.clientId,
    response_type: "code",
    redirect_uri: cfg.discord.redirectUri,
    scope: "identify guilds.members.read",
    state,
    prompt: "none",
  });
  return `https://discord.com/oauth2/authorize?${p}`;
}

async function call(fetchImpl, url, init, timeoutMs = 6000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { ...init, signal: ctrl.signal });
    const body = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, body };
  } finally {
    clearTimeout(t);
  }
}

// Cambia el code por un token y devuelve { user, member } (member = null si no está en el servidor).
export async function fetchDiscordIdentity(cfg, code, fetchImpl = fetch) {
  const tok = await call(fetchImpl, `${API}/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: cfg.discord.clientId,
      client_secret: cfg.discord.clientSecret,
      grant_type: "authorization_code",
      code,
      redirect_uri: cfg.discord.redirectUri,
    }),
  });
  if (!tok.ok || !tok.body?.access_token) throw new Error(`discord_token_${tok.status}`);
  const auth = { authorization: `Bearer ${tok.body.access_token}` };
  const me = await call(fetchImpl, `${API}/users/@me`, { headers: auth });
  if (!me.ok || !me.body?.id) throw new Error(`discord_user_${me.status}`);
  const mem = await call(fetchImpl, `${API}/users/@me/guilds/${cfg.discord.guildId}/member`, { headers: auth });
  return { user: me.body, member: mem.ok ? mem.body : null };
}

export function rolesFrom(cfg, member) {
  const ids = new Set(Array.isArray(member?.roles) ? member.roles : []);
  const r = cfg.discord.roles;
  const admin = ids.has(r.admin);
  const st = cfg.discord.staffRoles || {};
  return {
    inGuild: Boolean(member),
    admin,
    moderator: admin || ids.has(r.moderator),
    creator: ids.has(r.creator),
    // Rango de staff según Discord (el que manda es el de la página una vez vinculado).
    staffDiscord: ids.has(st.Moderator) ? "Moderator" : ids.has(st.ModeratorJr) ? "ModeratorJr" : ids.has(st.Helper) ? "Helper" : null,
  };
}

export function avatarUrl(user) {
  if (user?.avatar && /^[a-f0-9_]+$/i.test(user.avatar)) return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`;
  return null;
}

// Aviso opcional a un canal de moderación (webhook). Nunca bloquea ni falla la petición.
export function notifyMods(cfg, text, fetchImpl = fetch) {
  const url = cfg.discord.webhookUrl;
  if (!url || !/^https:\/\/(discord|discordapp)\.com\/api\/webhooks\//.test(url)) return;
  fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content: String(text).slice(0, 1900), allowed_mentions: { parse: [] } }),
  }).catch(() => {});
}

// ---------- Roles automáticos con el bot de la app ----------
// Sin librerías: la API REST de Discord basta para poner y quitar roles.
//   PUT    /guilds/{guild}/members/{user}/roles/{role}
//   DELETE /guilds/{guild}/members/{user}/roles/{role}
// Requisitos: el bot está en el servidor con el permiso "Gestionar roles" y su rol está
// POR ENCIMA de los roles de creador en la lista de roles del servidor (si no, Discord responde 403).
export function botEnabled(cfg) {
  return Boolean(cfg.discord.botToken && cfg.discord.guildId);
}

// Roles de Discord que corresponden a un rango (null = sin rango: se quitan todos).
// Roles de Discord de un rango de staff (pone el suyo y quita los otros dos).
export function rolesForStaff(cfg, rank) {
  const all = cfg.discord.staffRoles || {};
  const add = [];
  const remove = [];
  for (const [key, role] of Object.entries(all)) {
    if (!role) continue;
    if (key === rank) add.push(role); else remove.push(role);
  }
  return { add, remove };
}

export function rolesForTier(cfg, tierKey) {
  const base = cfg.discord.roles.creator;
  const levels = cfg.discord.levelRoles || {};
  const add = [];
  const remove = [];
  if (tierKey && tierKey !== "None") add.push(base); else remove.push(base);
  for (const [key, role] of Object.entries(levels)) {
    if (!role || role === base) continue;
    if (key === tierKey) add.push(role); else remove.push(role);
  }
  return { add, remove };
}

// Códigos de error de Discord → explicación en español (para el Registro y el diagnóstico).
const DISCORD_CODES = {
  0: "token del bot inválido (401): copia de nuevo el token en DISCORD_BOT_TOKEN",
  10004: "el bot NO está en el servidor (Unknown Guild): invítalo con la URL de OAuth2 → bot + Manage Roles, o revisa DISCORD_GUILD_ID",
  10007: "ese usuario ya no está en el servidor de Discord (Unknown Member)",
  10011: "ese rol no existe en el servidor (Unknown Role): revisa el ID del rol",
  10013: "usuario desconocido",
  50001: "el bot no tiene acceso (Missing Access)",
  50013: "faltan permisos: el bot necesita Manage Roles y su rol debe estar POR ENCIMA del rol que pone (Missing Permissions)",
};
export function explainDiscordError(status, body) {
  const code = body?.code;
  if (status === 401) return DISCORD_CODES[0];
  if (code != null && DISCORD_CODES[code]) return `${DISCORD_CODES[code]} [${status}/${code}]`;
  return `${status}${code != null ? `/${code}` : ""}${body?.message ? ` ${String(body.message).slice(0, 80)}` : ""}`;
}

// Aplica los cambios. Devuelve { ok, done: [...], errors: [...] }. Nunca lanza.
export async function setMemberRoles(cfg, discordId, { add = [], remove = [] }, reason = "Programa de creadores", fetchImpl = fetch) {
  if (!botEnabled(cfg)) return { ok: false, skipped: true, done: [], errors: ["bot_off"] };
  if (!/^\d{5,25}$/.test(String(discordId))) return { ok: false, done: [], errors: ["bad_user"] };
  const done = [];
  const errors = [];
  const headers = {
    authorization: `Bot ${cfg.discord.botToken}`,
    "x-audit-log-reason": encodeURIComponent(String(reason).slice(0, 200)),
  };
  const run = async (method, role) => {
    if (!/^\d{5,25}$/.test(String(role))) return;
    const url = `${API}/guilds/${cfg.discord.guildId}/members/${discordId}/roles/${role}`;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await call(fetchImpl, url, { method, headers });
        if (r.ok || r.status === 204) { done.push(`${method === "PUT" ? "+" : "-"}${role}`); return; }
        if (r.status === 429 && attempt === 0) {
          await new Promise((res) => setTimeout(res, Math.min(5000, Math.ceil((r.body?.retry_after || 1) * 1000))));
          continue;
        }
        // Quitar un rol a quien ya salió del servidor no es un error real.
        if (method === "DELETE" && r.body?.code === 10007) { done.push(`-${role} (no está en el servidor)`); return; }
        errors.push(`${method} ${role}: ${explainDiscordError(r.status, r.body)}`);
        return;
      } catch (e) { errors.push(`${method} ${role}: ${e.message}`); return; }
    }
  };
  for (const role of add) await run("PUT", role);
  for (const role of remove) await run("DELETE", role);
  return { ok: errors.length === 0, done, errors };
}

// ---------- Diagnóstico del bot ----------
// Revisa paso a paso lo que hace falta para poner roles y dice qué está mal.
// roles = { nombre: id }. userId (opcional) = comprobar además a ese usuario.
const MANAGE_ROLES = 1n << 28n;
const ADMINISTRATOR = 1n << 3n;
export async function diagnoseBot(cfg, roles, userId = null, fetchImpl = fetch) {
  const checks = [];
  const add = (ok, label, detail = "") => { checks.push({ ok, label, detail }); return ok; };
  if (!add(Boolean(cfg.discord.botToken), "Token del bot (DISCORD_BOT_TOKEN)", cfg.discord.botToken ? "puesto" : "vacío: Discord Developer Portal → tu app → Bot → Reset Token")) return { ok: false, checks };
  if (!add(Boolean(cfg.discord.guildId), "ID del servidor (DISCORD_GUILD_ID)", cfg.discord.guildId || "vacío")) return { ok: false, checks };
  const auth = { authorization: `Bot ${cfg.discord.botToken}` };
  const get = (path) => call(fetchImpl, `${API}${path}`, { headers: auth }).catch((e) => ({ ok: false, status: 0, body: { message: e.message } }));
  const me = await get("/users/@me");
  if (!add(me.ok, "El token es válido", me.ok ? `bot @${me.body.username} (${me.body.id})` : explainDiscordError(me.status, me.body))) return { ok: false, checks };
  const guild = await get(`/guilds/${cfg.discord.guildId}`);
  if (!add(guild.ok, "El bot está dentro del servidor", guild.ok ? guild.body.name : explainDiscordError(guild.status, guild.body))) return { ok: false, checks };
  const [rolesRes, member] = await Promise.all([get(`/guilds/${cfg.discord.guildId}/roles`), get(`/guilds/${cfg.discord.guildId}/members/${me.body.id}`)]);
  if (!add(rolesRes.ok && member.ok, "Leer roles del servidor", rolesRes.ok && member.ok ? "" : explainDiscordError(rolesRes.status || member.status, rolesRes.body || member.body))) return { ok: false, checks };
  const byId = new Map(rolesRes.body.map((r) => [r.id, r]));
  const mine = (member.body.roles || []).map((id) => byId.get(id)).filter(Boolean);
  const everyone = byId.get(cfg.discord.guildId);
  const perms = [everyone, ...mine].reduce((acc, r) => acc | BigInt(r?.permissions || 0), 0n);
  const top = Math.max(0, ...mine.map((r) => r.position));
  const topName = mine.find((r) => r.position === top)?.name || "(sin rol)";
  add(Boolean(perms & (MANAGE_ROLES | ADMINISTRATOR)), "Permiso Manage Roles", perms & ADMINISTRATOR ? "tiene Administrador" : perms & MANAGE_ROLES ? "sí" : "NO: dale al rol del bot el permiso «Gestionar roles»");
  for (const [name, id] of Object.entries(roles)) {
    if (!id) continue;
    const r = byId.get(String(id));
    if (!add(Boolean(r), `Rol ${name} existe`, r ? `${r.name} (${id})` : `no existe ningún rol con ID ${id} en este servidor`)) continue;
    add(top > r.position, `El rol del bot está por encima de ${name}`, top > r.position ? `${topName} (pos. ${top}) > ${r.name} (pos. ${r.position})` : `NO: arrastra «${topName}» por encima de «${r.name}» en Ajustes del servidor → Roles`);
  }
  if (userId) {
    const u = await get(`/guilds/${cfg.discord.guildId}/members/${userId}`);
    add(u.ok, `El usuario ${userId} está en el servidor`, u.ok ? `@${u.body.user?.username}` : explainDiscordError(u.status, u.body));
  }
  return { ok: checks.every((c) => c.ok), checks };
}

// Todos los miembros del servidor con alguno de esos roles (para sincronizar staff antiguo).
// Requiere activar "Server Members Intent" en Bot (Developer Portal). Devuelve null si no se puede.
export async function listMembersWithRoles(cfg, roleIds, fetchImpl = fetch, maxPages = 20) {
  if (!botEnabled(cfg)) return null;
  const want = new Set(roleIds.filter(Boolean).map(String));
  const out = [];
  let after = "0";
  for (let page = 0; page < maxPages; page++) {
    const r = await call(fetchImpl, `${API}/guilds/${cfg.discord.guildId}/members?limit=1000&after=${after}`, { headers: { authorization: `Bot ${cfg.discord.botToken}` } }, 10_000).catch(() => null);
    if (!r?.ok || !Array.isArray(r.body)) return page === 0 ? null : out;
    for (const m of r.body) {
      const roles = (m.roles || []).filter((x) => want.has(String(x)));
      if (roles.length && m.user && !m.user.bot) out.push({ id: m.user.id, username: m.user.username, globalName: m.user.global_name || null, avatar: m.user.avatar || null, roles });
    }
    if (r.body.length < 1000) break;
    after = r.body[r.body.length - 1].user.id;
  }
  return out;
}
