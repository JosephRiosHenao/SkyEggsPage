// Programa de staff de Sky Eggs (2026-11-23): rangos, formulario de Helper, tareas mensuales,
// comandos, funciones y beneficios. Fuente única para la API, el panel y la página /staff/.
// Las claves de rango son las de StaffActivity.Ranks en el juego (tags HELPER/MODERATORJR/MODERATOR).

export const RANKS = [
  {
    key: "Helper", name: "Helper", emoji: "🛟", color: "#38BDF8", tag: "HELPER",
    summary: "La puerta de entrada al staff: atiende a los jugadores, responde dudas y reporta problemas.",
    game: [
      { cmd: ";Report <jugador> <motivo>", desc: "Envía un reporte al panel de la página y avisa al staff conectado." },
      { cmd: ";sc <mensaje>", desc: "Chat privado del staff en todos los servidores." },
      { cmd: ";PlayerInfo <jugador>", desc: "Nivel, edad de la cuenta, etiquetas, nivel de creador y si está en este servidor." },
      { cmd: ";Warn <jugador> <motivo>", desc: "Advertencia oficial (queda en el historial de HD Admin)." },
      { cmd: ";Mute <jugador>", desc: "Silencia el chat de un jugador que insulta o hace spam." },
      { cmd: ";View, ;GoTo, ;Follow", desc: "Ver desde un jugador, ir a su lado o seguirlo para ayudarlo." },
      { cmd: ";PrivateMessage <jugador> <mensaje>", desc: "Mensaje privado oficial." },
      { cmd: ";WhoIs, ;Ping, ;HideGuis, ;Emotes, ;Dance", desc: "Información, ping, capturas sin interfaz y emotes." },
      { cmd: ";StaffHelp", desc: "Tus comandos y la guía, dentro del juego." },
    ],
    discord: [
      "Responder dudas en los canales de ayuda y dar la bienvenida a los nuevos.",
      "Avisar en el canal de staff cuando veas spam, insultos o estafas en trades.",
      "Recordar las reglas con respeto y llevar los casos graves a un Moderator Jr o Moderator.",
    ],
    benefits: ["Etiqueta HELPER azul en el juego y el chat", "Rol Helper en Discord y canal de staff", "Acceso al panel del staff con tus tareas y métricas", "Camino de ascenso a Moderator Jr"],
  },
  {
    key: "ModeratorJr", name: "Moderator Jr", emoji: "🛡️", color: "#10B981", tag: "MODERATORJR",
    summary: "Controla los servidores: expulsa, aísla y congela a quien rompe las reglas y revisa reportes y tareas de los Helpers.",
    game: [
      { cmd: "Todo lo del Helper", desc: "" },
      { cmd: ";Kick <jugador> <motivo>", desc: "Expulsa del servidor." },
      { cmd: ";Jail <jugador>", desc: "Encierra a un jugador mientras revisas el caso." },
      { cmd: ";Anchor <jugador>", desc: "Lo congela en su sitio (investigar exploits o peleas)." },
      { cmd: ";Bring, ;Respawn", desc: "Trae a un jugador o lo hace reaparecer si está atascado." },
      { cmd: ";Invisible", desc: "Observa sin que te vean." },
      { cmd: ";Notice, ;CountdownNotice, ;Vote", desc: "Avisos, cuentas regresivas y votaciones en el servidor." },
      { cmd: ";Tags", desc: "Ver las etiquetas de un jugador." },
    ],
    discord: [
      "Revisar en el panel los reportes del juego y las evidencias de tareas de los Helpers.",
      "Aplicar timeouts y advertencias en Discord según las reglas.",
      "Acompañar a los Helpers nuevos y corregirlos con respeto.",
    ],
    benefits: ["Etiqueta MODERATOR JR verde", "Rol Moderator Jr en Discord", "Revisas reportes y tareas en el panel", "Ascenso a Moderator con aprobación del Admin"],
  },
  {
    key: "Moderator", name: "Moderator", emoji: "⚔️", color: "#22C55E", tag: "MODERATOR",
    summary: "Máxima autoridad del staff después del Admin: sanciones fuertes, eventos, solicitudes y el programa de creadores en la web.",
    game: [
      { cmd: "Todo lo del Moderator Jr", desc: "" },
      { cmd: ";TimeBan, ;ServerBan, ;Unban, ;UnServerBan", desc: "Baneos temporales o del servidor (y quitarlos)." },
      { cmd: ";Punish <jugador>", desc: "Quita el personaje a un jugador por un rato." },
      { cmd: ";Teleport, ;Fly", desc: "Llegar a cualquier sitio para investigar." },
      { cmd: ";GlobalVote", desc: "Votación en todos los servidores." },
      { cmd: ";CreatorEvent <evento>", desc: "Mini eventos en el servidor: Golden Hour, Lucky Hour, Egg Rush o Hatch Frenzy." },
      { cmd: ";Spotlight, ;Fireworks, ;Confetti, ;Notify", desc: "Presentaciones, celebraciones y avisos." },
    ],
    discord: [
      "Aprobar o rechazar solicitudes de Helpers y ascender a Moderator Jr.",
      "Gestionar el programa de creadores en la web (solicitudes, evidencias, bonos).",
      "Organizar eventos de la comunidad y tomar decisiones en casos graves.",
    ],
    benefits: ["Etiqueta MODERATOR", "Rol Moderator en Discord", "Panel completo de moderación y creadores", "Organizas eventos y mini eventos del juego"],
  },
];
export const RANK_KEYS = RANKS.map((r) => r.key);
export const rankIndex = (key) => RANK_KEYS.indexOf(key) + 1; // 0 = no es staff
export const RANK_BY_KEY = Object.fromEntries(RANKS.map((r) => [r.key, r]));

// Tareas mensuales para mantener el rango. track: "auto" (lo mide el juego o la página) o
// "evidence" (el staff sube pruebas y un rango superior aprueba cuánto suma).
// targets[rango] = meta del mes (0 = no se pide en ese rango).
// Cada tarea tiene, por rango:
//   min  = cuota OBLIGATORIA del mes para mantener el rango (0 = no es obligatoria en ese rango).
//   goal = meta OPCIONAL más alta: lo que pases de la cuota suma "desempeño", que cuenta para ascender.
// Lo que depende de que haya trabajo (si nadie rompe reglas no hay sanciones; si un compañero atiende
// todo el panel no quedan revisiones) es solo opcional. El Admin cambia los números en Ajustes.
export const TASKS = [
  { key: "weeks", name: "Semanas con la cuota cumplida", unit: "semanas", track: "auto",
    min: { Helper: 3, ModeratorJr: 3, Moderator: 3 }, goal: { Helper: 4, ModeratorJr: 4, Moderator: 4 },
    desc: "Semanas (lunes a domingo) en las que llegaste a tu cuota de horas: tiempo activo en el juego (el AFK no cuenta) + actividad en el Discord. Puedes fallar una semana al mes." },
  { key: "days", name: "Días activos", unit: "días", track: "auto",
    min: { Helper: 8, ModeratorJr: 6, Moderator: 5 }, goal: { Helper: 16, ModeratorJr: 12, Moderator: 10 },
    desc: "Días distintos con al menos 10 minutos activo en el juego o escribiendo en el Discord." },
  { key: "helps", name: "Ayudas a jugadores", unit: "ayudas", track: "evidence",
    min: { Helper: 3, ModeratorJr: 2, Moderator: 0 }, goal: { Helper: 10, ModeratorJr: 8, Moderator: 5 },
    desc: "Capturas de ayudar a alguien en Discord o en el juego (una captura puede sumar varias ayudas)." },
  { key: "moderation", name: "Acciones de moderación", unit: "acciones", track: "auto",
    min: { Helper: 0, ModeratorJr: 0, Moderator: 0 }, goal: { Helper: 5, ModeratorJr: 8, Moderator: 10 },
    desc: "Warn, Mute, Kick, Jail, baneos y ;Report en el juego. Solo opcional: si nadie rompe las reglas, no hace falta." },
  { key: "reviews", name: "Revisiones en el panel", unit: "revisiones", track: "auto",
    min: { Helper: 0, ModeratorJr: 0, Moderator: 0 }, goal: { Helper: 0, ModeratorJr: 5, Moderator: 10 },
    desc: "Reportes, evidencias, excusas y solicitudes revisadas en el panel. Solo opcional: depende de cuántas lleguen." },
  { key: "invites", name: "Invitaciones al Discord", unit: "personas", track: "evidence",
    min: { Helper: 0, ModeratorJr: 0, Moderator: 0 }, goal: { Helper: 3, ModeratorJr: 2, Moderator: 1 },
    desc: "Amigos que entraron al Discord con tu enlace este mes (captura del contador de invitaciones). Solo opcional." },
  { key: "event", name: "Evento de la comunidad", unit: "eventos", track: "evidence",
    min: { Helper: 0, ModeratorJr: 0, Moderator: 0 }, goal: { Helper: 0, ModeratorJr: 1, Moderator: 1 },
    desc: "Organizar o ayudar en un evento (torneo, sorteo, mini evento con ;CreatorEvent). Sube capturas o el anuncio." },
  { key: "bugs", name: "Bugs reportados", unit: "bugs", track: "evidence",
    min: { Helper: 0, ModeratorJr: 0, Moderator: 0 }, goal: { Helper: 1, ModeratorJr: 1, Moderator: 1 },
    desc: "Errores del juego con video o captura." },
];
export const TASK_BY_KEY = Object.fromEntries(TASKS.map((t) => [t.key, t]));

// Formulario para aplicar como Helper (preguntas del dueño). type: text | long | yesno.
// Discord y Roblox no se preguntan: se vinculan (login con Discord + elegir la cuenta de Roblox).
export const QUESTIONS = [
  { key: "timezone", label: "Hora / zona horaria y país", type: "text", required: true },
  { key: "discord_active", label: "¿Eres activo en la comunidad de Discord?", type: "text", required: true },
  { key: "prior_staff", label: "¿Has sido helper o moderador en algún server?", type: "yesno", required: true },
  { key: "prior_servers", label: "¿En qué server trabajaste? (solo si respondiste sí en la anterior)", type: "text", required: false },
  { key: "prior_roles", label: "¿Qué cargos tenías en los servers que estuviste?", type: "text", required: false },
  { key: "help_experience", label: "¿Tienes experiencia ayudando a otros usuarios?", type: "long", required: true },
  { key: "why", label: "¿Por qué quieres ser helper de Sky Eggs?", type: "long", required: true },
  { key: "knows_rules", label: "¿Sabes las reglas del server/juego?", type: "yesno", required: true },
  { key: "argue", label: "¿Qué haces si dos usuarios discuten?", type: "long", required: true },
  { key: "break_rule", label: "¿Qué harías si un usuario rompe una regla importante?", type: "long", required: true },
  { key: "hours", label: "¿Cuántas horas puedes estar activo al día?", type: "text", required: true },
  { key: "schedule", label: "¿En qué horario sueles conectarte?", type: "text", required: true },
  { key: "constant", label: "¿Puedes mantenerte activo de forma constante?", type: "yesno", required: true },
  { key: "slow_reply", label: "¿Tienes problemas para responder rápido en Discord?", type: "yesno", required: true },
  { key: "newbie", label: "¿Cómo tratarías a un usuario nuevo que no entiende las reglas?", type: "long", required: true },
  { key: "insults", label: "¿Cómo reaccionas ante insultos o provocaciones?", type: "long", required: true },
  { key: "respectful", label: "¿Te consideras respetuoso y paciente?", type: "yesno", required: true },
  { key: "staff_rules", label: "¿Estás dispuesto a seguir las normas del staff?", type: "yesno", required: true },
  { key: "promise", label: "¿Prometes actuar con tranquilidad, neutralidad y seriedad?", type: "yesno", required: true },
  { key: "corrections", label: "¿Estás dispuesto a recibir correcciones de rangos superiores?", type: "yesno", required: true },
  { key: "why_you", label: "¿Por qué deberíamos elegirte como helper?", type: "long", required: true },
  { key: "contribute", label: "¿Qué tienes para aportar al server?", type: "long", required: true },
  { key: "if_owner", label: "¿Qué harías si fueras owner del Discord y del juego?", type: "long", required: true },
];

export const RULES = [
  "Neutralidad: nada de favores a amigos ni sanciones por enojo personal.",
  "Primero se avisa (;Warn), después se actúa. Los baneos siempre con motivo claro.",
  "Nada de usar comandos para ventaja propia, trolear o mover la economía.",
  "Todo queda registrado (juego y página): los abusos se revisan y se sancionan.",
  "Los casos graves o dudosos se escalan al rango superior por ;sc o el canal de staff.",
  "¿No puedes cumplir una semana o un mes (exámenes, viaje, enfermedad)? Presenta una excusa en el panel: si la aprueban, no pierdes el rango.",
  "Cada tarea tiene una cuota obligatoria (para mantener el rango) y una meta opcional más alta (para ascender).",
  "Si pasas 2 meses seguidos sin cumplir las cuotas obligatorias, bajas un rango (un Helper sale del staff). Puedes volver a subir cumpliendo.",
];

// settings = ajustes del Admin (staffSettings.js): metas, cuota semanal, Discord y reglas.
export function publicStaffProgram(cfg, settings = null) {
  const tasks = settings ? TASKS.map((t) => ({ ...t, min: { ...t.min, ...settings.targets[t.key]?.min }, goal: { ...t.goal, ...settings.targets[t.key]?.goal } })) : TASKS;
  return {
    ranks: RANKS, tasks, questions: QUESTIONS, rules: RULES,
    weekly: settings?.weekly || null, discordCredit: settings ? { weight: settings.discord.weight, windowMinutes: settings.discord.windowMinutes, dailyCapMinutes: settings.discord.dailyCapMinutes, enabled: settings.discord.channels.length > 0 } : null,
    promotionRules: settings?.promotion || null, excuseDays: settings?.rules.excuseDays ?? 5,
    linkDeadline: cfg.staff.linkDeadline, failMonthsToRemove: settings?.rules.failMonthsToRemove ?? cfg.staff.failMonthsToRemove,
    path: ["Helper", "ModeratorJr", "Moderator"],
    promotions: { ModeratorJr: "lo aprueba un Moderator o el Admin", Moderator: "solo lo aprueba el Admin" },
  };
}
