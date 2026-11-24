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
    // Opcional: token del bot de la app de Discord (Bot → Reset Token). Con él la página pone y quita
    // los roles de creador sola. Sin él, los moderadores siguen dándolos a mano.
    botToken: process.env.DISCORD_BOT_TOKEN || "",
    // Roles de cada rango (opcionales). El rango base usa DISCORD_ROLE_CREATOR.
    levelRoles: {
      Active: process.env.DISCORD_ROLE_CREATOR_ACTIVE || "",
      Viral: process.env.DISCORD_ROLE_CREATOR_VIRAL || "",
      Star: process.env.DISCORD_ROLE_CREATOR_STAR || "",
      Elite: process.env.DISCORD_ROLE_CREATOR_ELITE || "",
    },
    roles: {
      admin: process.env.DISCORD_ROLE_ADMIN || "1560889139375898775",
      moderator: process.env.DISCORD_ROLE_MODERATOR || "1563742282392543312",
      creator: process.env.DISCORD_ROLE_CREATOR || "1561051688125730897",
    },
    // Programa de staff (2026-11-23): roles de Discord de cada rango.
    // Canal de anuncios del staff (el bot escribe y menciona al rango que corresponde).
    announceChannel: process.env.DISCORD_ANNOUNCE_CHANNEL || "1566631711910133860",
    staffRoles: {
      Helper: process.env.DISCORD_ROLE_HELPER || "1563735797444771961",
      ModeratorJr: process.env.DISCORD_ROLE_MODERATORJR || "1563736116300087337",
      Moderator: process.env.DISCORD_ROLE_STAFF_MODERATOR || "1563736465522036736",
    },
  },
  // Lectura automática de vistas (YouTube: páginas públicas + Return YouTube Dislike; resto: yt-dlp). YOUTUBE_API_KEY es opcional.
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
    // Rangos automáticos: si en una semana no sube ningún video baja a Creator. El aviso llega
    // WARN_DAYS_BEFORE días antes del fin de la semana y la bajada se aplica DEMOTION_GRACE_HOURS
    // después de que termina (margen para subir la evidencia de un video del domingo).
    autoTiers: process.env.CREATOR_AUTO_TIERS !== "false",
    warnDaysBefore: int("CREATOR_WARN_DAYS_BEFORE", 3),
    demotionGraceHours: int("CREATOR_DEMOTION_GRACE_HOURS", 24),
    // Creadores antiguos (ya tenían el tag en el juego sin pasar por la página): días para aplicar
    // desde el aviso, y fecha límite final (hora de Colombia) tras la cual se les quita el rol.
    legacyNoticeDays: int("LEGACY_NOTICE_DAYS", 3),
    legacyDeadline: Date.parse(`${process.env.LEGACY_DEADLINE || "2027-01-01"}T00:00:00-05:00`),
  },
  // Programa de staff: Helper → Moderator Jr → Moderator.
  staff: {
    // El staff que ya existía tiene hasta esta fecha (hora de Colombia) para vincular Discord + Roblox.
    linkDeadline: Date.parse(`${process.env.STAFF_LINK_DEADLINE || "2026-12-01"}T00:00:00-05:00`),
    // Tareas mensuales: meses seguidos sin cumplir antes de salir del staff (0 = nunca automático).
    failMonthsToRemove: int("STAFF_FAIL_MONTHS_TO_REMOVE", 2),
    // Día del mes en que llega el aviso si van por debajo de la mitad.
    warnDay: int("STAFF_WARN_DAY", 20),
    // Días después de fin de mes para revisar evidencias antes de cerrar el mes.
    graceDays: int("STAFF_GRACE_DAYS", 3),
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
