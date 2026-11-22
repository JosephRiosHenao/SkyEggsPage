// Configuración de la API (todo sale de variables de entorno).
const int = (name, def) => {
  const v = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(v) ? v : def;
};

export const config = {
  port: int("PORT", 8080),
  dbPath: process.env.DB_PATH || "/data/skyeggs.db",
  // Secreto compartido con el juego (Roblox Secrets → cabecera X-Game-Key). Mínimo 32 caracteres.
  gameKey: process.env.GAME_KEY || "",
  adminUser: process.env.ADMIN_USER || "admin",
  // Formato scrypt:<salt hex>:<hash hex>; se genera con `node src/hash-password.js`.
  adminPasswordHash: process.env.ADMIN_PASSWORD_HASH || "",
  cookieSecure: process.env.COOKIE_SECURE !== "false",
  // Máximo de premios que una cuenta puede cobrar por día (hora de Colombia).
  maxPerDay: {
    mythic: int("MAX_MYTHIC_PER_DAY", 5),
    legendary: int("MAX_LEGENDARY_PER_DAY", 5),
  },
  // Nivel mínimo en el juego para recibir los premios (0 = sin mínimo). Mientras no lo tenga, quedan guardados.
  minLevel: int("MIN_LEVEL", 10),
  codeTtlHours: int("CODE_TTL_HOURS", 72),
  // Desfase horario para el "día" de los límites, en minutos (Colombia = -300, sin horario de verano).
  tzOffsetMin: int("TZ_OFFSET_MIN", -300),
  // Tiradas por minuto por IP.
  rollsPerMinute: int("ROLLS_PER_MINUTE", 40),
  // Cabecera con la IP real del visitante (Traefik pone X-Real-Ip).
  ipHeader: (process.env.IP_HEADER || "x-real-ip").toLowerCase(),
  robloxTimeoutMs: int("ROBLOX_TIMEOUT_MS", 4000),
  siteUrl: (process.env.SITE_URL || `https://${process.env.DOMAIN || "skyeggs.pro"}`).replace(/\/$/, ""),
  uploadsDir: process.env.UPLOADS_DIR || "/data/uploads",
  // Login con Discord y roles del servidor de Discord del juego.
  discord: {
    clientId: process.env.DISCORD_CLIENT_ID || "",
    clientSecret: process.env.DISCORD_CLIENT_SECRET || "",
    guildId: process.env.DISCORD_GUILD_ID || "",
    redirectUri: process.env.DISCORD_REDIRECT_URI || "",
    webhookUrl: process.env.DISCORD_WEBHOOK_URL || "",
    roles: {
      admin: process.env.DISCORD_ROLE_ADMIN || "1560889139375898775",
      moderator: process.env.DISCORD_ROLE_MODERATOR || "1563742282392543312",
      creator: process.env.DISCORD_ROLE_CREATOR || "1561051688125730897",
    },
  },
  // Lectura automática de vistas (yt-dlp). Respaldo opcional para YouTube: YOUTUBE_API_KEY.
  views: {
    enabled: process.env.VIEWS_AUTO !== "false",
    ytdlpPath: process.env.YTDLP_PATH || "/opt/ytdlp/bin/yt-dlp",
    pipPath: process.env.YTDLP_PIP || "/opt/ytdlp/bin/pip",
    youtubeApiKey: process.env.YOUTUBE_API_KEY || "",
    refreshHours: int("VIEWS_REFRESH_HOURS", 6),
    maxFails: int("VIEWS_MAX_FAILS", 4),
    timeoutMs: int("VIEWS_TIMEOUT_MS", 45_000),
  },
  creators: {
    // Días después de cerrar la semana / el mes para reclamar su pack.
    claimGraceDaysWeek: int("CLAIM_GRACE_DAYS_WEEK", 3),
    claimGraceDaysMonth: int("CLAIM_GRACE_DAYS_MONTH", 5),
  },
};
if (!config.discord.redirectUri) config.discord.redirectUri = `${config.siteUrl}/api/auth/discord/callback`;

// Probabilidades en millonésimas (suman 1.000.000). Iguales a las de la página.
export const TIERS = [
  { key: "common", weight: 800_000 },
  { key: "uncommon", weight: 150_000 },
  { key: "rare", weight: 40_000 },
  { key: "epic", weight: 7_500 },
  { key: "legendary", weight: 2_000 },
  { key: "mythic", weight: 500 },
];
export const PRIZE_TIERS = new Set(["legendary", "mythic"]);

export function validateConfig() {
  const problems = [];
  if (config.gameKey.length < 32) problems.push("GAME_KEY falta o tiene menos de 32 caracteres");
  if (!/^scrypt:[0-9a-f]{32}:[0-9a-f]{128}$/.test(config.adminPasswordHash))
    problems.push("ADMIN_PASSWORD_HASH falta o no tiene el formato de `node src/hash-password.js`");
  const total = TIERS.reduce((s, t) => s + t.weight, 0);
  if (total !== 1_000_000) problems.push(`Las probabilidades suman ${total}, deben sumar 1000000`);
  return problems;
}
