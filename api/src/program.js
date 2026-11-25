// Programa de creadores de contenido: niveles, comandos y recompensas.
// Fuente única: la API lo usa para validar y la página lo pide en /api/creators/program.
// Las claves de los packs (V1000…M5000) son las mismas de CreatorServiceConfig.Packs en el juego.

// Rangos automáticos (2026-11-23, pedido del dueño): se suben solos con las vistas aprobadas de la
// semana (lunes a domingo, hora de Colombia) y bajan a Creator si una semana entera no sube ningún video.
// minWeekViews = vistas semanales para llegar al rango. Las claves son las de CreatorServiceConfig.Tiers.
export const LEVELS = [
  {
    key: "Creator", name: "Creator", emoji: "🎬", color: "#4FB4FF", minWeekViews: 0,
    requirement: "Tu solicitud fue aprobada: el rango llega solo al juego y a Discord.",
    commands: [
      { cmd: ";Emotes", desc: "Abre el panel de emotes, con el baile exclusivo “Passinho do Jamal”." },
      { cmd: ";Dance <jugador> <emote>", desc: "Pon a bailar a un jugador (o a ti con “me”) eligiendo el emote de una lista. ;undance lo detiene." },
      { cmd: ";Follow <jugador>", desc: "Tu personaje sigue a otro jugador." },
      { cmd: ";GoTo <jugador>", desc: "Te teletransporta junto a un jugador." },
      { cmd: ";HideGuis", desc: "Oculta los menús de tu pantalla para grabar sin interfaz." },
      { cmd: ";Sparkles y ;Spin", desc: "Brillos alrededor de tu personaje y giro sobre ti mismo para las intros." },
    ],
  },
  {
    key: "Active", name: "Creator Activo", emoji: "🌟", color: "#3FC35A", minWeekViews: 3000,
    requirement: "3.000 vistas aprobadas en una semana.",
    commands: [
      { cmd: ";Invisible", desc: "Te vuelve invisible." },
      { cmd: ";View <jugador>", desc: "Tu cámara pasa a ver desde otro jugador, aunque esté lejos en el mapa." },
      { cmd: ";Shoutout <jugador>", desc: "Anuncia en tu servidor un saludo a un jugador (“⭐ Tú le manda un saludo a Pepito”). 2 minutos de espera." },
      { cmd: ";Fire, ;Smoke, ;BigHead y ;SmallHead", desc: "Efectos divertidos para tu personaje." },
      { cmd: ";Kick <jugador>", desc: "Expulsa a un jugador del servidor. Solo con quien rompa las reglas, nunca por diversión." },
    ],
  },
  {
    key: "Viral", name: "Creator Viral", emoji: "🔥", color: "#FF8A3D", minWeekViews: 3500,
    requirement: "3.500 vistas aprobadas en una semana.",
    commands: [
      { cmd: ";GoLive [mensaje]", desc: "Avisa a todos los servidores que estás en directo. El mensaje es opcional (80 caracteres, con filtro). 10 minutos entre avisos." },
      { cmd: ";Confetti", desc: "Lluvia de confeti a tu alrededor que ve todo el servidor. 30 segundos de espera." },
      { cmd: ";Helicopter, ;Car y ;Plane", desc: "Emotes de vehículos con sonido." },
      { cmd: ";Buffify, ;Wormify, ;Chibify, ;Plushify, ;Freakify, ;Frogify, ;Spongify, ;Bigify, ;Creepify, ;Dinofy, ;Fatify", desc: "Disfraces que transforman tu personaje. ;un<comando> lo revierte." },
    ],
  },
  {
    key: "Star", name: "Creator Estrella", emoji: "🏆", color: "#C77DFF", minWeekViews: 4500,
    requirement: "4.500 vistas aprobadas en una semana.",
    commands: [
      { cmd: ";CreatorEvent <evento>", desc: "Mini evento en tu servidor: GoldenHour, LuckyHour, EggRush o HatchFrenzy. 2–3 min, 1 h de espera." },
      { cmd: ";Spotlight", desc: "Un foco de luz te sigue durante 60 segundos. Perfecto para presentaciones." },
      { cmd: ";Vote y ;CountdownNotice", desc: "Encuesta en tu servidor y cuenta regresiva en pantalla para retos en vivo." },
      { cmd: ";Clone", desc: "Crea un clon tuyo." },
      { cmd: ";Char <jugador>", desc: "Cambias a la apariencia de otro jugador." },
      { cmd: ";Teleport <jugador> <destino>", desc: "Teletransporta a un jugador junto a otro." },
      { cmd: ";Glass, ;Neon, ;Shine, ;Ghost, ;Gold, ;Reflect", desc: "Cambian el material de tu personaje." },
      { cmd: ";Size <tamaño>", desc: "Cambia el tamaño de tu personaje." },
    ],
  },
  {
    key: "Elite", name: "Creator Elite", emoji: "👑", color: "#FFC21A", minWeekViews: 5000,
    requirement: "5.000 vistas aprobadas en una semana.",
    commands: [
      { cmd: ";Fly", desc: "Vuelas (E o doble salto lo apaga y lo enciende). Ya no te hace caer al pasar sobre el vacío." },
      { cmd: ";Fireworks", desc: "Show de fuegos artificiales a tu alrededor. 1 minuto de espera." },
      { cmd: ";Aura", desc: "Emote de aura con partículas." },
      { cmd: ";God", desc: "No recibes daño." },
      { cmd: ";Fog y ;FogColor", desc: "Cambian la niebla y su color en todo el servidor." },
      { cmd: ";Disco", desc: "Luces de discoteca en todo el servidor." },
    ],
  },
];
export const LEVEL_KEYS = LEVELS.map((l) => l.key);
export const levelIndex = (key) => LEVEL_KEYS.indexOf(key) + 1; // 0 = ninguno, 1 = Creator … 5 = Elite
// Rango que corresponde a esas vistas semanales.
export function rankForViews(views) {
  let best = LEVELS[0];
  for (const l of LEVELS) if (views >= l.minWeekViews) best = l;
  return best.key;
}

// rarity = rareza de la tirada de mascota extra que llega al buzón.
// level: null en todos desde 2026-11-23: el rango ya no lo sube el pack, sino las vistas semanales (rankForViews).
export const PACKS = [
  { key: "V1000", period: "week", minViews: 1000, minVideos: 1, vipDays: 7, boostHours: 2, bonus: [{ rarity: "Epic", q: 1 }], level: null },
  { key: "V2500", period: "week", minViews: 2500, minVideos: 1, vipDays: 10, boostHours: 3, bonus: [{ rarity: "Epic", q: 2 }], level: null },
  { key: "V3000", period: "week", minViews: 3000, minVideos: 1, vipDays: 12, boostHours: 4, bonus: [{ rarity: "Legendary", q: 1 }], level: null },
  { key: "V3500", period: "week", minViews: 3500, minVideos: 1, vipDays: 15, boostHours: 5, bonus: [{ rarity: "Legendary", q: 1 }, { rarity: "Epic", q: 1 }], level: null },
  { key: "V4500", period: "week", minViews: 4500, minVideos: 1, vipDays: 21, boostHours: 6, bonus: [{ rarity: "Mythic", q: 1 }], level: null },
  { key: "M5000", period: "month", minViews: 5000, minVideos: 3, vipDays: 30, boostHours: 8, bonus: [{ rarity: "Mythic", q: 1 }, { rarity: "Legendary", q: 1 }], level: null, extra: "1 mes de Admin Abuse (lo coordina el admin contigo)" },
];
export const PACK_BY_KEY = Object.fromEntries(PACKS.map((p) => [p.key, p]));

// Videos de la bienvenida (modal al ser aprobado y pestaña Guía).
export const WELCOME_VIDEOS = [
  { site: "youtube", id: "V7q6RxpdWgA", url: "https://youtu.be/V7q6RxpdWgA", title: "Así funciona el Programa de Creadores" },
  { site: "tiktok", id: "7711134946613677319", url: "https://www.tiktok.com/@pochi_dev/video/7711134946613677319", title: "El programa en 1 minuto (TikTok)" },
];

export const ROBUX = { minViews: 10_000, per10k: 100, maxPerVideo: 1000 };
export const SPECIAL = { monthlyViews: 100_000 };
export const ROBLOX_LEVEL_TAGS = ["None", ...LEVELS.map((l) => l.key)];

export function robuxFor(views) {
  if (!(views >= ROBUX.minViews)) return 0;
  return Math.min(ROBUX.maxPerVideo, Math.floor(views / 10_000) * ROBUX.per10k);
}

// Mejor pack alcanzado con esas vistas y videos en el periodo.
export function bestPack(period, views, videos) {
  let best = null;
  for (const p of PACKS) if (p.period === period && views >= p.minViews && videos >= p.minVideos) best = p;
  return best;
}

export function publicProgram(cfg) {
  return {
    levels: LEVELS,
    autoTiers: {
      warnDaysBefore: cfg.creators.warnDaysBefore,
      legacyDeadline: cfg.creators.legacyDeadline,
    },
    packs: PACKS,
    robux: ROBUX,
    special: SPECIAL,
    welcomeVideos: WELCOME_VIDEOS,
    claimGraceDays: { week: cfg.creators.claimGraceDaysWeek, month: cfg.creators.claimGraceDaysMonth },
  };
}
