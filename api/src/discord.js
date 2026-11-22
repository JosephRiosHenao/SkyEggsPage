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
  return {
    inGuild: Boolean(member),
    admin,
    moderator: admin || ids.has(r.moderator),
    creator: ids.has(r.creator),
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
