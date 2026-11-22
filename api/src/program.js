// Programa de creadores de contenido: niveles, comandos y recompensas.
// Fuente única: la API lo usa para validar y la página lo pide en /api/creators/program.
// Las claves de los packs (V1000…M5000) son las mismas de CreatorServiceConfig.Packs en el juego.

export const LEVELS = [
  {
    key: "Creator", name: "Creator", emoji: "🎬", color: "#4FB4FF",
    requirement: "Tu solicitud fue aprobada y un moderador te dio el rol.",
    commands: [
      { cmd: ";Emotes", desc: "Abre el panel de emotes, con el baile exclusivo “Passinho do Jamal”." },
      { cmd: ";Follow <jugador>", desc: "Tu personaje sigue a otro jugador." },
      { cmd: ";GoTo <jugador>", desc: "Te teletransporta junto a un jugador." },
      { cmd: ";HideGuis", desc: "Oculta los menús de tu pantalla para grabar sin interfaz." },
    ],
  },
  {
    key: "Active", name: "Creator Activo", emoji: "🌟", color: "#3FC35A",
    requirement: "Reclama el pack de 3.000 vistas en una semana.",
    commands: [
      { cmd: ";Invisible", desc: "Te vuelve invisible." },
      { cmd: ";View <jugador>", desc: "Tu cámara pasa a ver desde otro jugador." },
      { cmd: ";Kick <jugador>", desc: "Expulsa a un jugador del servidor. Solo con quien rompa las reglas, nunca por diversión." },
    ],
  },
  {
    key: "Viral", name: "Creator Viral", emoji: "🔥", color: "#FF8A3D",
    requirement: "Reclama el pack de 3.500 vistas en una semana.",
    commands: [
      { cmd: ";GoLive [mensaje]", desc: "Avisa a todos los servidores que estás en directo (80 caracteres, con filtro). 10 minutos entre avisos." },
      { cmd: ";Buffify, ;Wormify, ;Chibify, ;Plushify, ;Freakify, ;Frogify, ;Spongify, ;Bigify, ;Creepify, ;Dinofy, ;Fatify", desc: "Disfraces que transforman tu personaje. ;un<comando> lo revierte." },
    ],
  },
  {
    key: "Star", name: "Creator Estrella", emoji: "🏆", color: "#C77DFF",
    requirement: "Reclama el pack de 4.500 vistas en una semana.",
    commands: [
      { cmd: ";CreatorEvent <evento>", desc: "Mini evento en tu servidor: GoldenHour, LuckyHour, EggRush o HatchFrenzy. 2–3 min, 1 h de espera." },
      { cmd: ";Clone", desc: "Crea un clon tuyo." },
      { cmd: ";Char <jugador>", desc: "Cambias a la apariencia de otro jugador." },
      { cmd: ";Teleport <jugador> <destino>", desc: "Teletransporta a un jugador junto a otro." },
      { cmd: ";Glass, ;Neon, ;Shine, ;Ghost, ;Gold, ;Reflect", desc: "Cambian el material de tu personaje." },
      { cmd: ";Size <tamaño>", desc: "Cambia el tamaño de tu personaje." },
    ],
  },
  {
    key: "Elite", name: "Creator Elite", emoji: "👑", color: "#FFC21A",
    requirement: "Reclama el pack mensual: 3 videos y 5.000 vistas en un mes.",
    commands: [
      { cmd: ";Fly", desc: "Vuelas." },
      { cmd: ";God", desc: "No recibes daño." },
      { cmd: ";Fog y ;FogColor", desc: "Cambian la niebla y su color en todo el servidor." },
      { cmd: ";Disco", desc: "Luces de discoteca en todo el servidor." },
    ],
  },
];

// rarity = rareza de la tirada de mascota extra que llega al buzón.
export const PACKS = [
  { key: "V1000", period: "week", minViews: 1000, minVideos: 1, vipDays: 7, boostHours: 2, bonus: [{ rarity: "Epic", q: 1 }], level: null },
  { key: "V2500", period: "week", minViews: 2500, minVideos: 1, vipDays: 10, boostHours: 3, bonus: [{ rarity: "Epic", q: 2 }], level: null },
  { key: "V3000", period: "week", minViews: 3000, minVideos: 1, vipDays: 12, boostHours: 4, bonus: [{ rarity: "Legendary", q: 1 }], level: "Active" },
  { key: "V3500", period: "week", minViews: 3500, minVideos: 1, vipDays: 15, boostHours: 5, bonus: [{ rarity: "Legendary", q: 1 }, { rarity: "Epic", q: 1 }], level: "Viral" },
  { key: "V4500", period: "week", minViews: 4500, minVideos: 1, vipDays: 21, boostHours: 6, bonus: [{ rarity: "Mythic", q: 1 }], level: "Star" },
  { key: "M5000", period: "month", minViews: 5000, minVideos: 3, vipDays: 30, boostHours: 8, bonus: [{ rarity: "Mythic", q: 1 }, { rarity: "Legendary", q: 1 }], level: "Elite", extra: "1 mes de Admin Abuse (lo coordina el admin contigo)" },
];
export const PACK_BY_KEY = Object.fromEntries(PACKS.map((p) => [p.key, p]));

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
    packs: PACKS,
    robux: ROBUX,
    special: SPECIAL,
    claimGraceDays: { week: cfg.creators.claimGraceDaysWeek, month: cfg.creators.claimGraceDaysMonth },
  };
}
