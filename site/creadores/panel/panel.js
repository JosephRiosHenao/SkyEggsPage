// Panel del Programa de Creadores: aspirantes, creadores, moderadores y admin.
// Todo el texto que viene del servidor se pinta con textContent (nunca innerHTML).
(() => {
  const $ = (id) => document.getElementById(id);
  const fmt = new Intl.NumberFormat("es-CO");
  const n = (v) => fmt.format(v || 0);
  const when = (t) => (t ? new Date(t).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" }) : "—");
  const day = (t) => new Date(t).toLocaleDateString("es-CO", { weekday: "long", day: "numeric", month: "long" });

  const ERRORS = {
    login_required: "Tu sesión terminó. Entra de nuevo con Discord.",
    creator_only: "Esta sección es para creadores con el rol de Content Creator en Discord.",
    forbidden: "No tienes permiso para esto.",
    slow_down: "Vas muy rápido. Espera un momento.",
    already_pending: "Ya tienes una solicitud en revisión.",
    already_approved: "Tu solicitud ya fue aprobada.",
    wait_after_reject: "Tu última solicitud fue rechazada. Puedes volver a aplicar 7 días después.",
    age_required: "Tienes que confirmar que tienes 13 años o más.",
    pick_account: "Busca tu cuenta de Roblox y elígela de la lista.",
    must_play: "Esa cuenta todavía no ha jugado Sky Eggs. Entra al juego, juega un rato y vuelve a intentarlo.",
    bad_email: "Ese correo no parece válido.",
    need_platform: "Agrega al menos una red con su enlace (https://…).",
    about_short: "Cuéntanos un poco más sobre ti (mínimo 20 letras).",
    unknown_player: "No encontramos esa cuenta de Roblox. Búscala otra vez.",
    already_linked: "Tu cuenta de Roblox ya está vinculada. Para cambiarla, habla con un moderador.",
    roblox_taken: "Esa cuenta de Roblox ya está vinculada a otro creador.",
    too_many: "Ya subiste muchas evidencias hoy. Sigue mañana.",
    bad_url: "El enlace tiene que empezar por https://",
    bad_date: "Revisa la fecha de publicación.",
    future_date: "La fecha de publicación no puede ser futura.",
    too_old: "Solo se aceptan videos de los últimos 45 días.",
    duplicate_url: "Ese enlace ya se subió antes.",
    image_required: "La captura tiene que ser PNG, JPG o WEBP.",
    bad_image: "Ese archivo no es una imagen válida.",
    too_large: "La captura pesa más de 5 MB.",
    not_approved: "Primero un moderador tiene que aprobar esa evidencia.",
    link_required: "Primero vincula tu cuenta de Roblox (pestaña Mi Roblox) y espera a que la aprueben.",
    period_closed: "Se acabó el plazo para reclamar ese periodo.",
    already_claimed: "Ya reclamaste ese periodo.",
    no_pack: "Todavía no llegas a ninguna meta en ese periodo.",
    not_enough_views: "El bono empieza en 10.000 vistas.",
    already_requested: "Ya pediste el bono de ese video.",
    not_eligible: "Necesitas 100.000 vistas aprobadas en el mes (y un pedido por mes).",
    request_short: "Describe tu pedido con un poco más de detalle.",
    own_item: "No puedes revisar tus propias cosas.",
    bad_views: "Escribe las vistas con números.",
    already_reviewed: "Eso ya lo revisó otra persona. Actualiza la página.",
    admin_only: "Solo el admin puede hacer esto.",
    needs_other_reviewer: "La aprobación final tiene que hacerla una persona distinta a la que aprobó primero.",
    bad_action: "Esa acción no se puede hacer en este estado.",
    not_found: "No se encontró. Actualiza la página.",
    not_trackable: "Esta red no deja leer las vistas solas. Escribe las vistas fijas.",
    no_auto_views: "Todavía no se pudieron leer las vistas. Toca “Volver a leer” o escribe las vistas fijas.",
    views_off: "La lectura automática de vistas está apagada en el servidor.",
    already_staff: "Ya eres parte del staff.",
    missing_answer: "Responde todas las preguntas obligatorias (*).",
    answer_short: "Desarrolla un poco más tus respuestas largas (mínimo 10 letras).",
    not_staff: "Esta sección es para el staff.",
    link_deadline: "Ya pasó la fecha límite para vincular: envía una solicitud de Helper.",
    bad_task: "Elige una tarea válida.",
    bad_amount: "Escribe una cantidad entre 1 y 500.",
    need_proof: "Pon un enlace o sube una captura como prueba.",
    note_short: "Explica qué hiciste.",
    note_required: "Escribe una nota.",
    max_rank: "Ya estás en el rango más alto.",
    bad_rank: "Ese rango no existe.",
    same_rank: "Ya tiene ese rango.",
    members_intent: "No se pudo leer la lista de Discord: activa «Server Members Intent» en el bot.",
    not_eligible: "Todavía no cumples los requisitos para pedir el ascenso. Te falta:",
    request_short: "Explica un poco más (mínimo 10 letras).",
    bad_scope: "Elige si la excusa es de una semana o de un mes.",
    excuse_late: "Ya pasó el plazo para excusar el mes pasado.",
    reason_short: "Cuenta el motivo con un poco más de detalle (mínimo 15 letras).",
    excuse_limit: "Ya usaste todas las excusas aprobadas de este año.",
    bad_settings: "Hay un valor fuera de rango en:",
    no_bot: "Falta configurar el bot de Discord (DISCORD_BOT_TOKEN).",
    bad_tier: "Ese rango no existe.",
    same_tier: "Ya tiene ese rango.",
    must_reapply: "Saliste del programa: envía una solicitud nueva en la pestaña Aplicar.",
  };
  const LOGIN_ERRORS = {
    discord_off: "El login con Discord todavía no está configurado. Avísale al admin.",
    login_expired: "El inicio de sesión tardó demasiado. Inténtalo otra vez.",
    login_cancelled: "Cancelaste el inicio de sesión.",
    discord_error: "Discord no respondió. Inténtalo otra vez.",
    slow_down: "Demasiados intentos. Espera unos minutos.",
  };

  const el = (tag, attrs = {}, ...kids) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) node.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    return node;
  };
  const link = (href, text) => el("a", { href, target: "_blank", rel: "noopener noreferrer nofollow" }, text);
  const pill = (status, text) => el("span", { class: `pill pill--${status}` }, text);
  const ago = (t) => {
    if (!t) return "nunca";
    const m = Math.round((Date.now() - t) / 60_000);
    return m < 60 ? `hace ${Math.max(1, m)} min` : m < 1440 ? `hace ${Math.round(m / 60)} h` : `hace ${Math.round(m / 1440)} días`;
  };
  // Estado de la lectura automática de vistas de una evidencia.
  function trackLine(e) {
    const track = e.track, autoViews = e.autoViews ?? e.auto_views, checked = e.autoCheckedAt ?? e.auto_checked_at;
    const err = e.autoError ?? e.auto_error, until = e.trackUntil ?? e.track_until;
    if (track === "auto") {
      if (autoViews != null) return `🔄 Vistas automáticas: ${n(autoViews)} (leídas ${ago(checked)}). Se actualizan solas hasta el ${new Date(until).toLocaleDateString("es-CO", { day: "numeric", month: "long" })}.`;
      return err ? `🔄 Aún no se pudieron leer las vistas (${err}). Se vuelve a intentar.` : "🔄 Leyendo las vistas…";
    }
    return err ? `📌 Vistas fijas: no se pudieron leer solas (${err}).` : "📌 Vistas fijas: las escribe un moderador.";
  }

  async function api(path, body, raw) {
    const init = body === undefined ? {} : raw
      ? { method: "POST", headers: { "content-type": raw.type }, body: raw }
      : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
    const res = await fetch(path, { credentials: "same-origin", ...init });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || "error"), { status: res.status, field: data.field || null });
    return data;
  }
  function flash(text, kind = "ok") {
    const box = el("div", { class: `notice notice--${kind}` }, text);
    $("flash").replaceChildren(box);
    box.scrollIntoView({ block: "nearest", behavior: "smooth" });
    if (kind === "ok") setTimeout(() => box.remove(), 6000);
  }
  const errText = (e) => {
    const base = ERRORS[e.message] || "Algo salió mal. Inténtalo de nuevo.";
    if (!e.field) return base;
    const q = staffProgram?.questions?.find((x) => x.key === e.field);
    return `${base} (${q ? q.label : e.field})`;
  };
  // Botón que llama a la API, se desactiva mientras tanto y avisa del resultado.
  async function act(btn, fn, okText, after) {
    btn.disabled = true;
    try {
      const out = await fn();
      if (okText) flash(typeof okText === "function" ? okText(out) : okText, "ok");
      if (after) await after(out);
    } catch (e) {
      if (e.status === 401) return start();
      flash(errText(e), "bad");
    } finally { btn.disabled = false; }
  }

  // ---------- Estado ----------
  let me = null;          // { user, application, staffApplication }
  let program = null;     // niveles y packs de creadores
  let staffProgram = null;// rangos, tareas y formulario del staff
  let creator = null;     // estado del creador
  let queue = null;       // cola de moderación (con conteos del staff)
  let current = null;

  const roles = () => me?.user?.roles || {};
  const isCreator = () => roles().creator || roles().admin;
  const isMod = () => roles().moderator || roles().admin;
  const isModJr = () => roles().modjr || isMod();
  const isAdmin = () => !!roles().admin;
  const staffRank = () => roles().staffRank || null;

  // Barra lateral: grupos según el rol. [clave, título, icono, conteo]
  function navGroups() {
    const q = queue || {};
    const st = q.staff || {};
    const len = (a) => (Array.isArray(a) ? a.length : 0);
    const canApplyCreator = (!isCreator() && !isMod()) || me?.application?.status === "removed";
    const canApplyStaff = !staffRank() && !isAdmin();
    return [
      { title: "General", items: [["inicio", "Inicio", "🏠"], ["guia", "Guía", "📘"]] },
      { title: "Creador", show: isCreator(), items: [["metas", "Mis metas", "🎯"], ["evidencias", "Evidencias", "🎬"], ["roblox", "Mi Roblox", "🔗"], ["bonos", "Bonos", "💰"], ["comandos", "Comandos de creador", "⌨️"]] },
      { title: "Únete", show: canApplyCreator || canApplyStaff, items: [canApplyCreator && ["aplicar", "Ser creador", "🎥"], canApplyStaff && ["staff-aplicar", "Ser Helper (staff)", "🛟"]] },
      { title: "Mi staff", show: Boolean(staffRank()), items: [
        !roles().staffLinked && ["staff-vincular", "Vincular mi cuenta", "🔗"],
        roles().staffLinked && ["staff-tareas", "Mis tareas del mes", "✅"],
        roles().staffLinked && ["staff-excusas", "Excusas", "📝"],
        ["staff-guia", "Comandos y funciones", "🛡️"]] },
      { title: "Moderación de creadores", show: isMod(), items: [
        ["mod-solicitudes", "Solicitudes", "📝", len(q.applications)], ["mod-vinculos", "Vinculaciones", "🔗", len(q.links)],
        ["mod-evidencias", "Evidencias", "🎬", len(q.evidences)], ["mod-bonos", "Bonos Robux", "💰", len(q.bonuses)],
        isAdmin() && ["mod-especiales", "Pedidos especiales", "👑", len(q.specials)],
        ["mod-creadores", "Creadores y métricas", "📊"], ["mod-avisos", "Avisos al buzón", "📬"], ["mod-antiguos", "Creadores antiguos", "⏳"]] },
      { title: "Staff", show: isModJr(), items: [
        ["staff-reportes", "Reportes del juego", "📣", st.reports], ["staff-revision", "Tareas por revisar", "🧾", st.evidence],
        ["staff-excusas-revision", "Excusas por revisar", "📝", st.excuses],
        ["staff-equipo", "Equipo y métricas", "📈"],
        isMod() && ["staff-solicitudes", "Solicitudes de Helper", "🛟", (st.applications || 0) + (st.links || 0)],
        isMod() && ["staff-ascensos", "Ascensos", "⬆️", st.promotions], isMod() && ["staff-antiguos", "Staff antiguo", "⏳"],
        !staffRank() && ["staff-guia", "Guía del staff", "🛡️"]] },
      { title: "Administración", show: isModJr(), items: [isAdmin() && ["admin-staff-ajustes", "Ajustes del staff", "⚙️"], !isAdmin() && ["admin-staff-ajustes", "Reglas del staff", "⚙️"],
        isAdmin() && ["admin-suerte", "Prueba tu suerte", "🥚"], isMod() && ["admin-discord", "Bot de Discord", "🤖"], isMod() && ["mod-registro", "Registro", "🗂️"]] },
    ].filter((g) => g.show !== false).map((g) => ({ ...g, items: g.items.filter(Boolean) })).filter((g) => g.items.length);
  }
  const allowedKeys = () => navGroups().flatMap((g) => g.items.map((i) => i[0]));
  const titleOf = (key) => navGroups().flatMap((g) => g.items).find((i) => i[0] === key)?.[1] || "Panel";

  function renderNav() {
    $("nav").replaceChildren(...navGroups().map((g) => el("div", { class: "nav-group" },
      el("p", { class: "nav-group__title" }, g.title),
      ...g.items.map(([key, label, icon, count]) => el("a", {
        class: `nav-item${key === current ? " is-active" : ""}`, href: `#${key}`, "aria-current": key === current ? "page" : null,
        onclick: () => document.body.classList.remove("nav-open"),
      }, el("span", { class: "nav-item__icon", "aria-hidden": "true" }, icon), el("span", { class: "nav-item__label" }, label),
        count ? el("span", { class: "count" }, String(count)) : null)))));
  }
  const loadQueue = async () => { if (isModJr()) { queue = await api("/api/mod/queue"); renderNav(); } return queue; };

  async function show(key) {
    const allowed = allowedKeys();
    // Enlaces viejos (#moderacion) → primera página de moderación.
    if (key === "moderacion") key = "mod-solicitudes";
    if (!allowed.includes(key)) key = "inicio";
    current = key;
    renderNav();
    $("page-title").textContent = titleOf(key);
    const section = $("view");
    section.replaceChildren(el("div", { class: "skeleton" }));
    try {
      if (RENDER[key]) await RENDER[key](section);
    } catch (e) {
      if (e.status === 401) return start();
      section.replaceChildren(el("div", { class: "notice notice--bad" }, errText(e)));
    }
    window.scrollTo({ top: 0 });
  }
  // Página de moderación: tarjeta con título y la vista dentro.
  const modPage = (fn, desc) => async (s) => {
    await loadQueue();
    const body = el("div");
    s.replaceChildren(el("div", { class: "box" }, desc ? el("p", { class: "small muted" }, desc) : null, body));
    await fn(body);
  };

  // ---------- Secciones ----------
  const RENDER = {
    async inicio(s) {
      const u = me.user;
      const dash = await homeDashboard(u);
      const box = el("div", { class: "box" }, el("h2", {}, isCreator() || !staffRank() ? "Tus primeros pasos" : "Tu cuenta"));
      if (!u.roles.inGuild) {
        box.append(el("div", { class: "notice" }, "No estás en el Discord de Sky Eggs. Únete y vuelve a entrar para que podamos ver tus roles."),
          el("p", {}, el("a", { class: "btn btn--discord", href: "https://discord.gg/sTgtR7KdGQ", target: "_blank", rel: "noopener" }, "Unirme al Discord")));
      }
      const steps = el("ul", { class: "list" });
      const add = (done, title, text, tab) => steps.append(el("li", { class: "item" },
        el("div", { class: "item__head" }, el("span", { class: "item__title" }, `${done ? "✅" : "⬜"} ${title}`), tab ? el("button", { class: "btn btn--mini btn--yolk", type: "button", onclick: () => { location.hash = tab; } }, "Ir") : null),
        el("p", { class: "item__meta" }, text)));
      if (isCreator()) {
        if (!creator) creator = await api("/api/creators/me");
        const linked = creator.link.status === "approved";
        if (creator.link.status === "removed") {
          box.append(el("div", { class: "notice notice--bad" }, "Saliste del programa de creadores (2 semanas seguidas sin videos o lo decidió un moderador). Perdiste el rango del juego y el rol de Discord. Vuelve a aplicar en la pestaña Aplicar."));
        }
        add(true, "Eres Content Creator", "Tienes el rol en Discord. ¡Bienvenido al programa!");
        add(linked, "Vincula tu cuenta de Roblox", linked ? `Vinculada: @${creator.link.roblox.name}` : creator.link.status === "pending" ? "En revisión: pon el código en tu perfil de Roblox." : "Necesaria para recibir premios en el juego.", linked ? null : "roblox");
        add(creator.evidences.length > 0, "Sube tu primer video o directo", "Un moderador anota las vistas.", "evidencias");
        add(creator.claims.length > 0, "Reclama tu primer premio", "Una vez por semana y una por mes.", "metas");
      } else {
        const a = me.application;
        const st = a ? { pending: "En revisión", contacted: "Un moderador te contactó: revisa tus mensajes de Discord", approved: "Aprobada: espera tu rol en Discord y vuelve a entrar", rejected: "Rechazada" }[a.status] : null;
        add(Boolean(a), "Envía tu solicitud", a ? `Estado: ${st}` : "Cuéntanos dónde publicas y deja tus redes.", a ? null : "aplicar");
        add(a?.status === "approved", "Recibe el rol de Content Creator", "Te lo da un moderador por Discord. Después sal y vuelve a entrar aquí.");
      }
      box.append(steps);
      const extra = [];
      if (isCreator() && creator?.link?.status === "approved") {
        const toggle = el("input", { type: "checkbox", checked: creator.publicProfile });
        toggle.addEventListener("change", () => act(toggle, () => api("/api/creators/public-profile", { on: toggle.checked }),
          (o) => (o.publicProfile ? "Tu perfil se muestra en la página de inicio." : "Tu perfil ya no se muestra en la página."), async () => { creator = null; }));
        extra.push(el("div", { class: "box" }, el("h2", {}, "Tu perfil en la página"),
          el("p", { class: "muted" }, "En la portada de skyeggs.pro hay un carrusel con los creadores del programa: tu nombre de Roblox, tu foto, tu nivel y las redes que pusiste al aplicar."),
          el("label", { class: "check" }, toggle, "Mostrar mi perfil en el carrusel")));
        if (creator.notices?.length) extra.push(el("div", { class: "box" }, el("h2", {}, "Avisos que te enviamos al buzón"),
          el("ul", { class: "list" }, ...creator.notices.map((x) => el("li", { class: "item" },
            el("div", { class: "item__head" }, el("span", { class: "item__title" }, noticeText(x.kind, x.param)), el("span", { class: "small muted" }, when(x.createdAt))))))));
      }
      const showSteps = isCreator() || (!staffRank() && !isMod());
      s.replaceChildren(...dash, ...(showSteps ? [box] : []), ...extra);
    },

    async aplicar(s) {
      const a = me.application;
      const box = el("div", { class: "box", id: "aplicar" }, el("h2", {}, "Aplica al programa"));
      if (a && a.status !== "rejected" && a.status !== "removed") {
        const map = { pending: ["pending", "En revisión", "Un moderador la revisará pronto y te escribirá por Discord."], contacted: ["contacted", "Contactado", "Un moderador te escribió por Discord. Revisa tus mensajes."], approved: ["approved", "Aprobada", "Espera a que te den el rol de Content Creator en Discord y vuelve a entrar en esta página."] };
        const [cls, label, text] = map[a.status];
        box.append(el("p", {}, "Estado de tu solicitud: ", pill(cls, label)), el("p", { class: "muted" }, text));
        if (a.review_note) box.append(el("p", {}, el("strong", {}, "Nota del moderador: "), a.review_note));
        return s.replaceChildren(box);
      }
      if (a?.status === "removed") box.append(el("div", { class: "notice notice--bad" }, `Saliste del programa${a.review_note ? `: ${a.review_note}` : "."} Puedes volver a aplicar cuando quieras.`));
      if (a?.status === "rejected") box.append(el("div", { class: "notice notice--bad" }, `Tu última solicitud fue rechazada${a.review_note ? `: ${a.review_note}` : "."} Puedes volver a aplicar 7 días después.`));
      const platformRow = (i) => el("div", { class: "row" },
        el("label", {}, "Red", el("select", { name: `ptype${i}` }, ...["YouTube", "TikTok", "Twitch", "Kick", "Instagram", "Facebook", "Otra"].map((p) => el("option", {}, p)))),
        el("label", {}, "Enlace a tu perfil o canal", el("input", { name: `purl${i}`, type: "url", placeholder: "https://…", maxlength: "400", required: i === 0 })),
        el("label", {}, "Seguidores", el("input", { name: `pfol${i}`, type: "number", min: "0", placeholder: "0" })));
      let account = null;
      const accountBox = el("div");
      const paintAccount = () => accountBox.replaceChildren(account
        ? el("div", { class: "form" }, el("label", {}, "Tu cuenta de Roblox"), accountChip(account, () => { account = null; paintAccount(); }), el("p", { class: "hint" }, "Un moderador confirmará que esta es tu cuenta."))
        : accountPicker((p) => { account = p; paintAccount(); }));
      paintAccount();
      const form = el("form", { class: "form" },
        accountBox,
        el("p", { class: "hint" }, "Tu Discord ya lo tenemos: es la cuenta con la que entraste. Tienes que haber jugado Sky Eggs al menos una vez."),
        platformRow(0), platformRow(1), platformRow(2),
        el("label", {}, "Correo (opcional)", el("input", { name: "email", type: "email", maxlength: "120" })),
        el("label", {}, "Un video tuyo de ejemplo (opcional)", el("input", { name: "sampleUrl", type: "url", placeholder: "https://…" })),
        el("label", {}, "Cuéntanos sobre ti y qué contenido harías de Sky Eggs", el("textarea", { name: "about", required: true, maxlength: "1000" })),
        el("label", { class: "check" }, el("input", { name: "age13", type: "checkbox", required: true }), "Tengo 13 años o más"),
        el("div", { class: "form-actions" }, el("button", { class: "btn btn--yolk", type: "submit" }, "Enviar solicitud")));
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        const f = new FormData(form);
        const platforms = [0, 1, 2].map((i) => ({ type: f.get(`ptype${i}`), url: f.get(`purl${i}`), followers: Number(f.get(`pfol${i}`)) || 0 })).filter((p) => p.url);
        if (!account) return flash(ERRORS.pick_account, "bad");
        act(e.submitter, () => api("/api/creators/apply", { robloxUserId: account.userId, email: f.get("email"), sampleUrl: f.get("sampleUrl"), about: f.get("about"), age13: f.get("age13") === "on", platforms }),
          "¡Solicitud enviada! Un moderador te escribirá por Discord.", async () => { me = await api("/api/me"); show("aplicar"); });
      });
      box.append(el("p", { class: "muted" }, "Un moderador revisa tu solicitud y te escribe por Discord para explicarte todo."), form);
      s.replaceChildren(box);
    },

    async metas(s) {
      creator = await api("/api/creators/me");
      const weekly = program.packs.filter((p) => p.period === "week");
      const monthly = program.packs.filter((p) => p.period === "month");
      const box = (title, period, packs, info, which) => {
        const max = packs[packs.length - 1].minViews;
        const pct = Math.min(100, (info.views / max) * 100);
        const track = el("div", { class: "track", role: "img", "aria-label": `${n(info.views)} de ${n(max)} vistas` },
          el("div", { class: "track__fill", "data-w": pct }),
          ...packs.map((p) => el("div", { class: `track__mark${info.views >= p.minViews ? " is-reached" : ""}`, "data-l": (p.minViews / max) * 100 }, el("span", {}, n(p.minViews)))));
        const next = packs.find((p) => info.views < p.minViews);
        const minVideos = packs[0].minVideos;
        const pack = info.best ? program.packs.find((p) => p.key === info.best) : null;
        const claim = el("div", { class: "claimbox" });
        if (info.claim) claim.append(el("span", {}, `✅ Reclamado: ${describe(program.packs.find((p) => p.key === info.claim.pack))}`));
        else if (!info.open) claim.append(el("span", { class: "muted" }, "Plazo cerrado."));
        else {
          const missingVideos = Math.max(0, minVideos - info.videos);
          const why = info.views >= packs[0].minViews && missingVideos
            ? `Ya tienes las vistas: te ${missingVideos === 1 ? "falta 1 video aprobado" : `faltan ${missingVideos} videos aprobados`}.`
            : `Aún sin meta. Necesitas ${minVideos} ${minVideos > 1 ? "videos aprobados" : "video aprobado"} y ${n(packs[0].minViews)} vistas.`;
          claim.append(el("span", {}, pack ? `Puedes reclamar: ${describe(pack)}` : why));
          const b = el("button", { class: "btn btn--yolk btn--sm", type: "button", disabled: !pack }, "Reclamar");
          b.addEventListener("click", () => {
            if (!confirm(`¿Reclamar ahora ${describe(pack)}? Solo se puede una vez por ${period === "week" ? "semana" : "mes"}.`)) return;
            act(b, () => api("/api/creators/claim", { period, which }), (o) => `¡Reclamado! Llega al buzón del juego de @${o.roblox}.`, () => show("metas"));
          });
          claim.append(b);
        }
        return el("div", { class: "goal" },
          el("div", { class: "goal__head" }, el("h3", {}, title), el("span", { class: "goal__views" }, `${n(info.views)} vistas`)),
          el("p", { class: "small muted" }, `${info.videos} ${info.videos === 1 ? "video aprobado" : "videos aprobados"}${info.pending ? ` · ${info.pending} en revisión` : ""} · ${info.current ? "termina" : "terminó"} el ${day(info.endsAt - 1)} · reclamar hasta el ${day(info.claimUntil - 1)}`),
          track,
          next && !info.claim ? el("p", { class: "small" }, `Siguiente meta: ${n(next.minViews)} vistas (te faltan ${n(next.minViews - info.views)}).`) : null,
          claim);
      };
      const wk = el("div", { class: "box" }, el("h2", {}, "Metas de la semana"),
        el("p", { class: "muted" }, "Cuentan las vistas de los videos aprobados publicados esa semana (lunes a domingo)."),
        box(`Esta semana (${creator.week.current.label})`, "week", weekly, creator.week.current, "current"));
      if (creator.week.previous.open && !creator.week.previous.claim && creator.week.previous.views > 0) wk.append(box(`Semana pasada (${creator.week.previous.label})`, "week", weekly, creator.week.previous, "previous"));
      const mo = el("div", { class: "box" }, el("h2", {}, "Meta del mes"),
        el("p", { class: "muted" }, "3 videos aprobados y 5.000 vistas en el mes."),
        box(`Este mes (${creator.month.current.label})`, "month", monthly, creator.month.current, "current"));
      if (creator.month.previous.open && !creator.month.previous.claim && creator.month.previous.views > 0) mo.append(box(`Mes pasado (${creator.month.previous.label})`, "month", monthly, creator.month.previous, "previous"));
      const warn = creator.link.status !== "approved" ? el("div", { class: "notice" }, "Para reclamar necesitas tu cuenta de Roblox vinculada y aprobada (pestaña Mi Roblox).") : null;
      const rankBox = creator.rank ? rankCard(creator.rank) : null;
      const hist = el("div", { class: "box" }, el("h2", {}, "Lo que ya reclamaste"),
        creator.claims.length ? el("table", { class: "tbl" }, el("thead", {}, el("tr", {}, el("th", {}, "Periodo"), el("th", {}, "Pack"), el("th", {}, "Vistas"), el("th", {}, "Fecha"))),
          el("tbody", {}, ...creator.claims.map((c) => el("tr", {}, el("td", {}, c.type === "week" ? `Semana ${c.key}` : `Mes ${c.key}`), el("td", {}, c.pack), el("td", {}, n(c.views)), el("td", {}, when(c.createdAt))))))
          : el("p", { class: "empty" }, "Todavía nada. ¡Sube tu primer video!"));
      s.replaceChildren(...[warn, rankBox, wk, mo, hist].filter(Boolean));
      // anchos por propiedades CSSOM (la CSP no permite style en línea)
      for (const f of s.querySelectorAll(".track__fill")) f.style.width = `${f.dataset.w}%`;
      for (const m of s.querySelectorAll(".track__mark")) m.style.left = `calc(${m.dataset.l}% - 2px)`;
    },

    async evidencias(s) {
      creator = await api("/api/creators/me");
      const today = new Date(Date.now() - 5 * 3600_000).toISOString().slice(0, 10);
      const form = el("form", { class: "form" },
        el("div", { class: "row" },
          el("label", {}, "Tipo", el("select", { name: "kind" }, el("option", { value: "video" }, "Video"), el("option", { value: "live" }, "Directo"))),
          el("label", {}, "Red", el("select", { name: "platform" }, ...["YouTube", "TikTok", "Twitch", "Kick", "Instagram", "Facebook", "Otra"].map((p) => el("option", {}, p)))),
          el("label", {}, "Publicado el", el("input", { name: "publishedOn", type: "date", required: true, value: today, max: today }))),
        el("label", {}, "Enlace del video o directo", el("input", { name: "url", type: "url", required: true, placeholder: "https://…", maxlength: "400" })),
        el("label", {}, "Título (opcional)", el("input", { name: "title", maxlength: "120" })),
        el("label", {}, "Captura de las estadísticas (opcional)", el("input", { name: "file", type: "file", accept: "image/png,image/jpeg,image/webp" })),
        el("label", {}, "Nota para el moderador (opcional)", el("textarea", { name: "note", maxlength: "500" })),
        el("div", { class: "form-actions" }, el("button", { class: "btn btn--yolk", type: "submit" }, "Subir evidencia")));
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        const f = new FormData(form);
        act(e.submitter, async () => {
          let file = null;
          const img = f.get("file");
          if (img && img.size) file = (await api("/api/creators/upload", {}, img)).file;
          return api("/api/creators/evidence", { kind: f.get("kind"), platform: f.get("platform"), publishedOn: f.get("publishedOn"), url: f.get("url"), title: f.get("title"), note: f.get("note"), file });
        }, "Evidencia enviada. Un moderador la revisará.", () => show("evidencias"));
      });
      const list = el("div", { class: "list" });
      const label = { pending: "En revisión", approved: "Aprobada", rejected: "Rechazada" };
      for (const ev of creator.evidences) {
        const actions = el("div", { class: "item__actions" });
        if (ev.status === "approved") {
          if (ev.track === "auto") { /* se cuentan solas */ }
          else if (!ev.recount) actions.append(el("button", { class: "btn btn--mini btn--white", type: "button", onclick: (e) => act(e.currentTarget, () => api("/api/creators/recount", { id: ev.id }), "Recuento pedido.", () => show("evidencias")) }, "Pedir recuento"));
          else actions.append(el("span", { class: "small muted" }, "Recuento pedido"));
          if (ev.bonus) actions.append(pill(ev.bonus.status, `Bono ${n(ev.bonus.robux)} R$: ${BONUS_LABEL[ev.bonus.status]}`));
          else if (ev.robuxEligible) actions.append(el("button", { class: "btn btn--mini btn--green", type: "button", onclick: (e) => act(e.currentTarget, () => api("/api/creators/bonus", { evidenceId: ev.id }), (o) => `Bono de ${n(o.robux)} Robux pedido.`, () => show("evidencias")) }, `Pedir bono de ${n(ev.robuxEligible)} R$`));
        }
        list.append(el("article", { class: "item" },
          el("div", { class: "item__head" }, el("span", { class: "item__title" }, `${ev.kind === "live" ? "🔴" : "🎬"} ${ev.title || ev.platform}`), pill(ev.status, label[ev.status])),
          el("p", { class: "item__meta" }, `${ev.platform} · publicado ${ev.publishedOn}${ev.status === "approved" ? ` · ${n(ev.views)} vistas` : ""} · `, link(ev.url, "abrir")),
          ev.status !== "rejected" ? el("p", { class: "item__meta" }, trackLine(ev)) : null,
          ev.reviewNote ? el("p", { class: "item__meta" }, `Nota: ${ev.reviewNote}`) : null,
          actions.childNodes.length ? actions : null));
      }
      s.replaceChildren(
        el("div", { class: "box" }, el("h2", {}, "Subir video o directo"),
          el("p", { class: "muted" }, "Tiene que ser de Sky Eggs y de tu canal. Un moderador lo revisa y lo aprueba."),
          el("p", { class: "small muted" }, "YouTube, TikTok, Twitch y Kick: las vistas se leen y se actualizan solas mientras el video cuente para un reclamo. Instagram, Facebook y otras: un moderador escribe las vistas (puedes pedir recuento)."),
          form),
        el("div", { class: "box" }, el("h2", {}, "Mis evidencias"), creator.evidences.length ? list : el("p", { class: "empty" }, "Aún no has subido nada.")));
    },

    async roblox(s) {
      creator = await api("/api/creators/me");
      const l = creator.link;
      const box = el("div", { class: "box" }, el("h2", {}, "Mi cuenta de Roblox"));
      if (l.status === "approved") {
        box.append(el("p", {}, "✅ Vinculada con ", el("strong", {}, `@${l.roblox.name}`), ` (${l.roblox.displayName}).`),
          el("p", { class: "muted" }, "Tus premios llegan al buzón de esta cuenta. Para cambiarla, habla con un moderador."));
        return s.replaceChildren(box);
      }
      if (l.status === "pending") {
        box.append(el("div", { class: "notice" }, "En revisión: un moderador confirmará que esta es tu cuenta."),
          accountChip({ ...l.roblox, avatar: null }));
      }
      if (l.status === "removed") {
        box.append(el("div", { class: "notice notice--bad" }, "Saliste del programa: para volver tienes que enviar una solicitud nueva (pestaña Aplicar)."));
        return s.replaceChildren(box);
      }
      if (l.status === "rejected") box.append(el("div", { class: "notice notice--bad" }, `La vinculación anterior fue rechazada${l.note ? `: ${l.note}` : "."} Puedes pedirla otra vez.`));
      box.append(
        el("p", { class: "muted mt" }, l.status === "pending" ? "¿Te equivocaste de cuenta? Elige la correcta:" : "Elige tu cuenta de Roblox. Tiene que haber jugado Sky Eggs al menos una vez."),
        accountPicker((p) => {
          if (!confirm(`¿Vincular @${p.name}? Un moderador confirmará que es tu cuenta.`)) return;
          act(document.activeElement, () => api("/api/creators/link", { userId: p.userId }), "Listo. Un moderador confirmará que es tu cuenta.", () => show("roblox"));
        }, "Busca tu cuenta (usuario o nombre visible)"));
      s.replaceChildren(box);
    },

    async bonos(s) {
      creator = await api("/api/creators/me");
      const r = program.robux;
      const bon = el("div", { class: "box" }, el("h2", {}, "Bono de Robux por video"),
        el("p", { class: "muted" }, `Desde ${n(r.minViews)} vistas: ${r.per10k} Robux por cada 10.000, hasta ${n(r.maxPerVideo)} por video. Se pide desde la evidencia aprobada; lo aprueba un moderador y luego el admin.`),
        creator.bonuses.length
          ? el("table", { class: "tbl" }, el("thead", {}, el("tr", {}, el("th", {}, "Vistas"), el("th", {}, "Robux"), el("th", {}, "Estado"), el("th", {}, "Fecha"))),
            el("tbody", {}, ...creator.bonuses.map((b) => el("tr", {}, el("td", {}, n(b.views)), el("td", {}, `${n(b.robux)} R$`), el("td", {}, pill(b.status, BONUS_LABEL[b.status])), el("td", {}, when(b.createdAt))))))
          : el("p", { class: "empty" }, "Aún no has pedido bonos."));
      const sp = el("div", { class: "box" }, el("h2", {}, "Pedido especial (100.000 vistas al mes)"),
        el("p", { class: "muted" }, "Puedes pedirle algo al admin: un pase, un Admin Abuse, un título, alguna ventaja… Se conversa para que sea justo y dentro de las reglas."));
      if (creator.specialAvailable) {
        const form = el("form", { class: "form" },
          el("p", {}, `🎉 Llegaste a ${n(creator.specialAvailable.views)} vistas en ${creator.specialAvailable.month}.`),
          el("label", {}, "¿Qué te gustaría?", el("textarea", { name: "request", required: true, maxlength: "800" })),
          el("div", { class: "form-actions" }, el("button", { class: "btn btn--yolk", type: "submit" }, "Enviar pedido al admin")));
        form.addEventListener("submit", (e) => { e.preventDefault(); act(e.submitter, () => api("/api/creators/special", { request: new FormData(form).get("request") }), "Pedido enviado al admin.", () => show("bonos")); });
        sp.append(form);
      }
      if (creator.specials.length) sp.append(el("div", { class: "list" }, ...creator.specials.map((x) => el("div", { class: "item" },
        el("div", { class: "item__head" }, el("span", { class: "item__title" }, `${x.month} · ${n(x.views)} vistas`), pill(x.status, SPECIAL_LABEL[x.status])),
        el("p", { class: "item__meta" }, x.request), x.note ? el("p", { class: "item__meta" }, `Admin: ${x.note}`) : null))));
      else if (!creator.specialAvailable) sp.append(el("p", { class: "empty" }, "Cuando un mes llegues a 100.000 vistas aprobadas, aquí podrás hacer tu pedido."));
      s.replaceChildren(bon, sp);
    },

    async comandos(s) {
      const box = el("div", { class: "box" }, el("h2", {}, "Comandos por nivel"),
        el("p", { class: "muted" }, "Se escriben en el chat del juego. Cada nivel tiene también los de los anteriores."));
      for (const lv of program.levels) {
        box.append(el("div", { class: "cmd-level" },
          el("h3", {}, `${lv.emoji} ${lv.name}`), el("p", { class: "small muted" }, lv.requirement),
          el("dl", {}, ...lv.commands.flatMap((c) => [el("dt", {}, c.cmd), el("dd", {}, c.desc)]))));
      }
      s.replaceChildren(box);
    },

    guia(s) {
      const boxes = [...$("guide-tpl").content.querySelectorAll(":scope > .box")];
      s.replaceChildren(...boxes.filter((b) => !b.dataset.role || (b.dataset.role === "admin" ? isAdmin() : isMod())).map((b) => b.cloneNode(true)));
    },

    "mod-solicitudes": modPage((b) => modApplications(b), "Solicitudes para entrar al programa de creadores."),
    "mod-vinculos": modPage((b) => modLinks(b), "Cambios de cuenta de Roblox que pidieron los creadores."),
    "mod-evidencias": modPage((b) => modEvidences(b), "Videos y directos por revisar, y recuentos de vistas."),
    "mod-bonos": modPage((b) => modBonuses(b, isAdmin()), "Bonos de Robux por video (moderador y luego admin)."),
    "mod-especiales": modPage((b) => modSpecials(b), "Pedidos especiales de creadores con 100.000 vistas al mes."),
    "mod-creadores": modPage((b) => modCreators(b)),
    "mod-avisos": modPage((b) => modNotices(b)),
    "mod-antiguos": modPage((b) => modLegacy(b)),
    "mod-registro": modPage((b) => modAudit(b), "Todo lo que hace el staff en esta página, con nombre y hora."),

    // ---------- Staff ----------
    "staff-aplicar": async (s) => staffApply(s),
    "staff-vincular": async (s) => staffLink(s),
    "staff-tareas": async (s) => staffTasks(s),
    "staff-excusas": async (s) => staffExcuses(s),
    "staff-excusas-revision": modPage((b) => staffExcuseReview(b), "Excusas de rangos inferiores. Si apruebas la de un mes que ya cerró sin cumplir, se le quita esa falta (y la salida, si estaba pendiente)."),
    "admin-staff-ajustes": async (s) => adminStaffSettings(s),
    "staff-guia": async (s) => staffGuide(s),
    "staff-reportes": modPage((b) => staffReports(b), "Reportes enviados desde el juego con ;Report. Resuélvelos con una nota de lo que hiciste."),
    "staff-revision": modPage((b) => staffReview(b), "Evidencias de tareas del staff de rango inferior al tuyo."),
    "staff-equipo": modPage((b) => staffTeam(b)),
    "staff-solicitudes": modPage((b) => staffApplications(b), "Solicitudes para ser Helper y cuentas de staff antiguo por confirmar."),
    "staff-ascensos": modPage((b) => staffPromotions(b), "Ascenso a Moderator Jr: lo aprueba un Moderator o el Admin. A Moderator: solo el Admin."),
    "staff-antiguos": modPage((b) => staffLegacy(b)),
    "admin-suerte": async (s) => adminLuck(s),
    "admin-discord": modPage((b) => adminDiscord(b), "Comprueba paso a paso que el bot pueda poner y quitar roles."),
  };

  // Buscador de cuenta: solo jugadores que ya entraron a Sky Eggs (como el del huevo de la página).
  const GAME_URL = "https://www.roblox.com/es/games/77372347150746/Huevos-del-cielo";
  function accountPicker(onPick, label = "Busca tu cuenta de Roblox (usuario o nombre visible)") {
    const results = el("div", { class: "picks" });
    const input = el("input", { required: true, minlength: "3", maxlength: "32", placeholder: "Ej: PepitoGamer", autocomplete: "off" });
    const search = async () => {
      const q = input.value.trim().replace(/^@/, "");
      if (q.length < 3) return results.replaceChildren(el("p", { class: "small muted" }, "Escribe al menos 3 letras."));
      results.replaceChildren(el("p", { class: "small muted" }, "Buscando…"));
      try {
        const r = await api(`/api/players/search?played=1&q=${encodeURIComponent(q)}`);
        if (!r.players.length) {
          return results.replaceChildren(el("div", { class: "notice" },
            "No encontramos esa cuenta entre los jugadores de Sky Eggs. Tienes que jugar Sky Eggs al menos una vez antes de aplicar: entra, juega unos minutos y vuelve aquí. ",
            el("a", { href: GAME_URL, target: "_blank", rel: "noopener" }, "Jugar Sky Eggs")));
        }
        results.replaceChildren(el("p", { class: "small muted" }, r.players.length === 1 ? "¿Eres tú?" : "¿Cuál eres tú?"),
          ...r.players.map((p) => el("button", { class: "pickrow", type: "button", onclick: () => { results.replaceChildren(); onPick(p); } },
            el("img", { src: p.avatar || "/img/icon-192.png", alt: "" }),
            el("span", {}, el("strong", {}, p.displayName), ` @${p.name}`), el("span", { class: "pick__go" }, "¡Soy yo!"))));
      } catch (e) { results.replaceChildren(el("p", { class: "notice notice--bad" }, errText(e))); }
    };
    const go = el("button", { class: "btn btn--sm btn--white", type: "button", onclick: search }, "Buscar");
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); search(); } });
    return el("div", { class: "form" }, el("label", {}, label, el("div", { class: "form-actions" }, input, go)), results);
  }
  const accountChip = (p, onChange) => el("div", { class: "pickrow", role: "group" },
    el("img", { src: p.avatar || "/img/icon-192.png", alt: "" }),
    el("span", {}, el("strong", {}, p.displayName), ` @${p.name}`),
    onChange ? el("button", { class: "linkbtn", type: "button", onclick: onChange }, "Cambiar") : null);

  const BONUS_LABEL = { pending_mod: "Espera moderador", pending_admin: "Espera al admin", approved: "Aprobado (por pagar)", paid: "Pagado", rejected: "Rechazado" };
  const SPECIAL_LABEL = { pending: "En revisión", approved: "Aprobado", rejected: "Rechazado", done: "Hecho" };
  const tierText = (rarity) => ({ Epic: "épica", Legendary: "legendaria", Mythic: "mítica" }[rarity] || rarity);
  const LEVEL_NAME = { Active: "Creator Activo", Viral: "Creator Viral", Star: "Creator Estrella", Elite: "Creator Elite" };
  function describe(p) {
    if (!p) return "";
    const pets = p.bonus.map((b) => `${b.q} ${b.q > 1 ? "mascotas" : "mascota"} ${tierText(b.rarity)}${b.q > 1 ? "s" : ""}`).join(" y ");
    return `${p.vipDays} días de VIP (o ${p.boostHours} h de boost), ${pets}${p.level ? `, sube a ${LEVEL_NAME[p.level]}` : ""}`;
  }

  // ---------- Moderación: vistas ----------
  const userLine = (u) => (u ? `${u.globalName || u.username} · Discord @${u.username}` : "usuario desconocido");
  const day2 = (t) => new Date(t).toLocaleDateString("es-CO", { day: "numeric", month: "short", year: "numeric" });
  // Cuenta de Roblox elegida por el creador, con lo que sabemos de ella por el juego.
  const robloxLine = (id, name, display, player) => el("p", { class: "item__meta" }, "Roblox: ",
    link(`https://www.roblox.com/users/${id}/profile`, `@${name}${display && display !== name ? ` (${display})` : ""}`),
    ` · id ${id}`, player ? ` · juega desde ${day2(player.firstSeen)} · nivel ${player.level ?? "?"} · última vez ${day2(player.lastSeen)}` : "");
  const refreshMod = () => show(current);
  const noteInput = (ph = "Nota (se guarda en el registro)") => el("input", { class: "wide", placeholder: ph, maxlength: "500" });
  const btn = (text, cls, fn) => el("button", { class: `btn btn--mini ${cls}`, type: "button", onclick: (e) => fn(e.currentTarget) }, text);
  const empty = (t) => el("p", { class: "empty" }, t);

  function modApplications(body) {
    const items = queue.applications.map((a) => {
      const note = noteInput();
      return el("article", { class: "item" },
        el("div", { class: "item__head" }, el("span", { class: "item__title" }, `${userLine(a.user)}`), pill(a.status, a.status === "contacted" ? "Contactado" : "Nueva")),
        a.roblox_user_id ? robloxLine(a.roblox_user_id, a.roblox_name, null, a.player) : el("p", { class: "item__meta" }, `Roblox: ${a.roblox_name}`),
        el("p", { class: "item__meta" }, `${a.email ? `${a.email} · ` : ""}enviada ${when(a.created_at)}`),
        el("ul", { class: "item__meta" }, ...a.platforms.map((p) => el("li", {}, `${p.type}: `, link(p.url, p.url), p.followers ? ` · ${n(p.followers)} seguidores` : ""))),
        a.sample_url ? el("p", { class: "item__meta" }, "Video de ejemplo: ", link(a.sample_url, a.sample_url)) : null,
        el("p", { class: "item__meta" }, a.about),
        a.review_note ? el("p", { class: "item__meta" }, `Nota (${a.reviewed_by}): ${a.review_note}`) : null,
        el("div", { class: "item__actions" }, note,
          a.status === "pending" ? btn("Contactado", "btn--white", (b) => act(b, () => api("/api/mod/application", { id: a.id, action: "contacted", note: note.value }), "Marcada como contactada.", refreshMod)) : null,
          btn("Aprobar (y confirmar su Roblox)", "btn--green", (b) => act(b, () => api("/api/mod/application", { id: a.id, action: "approve", note: note.value }), (o) => `Aprobada${o.linked ? " y cuenta de Roblox vinculada" : ""}. ${o.discordRole === "ok" ? "El rol de Content Creator se puso solo en Discord." : o.discordRole === "error" ? "No se pudo poner el rol en Discord: dáselo a mano." : "Dale el rol de Content Creator en Discord."} El rango Creator y el correo de bienvenida llegan solos al juego.`, refreshMod)),
          btn("Rechazar", "btn--red", (b) => { if (!note.value.trim()) return flash("Escribe el motivo en la nota.", "bad"); act(b, () => api("/api/mod/application", { id: a.id, action: "reject", note: note.value }), (o) => `Rechazada.${o.discordRole === "removed" ? " Se le quitó el rol de Content Creator en Discord." : o.discordRole === "error" ? " No se pudo quitar el rol en Discord: hazlo a mano si lo tenía." : ""} Si tenía rango en el juego, se le quita al entrar.`, refreshMod); })));
    });
    body.replaceChildren(...(items.length ? [el("div", { class: "list" }, ...items)] : [empty("No hay solicitudes pendientes.")]));
  }

  function modLinks(body) {
    const items = queue.links.map((c) => {
      const note = noteInput();
      return el("article", { class: "item" },
        el("div", { class: "item__head" }, el("span", { class: "item__title" }, userLine(c.user)), pill("pending", "Confirmar cuenta")),
        robloxLine(c.roblox_user_id, c.roblox_name, c.roblox_display, c.player),
        el("p", { class: "item__meta" }, `Pedido ${when(c.link_requested_at)}. Confirma con el creador (por Discord o en el juego) que esa es su cuenta.`),
        el("div", { class: "item__actions" }, note,
          btn("Aprobar", "btn--green", (b) => act(b, () => api("/api/mod/link", { discordId: c.discord_id, action: "approve", note: note.value }), "Vinculación aprobada.", refreshMod)),
          btn("Rechazar", "btn--red", (b) => { if (!note.value.trim()) return flash("Escribe el motivo en la nota.", "bad"); act(b, () => api("/api/mod/link", { discordId: c.discord_id, action: "reject", note: note.value }), "Vinculación rechazada.", refreshMod); })));
    });
    body.replaceChildren(...(items.length ? [el("div", { class: "list" }, ...items)] : [empty("No hay vinculaciones pendientes.")]));
  }

  function modEvidences(body) {
    const items = queue.evidences.map((e) => {
      const views = el("input", { type: "number", min: "0", placeholder: "Vistas fijas", value: e.status === "approved" ? String(e.views) : "" });
      const note = noteInput();
      const recount = e.status === "approved";
      const meta = e.auto_meta || {};
      const canAuto = e.auto_views != null;
      const action = recount ? "update" : "approve";
      const dateWarn = meta.uploadDate && meta.uploadDate !== e.published_on ? ` ⚠️ el creador puso ${e.published_on}` : "";
      return el("article", { class: "item" },
        el("div", { class: "item__head" }, el("span", { class: "item__title" }, `${e.kind === "live" ? "🔴 Directo" : "🎬 Video"} · ${userLine(e.user)}`), pill(recount ? "pending_mod" : "pending", recount ? `Revisar vistas (ahora ${n(e.views)})` : "Nueva")),
        el("p", { class: "item__meta" }, `${e.platform} · publicado ${e.published_on}${e.title ? ` · ${e.title}` : ""} · `, link(e.url, "abrir enlace")),
        canAuto ? el("p", { class: "item__meta" }, `🔎 Leído de la plataforma: ${n(e.auto_views)} vistas`, meta.channel ? ` · canal “${meta.channel}”` : "", meta.uploadDate ? ` · publicado ${meta.uploadDate}${dateWarn}` : "", ` · ${ago(e.auto_checked_at)}`) : null,
        el("p", { class: "item__meta" }, trackLine(e)),
        e.note ? el("p", { class: "item__meta" }, `Nota del creador: ${e.note}`) : null,
        e.file ? el("a", { href: `/api/files/${e.file}`, target: "_blank", rel: "noopener" }, el("img", { class: "proof", src: `/api/files/${e.file}`, alt: "Captura de estadísticas" })) : null,
        el("div", { class: "item__actions" },
          canAuto ? btn(recount ? "Usar automáticas" : "Aprobar con vistas automáticas", "btn--green", (b) =>
            act(b, () => api("/api/mod/evidence", { id: e.id, action, mode: "auto", note: note.value }), "Aprobada: las vistas se actualizan solas.", refreshMod)) : null,
          e.platform !== "Instagram" && e.platform !== "Facebook" ? btn("Volver a leer", "btn--white", (b) =>
            act(b, () => api("/api/mod/evidence/probe", { id: e.id }), (o) => (o.ok ? `Leídas: ${n(o.views)} vistas.` : `No se pudieron leer: ${o.error}`), refreshMod)) : null),
        el("div", { class: "item__actions" }, views, note,
          btn(recount ? "Fijar vistas" : "Aprobar con vistas fijas", canAuto ? "btn--white" : "btn--green", (b) => {
            if (views.value === "") return flash("Escribe las vistas que tiene ahora.", "bad");
            act(b, () => api("/api/mod/evidence", { id: e.id, action, mode: "fixed", views: Number(views.value), note: note.value }), recount ? "Vistas fijadas." : "Evidencia aprobada con vistas fijas.", refreshMod);
          }),
          recount ? null : btn("Rechazar", "btn--red", (b) => { if (!note.value.trim()) return flash("Escribe el motivo en la nota.", "bad"); act(b, () => api("/api/mod/evidence", { id: e.id, action: "reject", note: note.value }), "Evidencia rechazada.", refreshMod); })));
    });
    body.replaceChildren(...(items.length ? [el("div", { class: "list" }, ...items)] : [empty("No hay evidencias por revisar.")]));
  }

  function modBonuses(body, admin) {
    const items = queue.bonuses.map((b) => {
      const note = noteInput();
      const acts = [];
      if (b.status === "pending_mod") acts.push(btn("Aprobar (moderador)", "btn--green", (x) => act(x, () => api("/api/mod/bonus", { id: b.id, action: "approve", note: note.value }), "Aprobado. Pasa al admin.", refreshMod)));
      if (admin && b.status === "pending_admin") acts.push(btn("Aprobación final", "btn--green", (x) => act(x, () => api("/api/mod/bonus", { id: b.id, action: "approve", note: note.value }), "Aprobado. Paga desde el grupo y márcalo pagado.", refreshMod)));
      if (admin && b.status === "approved") acts.push(btn("Marcar pagado", "btn--yolk", (x) => { if (!confirm(`¿Ya pagaste ${b.robux} Robux?`)) return; act(x, () => api("/api/mod/bonus", { id: b.id, action: "paid", note: note.value }), "Marcado como pagado.", refreshMod); }));
      acts.push(btn("Rechazar", "btn--red", (x) => { if (!note.value.trim()) return flash("Escribe el motivo en la nota.", "bad"); act(x, () => api("/api/mod/bonus", { id: b.id, action: "reject", note: note.value }), "Bono rechazado.", refreshMod); }));
      return el("article", { class: "item" },
        el("div", { class: "item__head" }, el("span", { class: "item__title" }, `${n(b.robux)} R$ · ${userLine(b.user)}`), pill(b.status, BONUS_LABEL[b.status])),
        el("p", { class: "item__meta" }, `${n(b.views)} vistas · ${b.platform} · ${b.published_on} · `, link(b.url, "abrir video")),
        b.mod_by ? el("p", { class: "item__meta" }, `Moderador: ${b.mod_by} (${when(b.mod_at)})${b.admin_by ? ` · Admin: ${b.admin_by}` : ""}`) : null,
        b.note ? el("p", { class: "item__meta" }, `Nota: ${b.note}`) : null,
        el("div", { class: "item__actions" }, note, ...acts));
    });
    body.replaceChildren(...(items.length ? [el("div", { class: "list" }, ...items)] : [empty("No hay bonos pendientes.")]));
  }

  function modSpecials(body) {
    const items = queue.specials.map((x) => {
      const note = noteInput("Lo acordado con el creador");
      return el("article", { class: "item" },
        el("div", { class: "item__head" }, el("span", { class: "item__title" }, `${userLine(x.user)} · ${x.month} · ${n(x.views)} vistas`), pill(x.status, SPECIAL_LABEL[x.status])),
        el("p", { class: "item__meta" }, x.request),
        x.review_note ? el("p", { class: "item__meta" }, `Acordado: ${x.review_note}`) : null,
        el("div", { class: "item__actions" }, note,
          x.status === "pending" ? btn("Aprobar", "btn--green", (b) => act(b, () => api("/api/mod/special", { id: x.id, action: "approve", note: note.value }), "Aprobado.", refreshMod)) : null,
          x.status === "approved" ? btn("Hecho", "btn--yolk", (b) => act(b, () => api("/api/mod/special", { id: x.id, action: "done", note: note.value }), "Marcado como hecho.", refreshMod)) : null,
          btn("Rechazar", "btn--red", (b) => act(b, () => api("/api/mod/special", { id: x.id, action: "reject", note: note.value }), "Rechazado.", refreshMod))));
    });
    body.replaceChildren(...(items.length ? [el("div", { class: "list" }, ...items)] : [empty("No hay pedidos especiales.")]));
  }

  // ---------- Rangos, avisos y panel de creadores ----------
  const LEVEL_ORDER = ["Creator", "Active", "Viral", "Star", "Elite"];
  const levelOf = (key) => program.levels.find((l) => l.key === key);
  const levelName = (key) => (key === "None" ? "Sin rango" : levelOf(key)?.name || key || "—");
  const NOTICE_TEXT = {
    welcome: () => "🎬 Bienvenida al programa (rango Creator)",
    promoted: (p) => `⬆️ Subió a ${levelName(p)}`,
    demotion_warning: (p) => `⚠️ Aviso: sin video esta semana, puede bajar de ${levelName(p)}`,
    demoted: (p) => `⬇️ Bajó de ${levelName(p)} a Creator (semana sin videos)`,
    removal_warning: () => "🚨 Aviso: segunda semana sin video, saldrá del programa el domingo",
    removed_inactive: () => "🚪 Salió del programa: 2 semanas seguidas sin videos",
    rejected: () => "❌ Solicitud rechazada: rango del juego quitado",
    legacy_join: (p) => `📨 Creador antiguo: aplicar antes del ${p}`,
    legacy_removed: (p) => (p === "rejected" ? "❌ Rango quitado: solicitud rechazada" : "❌ Rango quitado: no aplicó a tiempo"),
    removed: () => "❌ Sacado del programa",
    tier_set: (p) => `✏️ Rango cambiado a ${levelName(p)}`,
  };
  const noticeText = (kind, param) => (NOTICE_TEXT[kind] ? NOTICE_TEXT[kind](param) : kind);
  const DELIVERY = { pending: ["pending", "Espera a que entre al juego"], delivered: ["approved", "En su buzón"], cancelled: ["rejected", "Cancelado"] };

  function rankCard(r) {
    const idx = LEVEL_ORDER.indexOf(r.tier);
    const next = program.levels[idx + 1];
    const lv = levelOf(r.tier);
    const box = el("div", { class: "box" }, el("h2", {}, `Tu nivel: ${lv ? `${lv.emoji} ${lv.name}` : "—"}`));
    if (next) {
      const pct = Math.min(100, (r.weekViews / next.minWeekViews) * 100);
      box.append(el("p", {}, `Esta semana llevas ${n(r.weekViews)} vistas aprobadas. Con ${n(next.minWeekViews)} subes a ${next.emoji} ${next.name} (te faltan ${n(Math.max(0, next.minWeekViews - r.weekViews))}).`),
        el("div", { class: "track", role: "img", "aria-label": `${n(r.weekViews)} de ${n(next.minWeekViews)} vistas` }, el("div", { class: "track__fill", "data-w": pct })));
    } else box.append(el("p", {}, "¡Estás en el nivel más alto! Mantén al menos un video por semana."));
    if (idx > 0 || r.idleWeeks >= 1) {
      box.append(r.weekVideos > 0
        ? el("p", { class: "small muted" }, `✅ Ya subiste ${r.weekVideos} ${r.weekVideos === 1 ? "video" : "videos"} esta semana: conservas tu nivel.`)
        : el("div", { class: "notice notice--bad" }, `Aún no subes ningún video esta semana. Si llega el domingo ${day(r.weekEndsAt - 1)} sin video, vuelves a Creator.`));
    }
    if (r.idleWeeks >= 1 && r.weekVideos === 0) box.append(el("div", { class: "notice notice--bad" }, `🚨 La semana pasada no subiste videos. Si esta semana tampoco subes ninguno (antes del domingo ${day(r.weekEndsAt - 1)}), sales del programa y tendrás que volver a aplicar.`));
    box.append(el("p", { class: "small muted" }, "Los niveles suben solos con las vistas de la semana (lunes a domingo). El juego y Discord se actualizan solos y te llega un correo al buzón."));
    return box;
  }

  // Barras simples (una serie): vistas aprobadas por semana. Tooltip nativo + tabla accesible.
  function weekBars(weeks, label = "Vistas aprobadas por semana") {
    const max = Math.max(1, ...weeks.map((w) => w.views));
    const fig = el("figure", { class: "bars" }, el("figcaption", { class: "small muted" }, label));
    const row = el("div", { class: "bars__row", role: "img", "aria-label": weeks.map((w) => `${w.label}: ${n(w.views)}`).join("; ") });
    for (const w of weeks) {
      const bar = el("div", { class: "bars__bar", "data-h": Math.max(2, (w.views / max) * 100), title: `${w.label}: ${n(w.views)} vistas · ${w.videos} videos` });
      row.append(el("div", { class: "bars__col" }, el("span", { class: "bars__val" }, w.views ? n(w.views) : ""), bar, el("span", { class: "bars__lbl" }, w.label.split(" – ")[0])));
    }
    fig.append(row);
    requestAnimationFrame(() => { for (const b of row.querySelectorAll(".bars__bar")) b.style.height = `${b.dataset.h}%`; });
    return fig;
  }
  const tile = (value, label, kind) => el("div", { class: `tile${kind ? ` tile--${kind}` : ""}` }, el("strong", {}, value), el("span", {}, label));

  async function modCreators(body) {
    const d = await api("/api/mod/creators");
    const s = d.summary;
    const tiles = el("div", { class: "tiles" },
      tile(String(s.creators), "creadores activos"),
      tile(n(s.weekViews), `vistas esta semana (${d.week.label})`),
      tile(n(s.monthViews), `vistas en ${d.month}`),
      tile(String(s.weekVideos), "videos esta semana"),
      tile(String(s.atRisk), "en riesgo de bajar", s.atRisk ? "warn" : null),
      tile(String(s.pendingEvidences), "evidencias por revisar"),
      tile(`${n(s.robuxPaid)} R$`, "bonos pagados"),
      tile(d.bot ? "Automático" : "A mano", "roles de Discord", d.bot ? null : "warn"));
    const tiers = el("div", { class: "tiers" }, ...LEVEL_ORDER.map((k) => {
      const lv = levelOf(k);
      const chip = el("span", { class: "tierchip" }, `${lv.emoji} ${lv.name}: ${s.byTier[k] || 0}`);
      chip.style.setProperty("--tier", lv.color);
      return chip;
    }));
    const plat = d.platforms.length ? el("table", { class: "tbl" }, el("thead", {}, el("tr", {}, el("th", {}, "Red"), el("th", {}, "Videos (mes)"), el("th", {}, "Vistas (mes)"))),
      el("tbody", {}, ...d.platforms.map((p) => el("tr", {}, el("td", {}, p.platform), el("td", {}, String(p.videos)), el("td", {}, n(p.views)))))) : empty("Aún no hay videos aprobados este mes.");

    const filter = el("input", { class: "wide", placeholder: "Buscar por Discord, Roblox o red…", type: "search" });
    const tierFilter = el("select", {}, el("option", { value: "" }, "Todos los rangos"), ...LEVEL_ORDER.map((k) => el("option", { value: k }, levelName(k))), el("option", { value: "risk" }, "En riesgo"), el("option", { value: "other" }, "Sin aprobar / fuera"));
    const tableBox = el("div", { class: "scrollx" });
    const detailBox = el("div");
    const label = { approved: "Vinculado", pending: "En revisión", rejected: "Rechazado", removed: "Salió del programa", none: "Sin vincular" };
    const paint = () => {
      const q = filter.value.trim().toLowerCase();
      const tf = tierFilter.value;
      const rows = d.creators.filter((c) => {
        if (tf === "risk" && !c.atRisk) return false;
        if (tf === "other" && c.linkStatus === "approved" && c.tier !== "None") return false;
        if (tf && tf !== "risk" && tf !== "other" && c.tier !== tf) return false;
        if (!q) return true;
        return [c.discord, c.roblox?.name, c.roblox?.displayName, ...c.platforms.map((p) => `${p.type} ${p.url}`)].join(" ").toLowerCase().includes(q);
      });
      tableBox.replaceChildren(rows.length ? el("table", { class: "tbl tbl--creators" },
        el("thead", {}, el("tr", {}, ...["Creador", "Roblox", "Rango", "Redes", "Semana", "Sem. pasada", "Mes", "Total", "Último video", "Estado", ""].map((h) => el("th", {}, h)))),
        el("tbody", {}, ...rows.map((c) => {
          const lv = c.tier && levelOf(c.tier);
          const mismatch = c.tier && c.gameTier && c.gameTier !== c.tier;
          return el("tr", { class: c.atRisk ? "is-risk" : null },
            el("td", {}, c.discord),
            el("td", {}, c.roblox ? link(`https://www.roblox.com/users/${c.roblox.userId}/profile`, `@${c.roblox.name}`) : "—", c.roblox ? el("div", { class: "small muted" }, `${label[c.linkStatus] || c.linkStatus}${c.level != null ? ` · nivel ${c.level}` : ""}${c.lastSeen ? ` · jugó ${ago(c.lastSeen)}` : ""}`) : null),
            el("td", {}, lv ? `${lv.emoji} ${lv.name}` : levelName(c.tier), mismatch ? el("div", { class: "small muted" }, `En el juego: ${levelName(c.gameTier)}`) : null,
              c.next ? el("div", { class: "small muted" }, `Faltan ${n(c.next.missing)} para ${c.next.name}`) : null),
            el("td", {}, ...(c.platforms.length ? c.platforms.map((p) => el("div", {}, link(p.url, p.type), p.followers ? ` · ${n(p.followers)}` : "")) : ["—"])),
            el("td", {}, n(c.weekViews), el("div", { class: "small muted" }, `${c.weekVideos} videos`)),
            el("td", {}, n(c.prevWeekViews)),
            el("td", {}, n(c.monthViews), el("div", { class: "small muted" }, `${c.monthVideos} videos`)),
            el("td", {}, n(c.totalViews), el("div", { class: "small muted" }, `${c.totalVideos} videos · ${n(c.robuxPaid)} R$`)),
            el("td", {}, c.lastVideo || "—"),
            el("td", {}, c.atRisk ? pill(c.warned ? "pending_mod" : "pending", c.idleWeeks >= 1 ? (c.warned ? "Avisado: saldrá del programa" : "2.ª semana sin video") : c.warned ? "Avisado: sin video" : "Sin video esta semana") : c.linkStatus === "approved" && c.tier !== "None" ? pill("approved", "Al día") : pill("rejected", c.tier === "None" ? "Fuera" : label[c.linkStatus] || "—"),
              c.pendingEvidences ? el("div", { class: "small muted" }, `${c.pendingEvidences} por revisar`) : null),
            el("td", {}, btn("Ver", "btn--white", () => showCreator(detailBox, c))));
        }))) : empty("Nadie coincide con el filtro."));
    };
    filter.addEventListener("input", paint);
    tierFilter.addEventListener("change", paint);
    paint();
    body.replaceChildren(
      el("p", { class: "small muted" }, `Los rangos suben solos con las vistas semanales (Activo ${n(3000)}, Viral ${n(3500)}, Estrella ${n(4500)}, Elite ${n(5000)}) bajan a Creator tras una semana sin videos y con 2 semanas seguidas sin videos el creador sale del programa (pierde el rango y el rol de Discord y tiene que volver a aplicar). Fecha límite de los creadores antiguos: ${new Date(s.legacyDeadline).toLocaleDateString("es-CO", { dateStyle: "long" })}.`),
      tiles, tiers, el("div", { class: "split" }, el("div", {}, weekBars(d.weeks)), el("div", {}, el("h3", {}, "Redes este mes"), plat)),
      el("h3", { class: "mt" }, "Todos los creadores"), el("div", { class: "form-actions" }, filter, tierFilter), tableBox, detailBox);
  }

  async function showCreator(box, c) {
    box.replaceChildren(el("p", { class: "small muted" }, "Cargando…"));
    const d = await api(`/api/mod/creator?discordId=${encodeURIComponent(c.discordId)}`).catch((e) => { flash(errText(e), "bad"); return null; });
    if (!d) return box.replaceChildren();
    const select = el("select", {}, ...LEVEL_ORDER.map((k) => el("option", { value: k, selected: k === c.tier }, levelName(k))), el("option", { value: "None", selected: c.tier === "None" }, "Sacar del programa (sin rango)"));
    const card = el("div", { class: "box detail" },
      el("div", { class: "item__head" }, el("h3", {}, `${c.discord}${c.roblox ? ` · @${c.roblox.name}` : ""}`), btn("Cerrar", "btn--white", () => box.replaceChildren())),
      weekBars(d.history, "Sus vistas aprobadas por semana (las barras vacías son semanas sin vistas)"),
      c.linkStatus === "approved" ? el("div", { class: "item__actions" }, el("span", {}, "Cambiar rango a mano: "), select,
        btn("Guardar", "btn--yolk", (b) => {
          if (select.value === c.tier) return flash("Ya tiene ese rango.", "bad");
          if (select.value === "None" && !confirm("¿Sacarlo del programa? Pierde el rango en el juego y en Discord.")) return;
          act(b, () => api("/api/mod/creator/tier", { discordId: c.discordId, tier: select.value }),
            (o) => `Rango cambiado. ${o.discord === "ok" ? "Discord actualizado." : o.discord === "error" ? "No se pudo cambiar en Discord: hazlo a mano." : "Cambia el rol de Discord a mano."} El juego lo aplica cuando entre.`, () => modCreators(box.parentElement));
        })) : null,
      el("h3", {}, "Avisos al buzón"),
      d.notices.length ? el("ul", { class: "list" }, ...d.notices.map((x) => el("li", { class: "item" },
        el("div", { class: "item__head" }, el("span", { class: "item__title" }, noticeText(x.kind, x.param)), pill(...(DELIVERY[x.delivery] || ["pending", x.delivery || "—"]))),
        el("p", { class: "item__meta" }, `${when(x.createdAt)} · ${x.actor || "Sistema"}${x.deliveredAt ? ` · entregado ${when(x.deliveredAt)}` : ""}`)))) : empty("Sin avisos todavía."),
      el("h3", {}, "Evidencias"),
      d.evidences.length ? el("table", { class: "tbl" }, el("thead", {}, el("tr", {}, ...["Fecha", "Red", "Video", "Estado", "Vistas"].map((h) => el("th", {}, h)))),
        el("tbody", {}, ...d.evidences.map((e) => el("tr", {}, el("td", {}, e.publishedOn), el("td", {}, e.platform), el("td", {}, link(e.url, e.title || "abrir")), el("td", {}, { pending: "En revisión", approved: "Aprobada", rejected: "Rechazada" }[e.status] || e.status), el("td", {}, n(e.views))))))
        : empty("No ha subido evidencias."));
    box.replaceChildren(card);
    card.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function modNotices(body) {
    const { notices } = await api("/api/mod/notices?limit=300");
    body.replaceChildren(el("p", { class: "small muted" }, "Todo lo que el sistema o un moderador le mandó a cada creador por el buzón del juego. “Espera a que entre al juego” = le llega la próxima vez que se conecte."),
      notices.length ? el("div", { class: "scrollx" }, el("table", { class: "tbl" },
        el("thead", {}, el("tr", {}, ...["Cuándo", "Jugador", "Aviso", "Quién", "Entrega"].map((h) => el("th", {}, h)))),
        el("tbody", {}, ...notices.map((x) => el("tr", {},
          el("td", {}, when(x.created_at)),
          el("td", {}, x.roblox_name ? link(`https://www.roblox.com/users/${x.roblox_user_id}/profile`, `@${x.roblox_name}`) : `#${x.roblox_user_id}`, x.discord_username ? el("div", { class: "small muted" }, `Discord @${x.discord_username}`) : null),
          el("td", {}, noticeText(x.kind, x.param)),
          el("td", {}, x.actor || "Sistema"),
          el("td", {}, pill(...(DELIVERY[x.delivery] || ["pending", x.delivery || "—"])), x.delivered_at ? el("div", { class: "small muted" }, when(x.delivered_at)) : null))))))
        : empty("Todavía no se ha enviado ningún aviso."));
  }

  async function modLegacy(body) {
    const { legacy, deadline, days } = await api("/api/mod/legacy");
    const STATUS = { notified: ["pending", "Avisado"], applied: ["contacted", "Aplicó"], approved: ["approved", "Aprobado"], removed: ["rejected", "Rango quitado"] };
    body.replaceChildren(
      el("div", { class: "notice" }, `Jugadores que ya tenían el rango de creador en el juego sin pasar por esta página. Al entrar al juego reciben un aviso y tienen ${days} días para aplicar; si no, pierden el rango. Fecha límite para todos: ${new Date(deadline).toLocaleDateString("es-CO", { dateStyle: "long" })}. Quien aplicó a tiempo conserva el rango mientras revisan su solicitud (apruébala o recházala en “Solicitudes”).`),
      legacy.length ? el("div", { class: "scrollx" }, el("table", { class: "tbl" },
        el("thead", {}, el("tr", {}, ...["Jugador", "Nivel que tenía", "Estado", "Avisado", "Plazo", "Solicitud", "Última vez"].map((h) => el("th", {}, h)))),
        el("tbody", {}, ...legacy.map((l) => el("tr", {},
          el("td", {}, link(`https://www.roblox.com/users/${l.roblox_user_id}/profile`, `@${l.name}`)),
          el("td", {}, levelName(LEVEL_ORDER[l.game_tier - 1])),
          el("td", {}, pill(...(STATUS[l.status] || ["pending", l.status]))),
          el("td", {}, when(l.notified_at)),
          el("td", {}, l.status === "notified" ? `${when(l.deadline_at)} (${l.deadline_at > Date.now() ? `faltan ${Math.ceil((l.deadline_at - Date.now()) / 3_600_000)} h` : "vencido: se quita al entrar"})` : "—"),
          el("td", {}, l.app_status || "sin solicitud"),
          el("td", {}, l.last_seen ? ago(l.last_seen) : "—"))))))
        : empty("Aún no ha entrado al juego ningún creador antiguo (se detectan al conectarse)."));
  }

  const ACTION_TEXT = {
    "application.approve": "aprobó la solicitud de", "application.reject": "rechazó la solicitud de", "application.contacted": "contactó a",
    "link.approve": "aprobó la vinculación de", "link.reject": "rechazó la vinculación de",
    "evidence.approve": "aprobó una evidencia de", "evidence.probe": "volvió a leer las vistas de una evidencia", "evidence.reject": "rechazó una evidencia de", "evidence.update": "actualizó las vistas de",
    "bonus.approve": "aprobó un bono de", "bonus.reject": "rechazó un bono de", "bonus.paid": "pagó el bono de",
    "special.approve": "aprobó el pedido de", "special.reject": "rechazó el pedido de", "special.done": "cumplió el pedido de",
    claim: "reclamó un pack para", "codes.create": "generó códigos", "gift.send": "envió un regalo a", upload: "subió una captura",
    "tier.promoted": "subió de rango a", "tier.demoted": "bajó de rango a", "tier.tier_set": "cambió el rango de", "tier.removed": "sacó del programa a",
    "legacy.notified": "avisó al creador antiguo", "legacy.removed": "quitó el rango al creador antiguo",
    "discord.roles": "actualizó los roles de Discord de", "discord.roles_error": "no pudo cambiar los roles de Discord de",
  };
  async function modAudit(body) {
    const { audit } = await api("/api/mod/audit?limit=200");
    body.replaceChildren(audit.length ? el("div", { class: "scrollx" }, el("table", { class: "tbl" },
      el("thead", {}, el("tr", {}, el("th", {}, "Cuándo"), el("th", {}, "Quién"), el("th", {}, "Qué"), el("th", {}, "Detalles"))),
      el("tbody", {}, ...audit.map((a) => el("tr", {},
        el("td", {}, when(a.ts)), el("td", {}, `${a.actor_name} (${a.actor_role})`),
        el("td", {}, `${ACTION_TEXT[a.action] || a.action} ${a.target || ""}`),
        el("td", { class: "small" }, a.details ? Object.entries(a.details).filter(([, v]) => v != null && v !== "").map(([k, v]) => `${k}: ${v}`).join(" · ") : ""))))))
      : empty("El registro está vacío."));
  }

  // ======================================================================
  // ---------- Programa de staff ----------
  // ======================================================================
  const RANK_NAME = { Helper: "Helper", ModeratorJr: "Moderator Jr", Moderator: "Moderator", None: "Fuera del staff" };
  const rankPill = (r) => el("span", { class: `pill pill--rank pill--${r || "None"}` }, RANK_NAME[r] || r || "—");
  const hours = (v) => `${String(v ?? 0).replace(".", ",")} h`;

  async function staffApply(s) {
    const st = await api("/api/staff/me");
    const a = st.application;
    const box = el("div", { class: "box" }, el("h2", {}, "Aplica para ser Helper"),
      el("p", { class: "muted" }, "Helper es la entrada al staff de Sky Eggs. Ayudas a los jugadores en el juego y en Discord, tienes comandos propios y puedes ascender a Moderator Jr y Moderator. Mira todo el programa en "),
      el("p", {}, el("a", { href: "/staff/", target: "_blank", rel: "noopener" }, "skyeggs.pro/staff →")));
    if (st.staff && st.staff.rank !== "None" && st.staff.linkStatus === "approved") return s.replaceChildren(el("div", { class: "notice" }, `Ya eres ${RANK_NAME[st.staff.rank]}.`));
    if (a && (a.status === "pending" || a.status === "contacted")) {
      box.append(el("p", {}, "Estado de tu solicitud: ", pill(a.status, a.status === "contacted" ? "Te contactamos: revisa Discord" : "En revisión")));
      return s.replaceChildren(box);
    }
    if (a?.status === "rejected") box.append(el("div", { class: "notice notice--bad" }, `Tu última solicitud fue rechazada${a.review_note ? `: ${a.review_note}` : "."} Puedes volver a aplicar 14 días después.`));
    let account = null;
    const accountBox = el("div");
    const paintAccount = () => accountBox.replaceChildren(account
      ? el("div", { class: "form" }, el("label", {}, "Tu cuenta de Roblox"), accountChip(account, () => { account = null; paintAccount(); }))
      : accountPicker((p) => { account = p; paintAccount(); }));
    paintAccount();
    const fields = staffProgram.questions.map((q) => {
      const name = `q_${q.key}`;
      const label = `${q.label}${q.required ? " *" : ""}`;
      if (q.type === "yesno") return el("fieldset", { class: "yesno" }, el("legend", {}, label),
        el("label", { class: "check" }, el("input", { type: "radio", name, value: "si", required: q.required }), "Sí"),
        el("label", { class: "check" }, el("input", { type: "radio", name, value: "no" }), "No"));
      return el("label", {}, label, q.type === "long"
        ? el("textarea", { name, required: q.required, maxlength: "1200", rows: "3" })
        : el("input", { name, required: q.required, maxlength: "200" }));
    });
    const form = el("form", { class: "form form--staff" },
      el("div", { class: "notice" }, "Tu usuario de Discord es con el que entraste. Elige abajo tu cuenta de Roblox: así quedan vinculadas las dos."),
      accountBox, ...fields,
      el("label", { class: "check" }, el("input", { name: "age13", type: "checkbox", required: true }), "Tengo 13 años o más y acepto las normas del staff"),
      el("div", { class: "form-actions" }, el("button", { class: "btn btn--yolk", type: "submit" }, "Enviar solicitud")));
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (!account) return flash(ERRORS.pick_account, "bad");
      const f = new FormData(form);
      const answers = Object.fromEntries(staffProgram.questions.map((q) => [q.key, f.get(`q_${q.key}`) || ""]));
      act(e.submitter, () => api("/api/staff/apply", { robloxUserId: account.userId, answers, age13: f.get("age13") === "on" }),
        "¡Solicitud enviada! Un Moderator la revisará y te escribirá por Discord.", () => show("staff-aplicar"));
    });
    box.append(form);
    s.replaceChildren(box);
  }

  async function staffLink(s) {
    const st = await api("/api/staff/me");
    const dl = new Date(st.linkDeadline).toLocaleDateString("es-CO", { dateStyle: "long" });
    const box = el("div", { class: "box" }, el("h2", {}, `Vincula tu cuenta de ${RANK_NAME[st.discordRank] || "staff"}`),
      el("p", {}, `Ya eres parte del staff, así que no tienes que llenar el formulario. Solo vincula tu Roblox antes del ${dl}. Si no lo haces, pierdes el rango en el juego y en Discord y tendrás que volver a aplicar.`));
    if (st.staff?.linkStatus === "pending") {
      box.append(el("div", { class: "notice" }, "En revisión: un Moderator confirmará que esta es tu cuenta."), accountChip({ ...st.staff.roblox, displayName: st.staff.roblox?.name, avatar: null }));
      return s.replaceChildren(box);
    }
    box.append(el("p", { class: "small muted" }, "Si el juego ya te vio con tu etiqueta de staff en esa cuenta, se confirma al instante."),
      accountPicker((p) => {
        if (!confirm(`¿Vincular @${p.name}?`)) return;
        act(document.activeElement, () => api("/api/staff/link", { userId: p.userId }),
          (o) => (o.auto ? `¡Listo! Cuenta confirmada como ${RANK_NAME[o.rank]}.` : "Enviado: un Moderator confirmará tu cuenta."), async () => { me = await api("/api/me"); renderNav(); show(roles().staffLinked ? "staff-tareas" : "staff-vincular"); });
      }, "Busca tu cuenta de Roblox"));
    s.replaceChildren(box);
  }

  function progressBlock(p, title) {
    const box = el("div", { class: "box" }, el("div", { class: "item__head" }, el("h2", {}, title),
      el("span", { class: `pill ${p.complete ? "pill--approved" : "pill--pending"}` }, p.complete ? "Mes cumplido" : `${p.done}/${p.required} tareas · ${p.percent}%`)));
    const grid = el("div", { class: "task-grid" });
    for (const t of p.tasks) {
      const pct = Math.min(100, (t.value / t.target) * 100);
      const bar = el("div", { class: "meter" }, el("div", { class: "meter__fill", "data-w": pct }));
      grid.append(el("div", { class: `task${t.done ? " is-done" : ""}${t.optional ? " is-optional" : ""}` },
        el("div", { class: "task__head" }, el("strong", {}, t.name), el("span", { class: "task__val" }, `${String(t.value).replace(".", ",")} / ${t.target} ${t.unit}`)),
        bar,
        el("p", { class: "small muted" }, `${t.track === "auto" ? "Se mide solo" : "Con evidencias"}${t.optional ? " · extra (no obligatoria)" : ""}${t.pending ? ` · ${t.pending} en revisión` : ""}`)));
    }
    box.append(grid);
    requestAnimationFrame(() => { for (const f of box.querySelectorAll(".meter__fill")) f.style.width = `${f.dataset.w}%`; });
    return box;
  }

  async function staffTasks(s) {
    const st = await api("/api/staff/me");
    if (!st.current) return s.replaceChildren(el("div", { class: "notice" }, "Todavía no tienes un rango de staff activo."));
    const rank = st.staff.rank;
    const evTasks = staffProgram.tasks.filter((t) => t.track === "evidence" && (t.targets[rank] || 0) > 0);
    const head = el("div", { class: "box hero-card" },
      el("div", {}, el("p", { class: "small muted" }, "Tu rango"), el("h2", {}, `${staffProgram.ranks.find((r) => r.key === rank)?.emoji || ""} ${RANK_NAME[rank]}`),
        el("p", { class: "small muted" }, `En el staff desde ${new Date(st.staff.joinedAt).toLocaleDateString("es-CO", { dateStyle: "medium" })}${st.staff.roblox ? ` · Roblox @${st.staff.roblox.name}` : ""}`)),
      el("div", { class: "hero-card__stats" },
        tile(String(st.current.activity.actions), "comandos este mes"), tile(String(st.current.activity.reportsFiled), "reportes enviados"),
        tile(String(st.staff.strikes), "meses sin cumplir", st.staff.strikes ? "warn" : null)));
    const warn = st.staff.strikes && !st.removalDueAt ? el("div", { class: "notice notice--bad" }, `Tienes ${st.staff.strikes} mes sin cumplir tus tareas. Con ${staffProgram.failMonthsToRemove} seguidos sales del staff.`) : null;
    const form = el("form", { class: "form" },
      el("div", { class: "row" },
        el("label", {}, "Tarea", el("select", { name: "task" }, ...evTasks.map((t) => el("option", { value: t.key }, t.name)))),
        el("label", {}, "¿Cuánto suma?", el("input", { name: "amount", type: "number", min: "1", max: "500", value: "1", required: true })),
        el("label", {}, "Mes", el("select", { name: "month" }, el("option", { value: "current" }, "Este mes"), el("option", { value: "previous" }, "Mes pasado (hasta el día 3)")))),
      el("label", {}, "Enlace a la prueba (mensaje de Discord, video…) — opcional si subes captura", el("input", { name: "url", type: "url", placeholder: "https://…" })),
      el("label", {}, "Captura", el("input", { name: "file", type: "file", accept: "image/png,image/jpeg,image/webp" })),
      el("label", {}, "¿Qué hiciste?", el("textarea", { name: "note", required: true, maxlength: "600", rows: "2" })),
      el("div", { class: "form-actions" }, el("button", { class: "btn btn--yolk", type: "submit" }, "Subir evidencia")));
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const f = new FormData(form);
      act(e.submitter, async () => {
        let file = null;
        const img = f.get("file");
        if (img && img.size) file = (await api("/api/creators/upload", {}, img)).file;
        return api("/api/staff/evidence", { task: f.get("task"), amount: Number(f.get("amount")), month: f.get("month"), url: f.get("url"), note: f.get("note"), file });
      }, "Evidencia enviada. Un rango superior la revisará.", () => show("staff-tareas"));
    });
    const TASK_NAME = Object.fromEntries(staffProgram.tasks.map((t) => [t.key, t.name]));
    const evList = st.evidences.length ? el("table", { class: "tbl" }, el("thead", {}, el("tr", {}, ...["Fecha", "Tarea", "Pide", "Suma", "Estado", "Nota"].map((h) => el("th", {}, h)))),
      el("tbody", {}, ...st.evidences.map((e) => el("tr", {}, el("td", {}, when(e.createdAt)), el("td", {}, TASK_NAME[e.task] || e.task), el("td", {}, String(e.amount)),
        el("td", {}, e.approved == null ? "—" : String(e.approved)), el("td", {}, pill(e.status, { pending: "En revisión", approved: "Aprobada", rejected: "Rechazada" }[e.status])), el("td", { class: "small" }, e.reviewNote || "")))))
      : empty("Aún no subiste evidencias.");
    const next = staffProgram.path[staffProgram.path.indexOf(rank) + 1];
    const promo = el("div", { class: "box" }, el("h2", {}, "Ascenso"));
    const pending = st.promotions.find((p) => p.status === "pending");
    if (!next) promo.append(el("p", { class: "muted" }, "Estás en el rango más alto del staff."));
    else if (pending) promo.append(el("p", {}, `Pediste subir a ${RANK_NAME[pending.toRank]}: `, pill("pending", "en revisión")));
    else {
      const reason = el("textarea", { maxlength: "600", rows: "2", placeholder: "Cuenta por qué estás listo (tareas cumplidas, ayudas, eventos…)" });
      promo.append(el("p", { class: "muted" }, `Siguiente rango: ${RANK_NAME[next]} (${staffProgram.promotions[next]}).`), checksList(st.promotion.checks));
      if (st.promotion.eligible) promo.append(reason, el("div", { class: "form-actions" }, btn("Pedir ascenso", "btn--green", (b) => act(b, () => api("/api/staff/promotion", { reason: reason.value }), "Ascenso pedido.", () => show("staff-tareas")))));
      else promo.append(el("p", { class: "small muted" }, "Cuando cumplas todo podrás pedirlo aquí. Un rango superior también puede proponerte."));
    }
    if (st.removalDueAt) s.dataset.removal = "1";
    const removal = st.removalDueAt ? el("div", { class: "notice notice--bad" }, `No cumpliste ${st.staff.strikes} meses seguidos: sales del staff el ${new Date(st.removalDueAt).toLocaleDateString("es-CO", { dateStyle: "long" })} si no presentas una excusa. `, el("a", { href: "#staff-excusas" }, "Presentar excusa →")) : null;
    s.replaceChildren(...[head, removal, warn, weekCard(st.week, "Cuota de esta semana"), weeksBlock(st.current), progressBlock(st.current, `Tareas de ${st.current.month}`),
      el("div", { class: "box" }, el("h2", {}, "Subir evidencia"), el("p", { class: "small muted" }, "Las horas, días y acciones de moderación se miden solas desde el juego (usa ;Duty cuando ayudes). Para el resto sube capturas."), form),
      el("div", { class: "box" }, el("h2", {}, "Mis evidencias"), evList), promo,
      st.previous.tasks.length ? progressBlock(st.previous, `Mes pasado (${st.previous.month})`) : null].filter(Boolean));
  }

  function staffGuide(s) {
    const p = staffProgram;
    s.replaceChildren(
      el("div", { class: "box" }, el("h2", {}, "Normas del staff"), el("ul", { class: "list-plain" }, ...p.rules.map((r) => el("li", {}, r)))),
      ...p.ranks.map((r) => el("div", { class: "box rank-card", "data-rank": r.key },
        el("h2", {}, `${r.emoji} ${r.name}`), el("p", { class: "muted" }, r.summary),
        el("h3", {}, "En el juego"), el("dl", { class: "cmds" }, ...r.game.flatMap((c) => [el("dt", {}, c.cmd), el("dd", {}, c.desc)])),
        el("h3", {}, "En Discord"), el("ul", { class: "list-plain" }, ...r.discord.map((d) => el("li", {}, d))),
        el("h3", {}, "Beneficios"), el("ul", { class: "list-plain" }, ...r.benefits.map((d) => el("li", {}, d))),
        el("h3", {}, "Tareas del mes"), el("ul", { class: "list-plain" }, ...p.tasks.filter((t) => (t.targets[r.key] || 0) > 0).map((t) => el("li", {}, `${t.name}: ${t.targets[r.key]} ${t.unit}${t.optional ? " (extra)" : ""} — ${t.desc}`))))));
  }

  async function staffReports(body) {
    const sel = el("select", {}, ...[["open", "Abiertos"], ["resolved", "Resueltos"], ["dismissed", "Descartados"], ["all", "Todos"]].map(([v, l]) => el("option", { value: v }, l)));
    const list = el("div");
    const paint = async () => {
      const { reports } = await api(`/api/mod/reports?status=${sel.value}`);
      list.replaceChildren(reports.length ? el("div", { class: "list" }, ...reports.map((r) => {
        const note = noteInput("Qué hiciste (obligatorio)");
        return el("article", { class: "item" },
          el("div", { class: "item__head" }, el("span", { class: "item__title" }, `📣 ${r.target_name}`), pill(r.status === "open" ? "pending" : r.status === "resolved" ? "approved" : "rejected", { open: "Abierto", resolved: "Resuelto", dismissed: "Descartado" }[r.status])),
          el("p", { class: "item__meta" }, "Reportado: ", link(`https://www.roblox.com/users/${r.target_id}/profile`, `@${r.target_name}`), ` · por @${r.reporter_name} · ${when(r.created_at)}${r.online ? " · estaba en el servidor" : ""}${r.previous ? ` · ⚠️ ${r.previous} reporte(s) antes` : ""}`),
          el("p", {}, r.reason),
          r.note ? el("p", { class: "item__meta" }, `${r.resolved_by}: ${r.note}`) : null,
          r.status === "open" ? el("div", { class: "item__actions" }, note,
            btn("Resuelto", "btn--green", (b) => act(b, () => api("/api/mod/report", { id: r.id, action: "resolve", note: note.value }), "Reporte resuelto.", paint)),
            btn("Descartar", "btn--white", (b) => act(b, () => api("/api/mod/report", { id: r.id, action: "dismiss", note: note.value }), "Reporte descartado.", paint))) : null);
      })) : empty("No hay reportes en esta lista."));
      loadQueue().catch(() => {});
    };
    sel.addEventListener("change", paint);
    body.replaceChildren(el("div", { class: "form-actions" }, el("label", {}, "Mostrar ", sel)), list);
    await paint();
  }

  async function staffReview(body) {
    const { evidences } = await api("/api/mod/staff/evidence");
    const TASK = Object.fromEntries(staffProgram.tasks.map((t) => [t.key, t]));
    body.replaceChildren(evidences.length ? el("div", { class: "list" }, ...evidences.map((e) => {
      const amount = el("input", { type: "number", min: "0", max: "500", value: String(e.amount), class: "num" });
      const note = noteInput();
      return el("article", { class: "item" },
        el("div", { class: "item__head" }, el("span", { class: "item__title" }, `${TASK[e.task]?.name || e.task} · ${userLine(e.user)}`), rankPill(e.rank)),
        el("p", { class: "item__meta" }, `Pide sumar ${e.amount} ${TASK[e.task]?.unit || ""} al mes ${e.month} · ${when(e.created_at)}${e.url ? " · " : ""}`, e.url ? link(e.url, "abrir enlace") : ""),
        el("p", {}, e.note),
        e.file ? el("a", { href: `/api/files/${e.file}`, target: "_blank", rel: "noopener" }, el("img", { class: "proof", src: `/api/files/${e.file}`, alt: "Captura" })) : null,
        el("div", { class: "item__actions" }, el("label", { class: "small" }, "Suma ", amount), note,
          btn("Aprobar", "btn--green", (b) => act(b, () => api("/api/mod/staff/evidence", { id: e.id, action: "approve", amount: Number(amount.value), note: note.value }), "Evidencia aprobada.", refreshMod)),
          btn("Rechazar", "btn--red", (b) => { if (!note.value.trim()) return flash("Escribe el motivo en la nota.", "bad"); act(b, () => api("/api/mod/staff/evidence", { id: e.id, action: "reject", note: note.value }), "Evidencia rechazada.", refreshMod); })));
    })) : empty("No hay evidencias del staff por revisar."));
  }

  // Barras dobles por hora: jugadores conectados (promedio) y minutos de staff conectado.
  function coverageChart(cov) {
    const maxP = Math.max(1, ...cov.players), maxS = Math.max(1, ...cov.staffMinutes);
    const row = el("div", { class: "cov", role: "img", "aria-label": "Jugadores y staff por hora del día" });
    for (let h = 0; h < 24; h++) {
      const p = el("div", { class: "cov__p", "data-h": (cov.players[h] / maxP) * 100, title: `${h}:00 · ${cov.players[h]} jugadores (promedio)` });
      const st = el("div", { class: "cov__s", "data-h": (cov.staffMinutes[h] / maxS) * 100, title: `${h}:00 · ${cov.staffMinutes[h]} min de staff por día` });
      row.append(el("div", { class: "cov__col" }, el("div", { class: "cov__bars" }, p, st), el("span", { class: "cov__lbl" }, h % 3 === 0 ? `${h}h` : "")));
    }
    requestAnimationFrame(() => { for (const b of row.querySelectorAll("[data-h]")) b.style.height = `${Math.max(2, b.dataset.h)}%`; });
    return el("figure", { class: "bars" }, el("figcaption", { class: "small muted" }, "Cobertura por hora (últimos 14 días, hora de Colombia)"),
      el("div", { class: "legend" }, el("span", { class: "legend__p" }, "Jugadores conectados"), el("span", { class: "legend__s" }, "Minutos de staff")), row,
      el("p", { class: "small muted" }, "Las horas con muchos jugadores y poco staff son las que conviene cubrir con nuevos Helpers."));
  }

  async function staffTeam(body) {
    const d = await api("/api/mod/staff");
    const s = d.summary;
    const tiles = el("div", { class: "tiles" },
      tile(String(s.total), "miembros del staff"), tile(String(s.online), "conectados ahora", s.online ? "good" : null),
      tile(`${String(s.hoursWeek).replace(".", ",")} h`, "jugadas en 7 días"), tile(`${s.complete}/${s.total}`, `cumplieron ${d.month}`),
      tile(String(s.atRisk), "por debajo del 50 %", s.atRisk ? "warn" : null), tile(String(s.reportsOpen), "reportes abiertos", s.reportsOpen ? "warn" : null),
      tile(s.reportAvgHours == null ? "—" : `${String(s.reportAvgHours).replace(".", ",")} h`, "respuesta media a reportes"),
      tile(String(s.legacyPending), "staff antiguo sin vincular", s.legacyPending ? "warn" : null),
      tile(`${s.weekMet}/${s.total}`, "con la cuota de esta semana"), tile(`${h1(s.discordHoursMonth)} h`, "de actividad en Discord este mes"),
      tile(String(s.removalsPending), "con salida pendiente", s.removalsPending ? "warn" : null));
    const ranks = el("div", { class: "tiers" }, ...staffProgram.ranks.map((r) => { const c = el("span", { class: "tierchip" }, `${r.emoji} ${r.name}: ${s.byRank[r.key] || 0}`); c.style.setProperty("--tier", r.color); return c; }));
    const isA = isAdmin();
    const rows = d.members.map((m) => {
      const sel = el("select", {}, ...["Helper", "ModeratorJr", "Moderator", "None"].filter((k) => isA || k !== "Moderator").map((k) => el("option", { value: k, selected: k === m.rank }, RANK_NAME[k])));
      const canEdit = m.linkStatus === "approved" && (isA || m.rank !== "Moderator") && isMod();
      return el("tr", { class: m.progress && m.progress.percent < 50 ? "is-risk" : null },
        el("td", {}, el("span", { class: `dot ${m.online ? "dot--on" : ""}`, title: m.online ? "Conectado" : "Desconectado" }), m.discord, m.roblox ? el("div", { class: "small muted" }, link(`https://www.roblox.com/users/${m.roblox.userId}/profile`, `@${m.roblox.name}`)) : null),
        el("td", {}, rankPill(m.rank), m.gameRank && m.gameRank !== m.rank ? el("div", { class: "small muted" }, `En el juego: ${RANK_NAME[m.gameRank]}`) : null, m.linkStatus === "pending" ? el("div", { class: "small muted" }, "vínculo pendiente") : null),
        el("td", {}, m.online ? "ahora" : ago(m.lastSeen)),
        el("td", {}, hours(m.hoursToday), el("div", { class: "small muted" }, `${hours(m.hoursWeek)} 7 días · ${hours(m.dutyWeek)} servicio`)),
        el("td", {}, m.week ? el("div", {}, m.week.met ? pill("approved", m.week.excused ? "Excusada" : "Cumplida") : pill("pending", `${h1(m.week.totalHours)}/${h1(m.week.targetHours)} h`),
          el("div", { class: "small muted" }, `${h1(m.week.gameHours)} juego · ${h1(m.week.discordHours)} Discord`)) : "—"),
        el("td", {}, m.progress ? el("div", {}, el("div", { class: "meter meter--sm" }, el("div", { class: "meter__fill", "data-w": m.progress.percent })), el("span", { class: "small" }, `${m.progress.percent}% · ${m.progress.done}/${m.progress.required}`)) : "—"),
        el("td", {}, m.progress ? `${m.progress.activity.actions} cmds · ${m.progress.activity.reportsFiled} rep. · ${m.progress.activity.discordMessages} msj. Discord` : "—"),
        el("td", {}, String(m.strikes || 0), m.removalDueAt ? el("div", { class: "small bad-text" }, `sale el ${new Date(m.removalDueAt).toLocaleDateString("es-CO")}`) : null),
        el("td", {}, canEdit ? el("div", { class: "inline" }, sel, btn("Guardar", "btn--white", (b) => {
          if (sel.value === m.rank) return;
          if (sel.value === "None" && !confirm("¿Sacarlo del staff? Pierde el rango en el juego y en Discord.")) return;
          act(b, () => api("/api/mod/staff/rank", { discordId: m.discordId, rank: sel.value }), (o) => `Rango cambiado. ${o.discord === "ok" ? "Discord actualizado." : o.discord === "error" ? "No se pudo cambiar en Discord: revisa «Bot de Discord»." : "Cámbialo a mano en Discord."}`, refreshMod);
        })) : ""));
    });
    const table = rows.length ? el("div", { class: "scrollx" }, el("table", { class: "tbl" },
      el("thead", {}, el("tr", {}, ...["Miembro", "Rango", "Última vez", "Horas hoy", "Semana", "Tareas del mes", "Actividad", "Meses sin cumplir", ""].map((h) => el("th", {}, h)))), el("tbody", {}, ...rows))) : empty("Todavía no hay staff vinculado.");
    body.replaceChildren(el("p", { class: "small muted" }, `Tareas de ${d.month}. Fecha límite del staff antiguo: ${new Date(s.linkDeadline).toLocaleDateString("es-CO", { dateStyle: "long" })}. Roles de Discord: ${d.bot ? "automáticos" : "a mano (falta el bot)"}.`),
      tiles, ranks, coverageChart(d.coverage), el("h3", { class: "mt" }, "Equipo"), table);
    requestAnimationFrame(() => { for (const f of body.querySelectorAll(".meter__fill")) f.style.width = `${f.dataset.w}%`; });
  }

  async function staffApplications(body) {
    const [{ applications }, team] = await Promise.all([api("/api/mod/staff/applications"), api("/api/mod/staff")]);
    const links = team.members.filter((m) => m.linkStatus === "pending");
    const Q = Object.fromEntries(staffProgram.questions.map((q) => [q.key, q.label]));
    const linkBox = links.length ? el("div", { class: "list" }, ...links.map((m) => el("article", { class: "item" },
      el("div", { class: "item__head" }, el("span", { class: "item__title" }, `🔗 ${m.discord}`), rankPill(m.rank)),
      el("p", { class: "item__meta" }, "Staff antiguo · Roblox ", m.roblox ? link(`https://www.roblox.com/users/${m.roblox.userId}/profile`, `@${m.roblox.name}`) : "—", ". Confirma con él que es su cuenta."),
      el("div", { class: "item__actions" },
        btn("Confirmar", "btn--green", (b) => act(b, () => api("/api/mod/staff/link", { discordId: m.discordId, action: "approve" }), "Cuenta confirmada.", refreshMod)),
        btn("Rechazar", "btn--red", (b) => act(b, () => api("/api/mod/staff/link", { discordId: m.discordId, action: "reject" }), "Vínculo rechazado.", refreshMod)))))) : null;
    const apps = applications.length ? el("div", { class: "list" }, ...applications.map((a) => {
      const note = noteInput();
      return el("article", { class: "item" },
        el("div", { class: "item__head" }, el("span", { class: "item__title" }, `🛟 ${userLine(a.user)}`), pill(a.status, a.status === "contacted" ? "Contactado" : "Nueva")),
        robloxLine(a.roblox_user_id, a.roblox_name, null, a.player),
        el("p", { class: "item__meta" }, `Enviada ${when(a.created_at)}`),
        el("details", { class: "answers" }, el("summary", {}, "Ver respuestas del formulario"),
          el("dl", {}, ...Object.entries(a.answers).filter(([, v]) => v).flatMap(([k, v]) => [el("dt", {}, Q[k] || k), el("dd", {}, v === "si" ? "Sí" : v === "no" ? "No" : v)]))),
        el("div", { class: "item__actions" }, note,
          a.status === "pending" ? btn("Contactado", "btn--white", (b) => act(b, () => api("/api/mod/staff/application", { id: a.id, action: "contacted", note: note.value }), "Marcada como contactada.", refreshMod)) : null,
          btn("Aprobar como Helper", "btn--green", (b) => act(b, () => api("/api/mod/staff/application", { id: a.id, action: "approve", note: note.value }), (o) => `Aprobado. ${o.discordRole === "ok" ? "Rol Helper puesto en Discord." : o.discordRole === "error" ? "No se pudo poner el rol en Discord (revisa «Bot de Discord»)." : "Dale el rol Helper en Discord."} La etiqueta y los comandos llegan solos al juego.`, refreshMod)),
          btn("Rechazar", "btn--red", (b) => { if (!note.value.trim()) return flash("Escribe el motivo en la nota.", "bad"); act(b, () => api("/api/mod/staff/application", { id: a.id, action: "reject", note: note.value }), "Rechazada.", refreshMod); })));
    })) : empty("No hay solicitudes de Helper pendientes.");
    body.replaceChildren(...[linkBox && el("h3", {}, "Cuentas de staff antiguo por confirmar"), linkBox, el("h3", {}, "Solicitudes de Helper"), apps].filter(Boolean));
  }

  async function staffPromotions(body) {
    const d = await api("/api/mod/staff");
    body.replaceChildren(d.promotions.length ? el("div", { class: "list" }, ...d.promotions.map((p) => {
      const note = noteInput();
      const adminOnly = p.to_rank === "Moderator";
      return el("article", { class: "item" },
        el("div", { class: "item__head" }, el("span", { class: "item__title" }, `${userLine(p.user)}: ${RANK_NAME[p.from_rank]} → ${RANK_NAME[p.to_rank]}`), adminOnly ? pill("pending_admin", "Solo el Admin") : null),
        el("p", { class: "item__meta" }, `Pedido por ${p.requested_by} · ${when(p.created_at)}`), el("p", {}, p.reason || ""),
        p.check ? el("details", { class: "answers" }, el("summary", {}, p.check.eligible ? "✔ Cumple los requisitos" : "✖ No cumple todos los requisitos (puedes aprobarlo igual)"), checksList(p.check.checks)) : null,
        (!adminOnly || isAdmin()) ? el("div", { class: "item__actions" }, note,
          btn("Aprobar ascenso", "btn--green", (b) => act(b, () => api("/api/mod/staff/promotion", { id: p.id, action: "approve", note: note.value }), "Ascenso aprobado.", refreshMod)),
          btn("Rechazar", "btn--red", (b) => act(b, () => api("/api/mod/staff/promotion", { id: p.id, action: "reject", note: note.value }), "Ascenso rechazado.", refreshMod))) : null);
    })) : empty("No hay ascensos pendientes."));
  }

  async function staffLegacy(body) {
    const d = await api("/api/mod/staff");
    const dl = new Date(d.summary.linkDeadline).toLocaleDateString("es-CO", { dateStyle: "long" });
    const ST = { pending: ["pending", "Sin vincular"], notified: ["pending", "Avisado en el juego"], linked: ["approved", "Vinculado"], removed: ["rejected", "Rango quitado"] };
    body.replaceChildren(
      el("div", { class: "notice" }, `El staff que ya existía no llena el formulario: solo vincula Discord + Roblox antes del ${dl}. Después, a quien no lo hizo se le quita el rango en el juego (al entrar) y en Discord (con el bot y «Server Members Intent»).`),
      isAdmin() ? el("div", { class: "form-actions" }, btn("Leer los roles de Discord ahora", "btn--white", (b) => act(b, () => api("/api/mod/staff/sync", {}), (o) => `Leídos ${o.members} miembros con rol de staff · ${o.changes} cambio(s).`, refreshMod))) : null,
      el("h3", {}, "En Discord"),
      d.legacyDiscord.length ? el("table", { class: "tbl" }, el("thead", {}, el("tr", {}, ...["Usuario", "Rol", "Estado", "Visto"].map((h) => el("th", {}, h)))),
        el("tbody", {}, ...d.legacyDiscord.map((x) => el("tr", {}, el("td", {}, x.username || `#${x.discord_id}`), el("td", {}, RANK_NAME[x.rank] || x.rank), el("td", {}, pill(...(ST[x.status] || ["pending", x.status]))), el("td", {}, ago(x.seen_at))))))
        : empty("Sin datos de Discord todavía (necesita el bot con «Server Members Intent»)."),
      el("h3", {}, "En el juego"),
      d.legacyGame.length ? el("table", { class: "tbl" }, el("thead", {}, el("tr", {}, ...["Jugador", "Etiqueta", "Estado", "Última vez"].map((h) => el("th", {}, h)))),
        el("tbody", {}, ...d.legacyGame.map((x) => el("tr", {}, el("td", {}, link(`https://www.roblox.com/users/${x.roblox_user_id}/profile`, `@${x.name}`)), el("td", {}, RANK_NAME[["Helper", "ModeratorJr", "Moderator"][x.staff_tier - 1]] || "—"), el("td", {}, pill(...(ST[x.status] || ["pending", x.status]))), el("td", {}, x.last_seen ? ago(x.last_seen) : "—")))))
        : empty("Aún no entró al juego nadie con etiqueta de staff sin vincular."));
  }

  // ---------- Administración ----------
  async function adminLuck(s) {
    // El panel de métricas de "Prueba tu suerte" dentro del panel (misma sesión de Discord con rol admin).
    const frame = el("iframe", { class: "embed", src: "/admin/?embed=1", title: "Prueba tu suerte: métricas, códigos y regalos" });
    window.addEventListener("message", function onMsg(ev) {
      if (ev.origin !== location.origin || !ev.data || ev.data.type !== "se-admin-height") return;
      if (!frame.isConnected) return window.removeEventListener("message", onMsg);
      frame.style.height = `${Math.max(600, Number(ev.data.height) || 0) + 20}px`;
    });
    s.replaceChildren(el("div", { class: "box box--flush" }, frame));
  }

  async function adminDiscord(body) {
    const uid = el("input", { placeholder: "ID de Discord de un usuario (opcional)", inputmode: "numeric", maxlength: "25" });
    const out = el("div");
    const run = async (b) => {
      b.disabled = true;
      out.replaceChildren(el("p", { class: "small muted" }, "Comprobando…"));
      try {
        const r = await api(`/api/mod/discord/check${uid.value.trim() ? `?userId=${encodeURIComponent(uid.value.trim())}` : ""}`);
        out.replaceChildren(el("div", { class: `notice ${r.ok ? "notice--ok" : "notice--bad"}` }, r.ok ? "✅ Todo listo: el bot puede poner y quitar los roles." : "❌ Hay algo por arreglar (mira la primera línea en rojo)."),
          el("ul", { class: "checks" }, ...r.checks.map((c) => el("li", { class: c.ok ? "ok" : "bad" }, el("strong", {}, `${c.ok ? "✔" : "✖"} ${c.label}`), c.detail ? el("span", { class: "small muted" }, ` — ${c.detail}`) : null))));
      } catch (e) { out.replaceChildren(el("div", { class: "notice notice--bad" }, errText(e))); } finally { b.disabled = false; }
    };
    body.replaceChildren(
      el("ol", { class: "list-plain small" },
        el("li", {}, "Un error 404 al poner un rol casi siempre es que el bot no está en el servidor (código 10004) o que ese usuario ya salió del servidor (10007)."),
        el("li", {}, "403 = al bot le falta «Gestionar roles» o su rol está por debajo del rol que intenta poner."),
        el("li", {}, "Para leer quién tiene rol de staff en Discord, activa «Server Members Intent» en la pestaña Bot de tu app.")),
      el("div", { class: "form-actions" }, uid, btn("Comprobar", "btn--yolk", run)), out);
  }

  // ---------- Inicio por rol ----------
  const PRIO = { 1: ["urgent", "Urgente"], 2: ["high", "Importante"], 3: ["low", "Cuando puedas"] };
  async function homeDashboard(u) {
    const h = await api("/api/home");
    const out = [];
    const hello = el("div", { class: "box hero-card home-hero" },
      el("div", {}, el("p", { class: "small muted" }, new Date().toLocaleDateString("es-CO", { weekday: "long", day: "numeric", month: "long" })),
        el("h2", {}, `Hola, ${u.globalName || u.username}`),
        el("p", { class: "muted" }, h.items.length ? `Tienes ${h.items.length} cosa(s) pendiente(s)${h.items.some((i) => i.priority === 1) ? ", empieza por las urgentes." : "."}` : "Todo al día. ¡Buen trabajo!")),
      h.me ? el("div", { class: "hero-card__stats" },
        tile(h.me.week.met ? "✔" : `${String(h.me.week.totalHours).replace(".", ",")}/${h.me.week.targetHours} h`, "cuota de la semana", h.me.week.met ? "good" : null),
        tile(`${h.me.month.percent}%`, "tareas del mes", h.me.month.complete ? "good" : h.me.month.percent < 50 ? "warn" : null),
        tile(String(h.me.strikes), "meses sin cumplir", h.me.strikes ? "warn" : null)) : null);
    out.push(hello);
    if (!u.roles.inGuild) out.push(el("div", { class: "notice" }, "No estás en el Discord de Sky Eggs. Únete y vuelve a entrar para que podamos ver tus roles. ",
      el("a", { href: "https://discord.gg/sTgtR7KdGQ", target: "_blank", rel: "noopener" }, "Unirme al Discord")));
    if (h.items.length) out.push(el("div", { class: "box" }, el("h2", {}, "Pendientes"),
      el("ul", { class: "todo" }, ...h.items.map((i) => {
        const [cls, label] = PRIO[i.priority];
        return el("li", { class: `todo__item todo--${cls}` },
          el("span", { class: "todo__icon", "aria-hidden": "true" }, i.icon),
          el("div", { class: "todo__body" }, el("div", { class: "todo__head" }, el("strong", {}, i.title), i.count ? el("span", { class: "count" }, String(i.count)) : null, el("span", { class: `prio prio--${cls}` }, label)),
            i.detail ? el("p", { class: "small muted" }, i.detail) : null),
          el("a", { class: "btn btn--mini btn--white", href: `#${i.page}` }, "Ir"));
      }))));
    if (h.quick.length) out.push(el("div", { class: "box" }, el("h2", {}, "Accesos rápidos"),
      el("div", { class: "quick" }, ...h.quick.map((q) => el("a", { class: "quick__btn", href: `#${q.page}` }, el("span", { "aria-hidden": "true" }, q.icon), q.label)))));
    if (h.team) out.push(el("div", { class: "box" }, el("h2", {}, "El equipo ahora"),
      el("div", { class: "tiles" }, tile(`${h.team.online}/${h.team.total}`, "staff conectado", h.team.online ? "good" : "warn"),
        tile(`${h.team.weekMet}/${h.team.total}`, "con la cuota de la semana"), tile(String(h.team.atRisk), "en riesgo este mes", h.team.atRisk ? "warn" : null),
        tile(String(h.team.reportsOpen), "reportes abiertos", h.team.reportsOpen ? "warn" : null)),
      h.team.onlineNow.length ? el("p", { class: "small" }, "En el juego: ", ...h.team.onlineNow.flatMap((m, i) => [i ? ", " : "", rankPill(m.rank), ` ${m.name}`])) : el("p", { class: "small muted" }, "Nadie del staff está en el juego ahora.")));
    return out;
  }

  const checksList = (checks) => el("ul", { class: "checks" }, ...checks.map((c) => el("li", { class: c.ok ? "ok" : "bad" }, el("strong", {}, `${c.ok ? "✔" : "✖"} ${c.label}`), c.detail ? el("span", { class: "small muted" }, ` — ${c.detail}`) : null)));
  const h1 = (v) => String(v).replace(".", ",");

  // Cuota semanal: barra apilada juego + Discord con la meta y el mínimo en el juego.
  function weekCard(w, title) {
    const max = Math.max(w.targetHours, w.totalHours, 0.1);
    const g = el("div", { class: "qbar__game", "data-w": (w.gameHours / max) * 100, title: `Juego: ${h1(w.gameHours)} h` });
    const d = el("div", { class: "qbar__discord", "data-w": (w.discordHours / max) * 100, title: `Discord: ${h1(w.discordHours)} h` });
    const goal = el("div", { class: "qbar__goal", "data-l": (w.targetHours / max) * 100 }, el("span", {}, `${h1(w.targetHours)} h`));
    const min = el("div", { class: "qbar__min", "data-l": (w.minGameHours / max) * 100, title: `Mínimo en el juego: ${h1(w.minGameHours)} h` });
    const box = el("div", { class: "box" },
      el("div", { class: "item__head" }, el("h2", {}, title), w.excused ? pill("approved", "Excusada") : w.met ? pill("approved", "Cumplida") : pill("pending", `Faltan ${h1(w.missingHours || w.missingGameHours)} h`)),
      el("p", { class: "small muted" }, `Semana del ${w.start.split("-").reverse().join("/")} al ${w.end.split("-").reverse().join("/")}. Cuentan las horas en el juego y lo que escribes en el Discord. Esta semana te piden ${h1(w.requiredGameHours)} h en el juego: baja cuanto más ayudes en Discord, hasta un mínimo de ${h1(w.minGameHours)} h.`),
      el("div", { class: "qbar", role: "img", "aria-label": `${h1(w.gameHours)} h en el juego y ${h1(w.discordHours)} h en Discord de ${h1(w.targetHours)} h` }, g, d, min, goal),
      el("div", { class: "legend" }, el("span", { class: "legend__p" }, `Juego ${h1(w.gameHours)} h`), el("span", { class: "legend__s" }, `Discord ${h1(w.discordHours)} h`), el("span", { class: "legend__m" }, `Mínimo en el juego ${h1(w.minGameHours)} h`)));
    requestAnimationFrame(() => {
      for (const b of box.querySelectorAll("[data-w]")) b.style.width = `${b.dataset.w}%`;
      for (const b of box.querySelectorAll("[data-l]")) b.style.left = `${Math.min(100, b.dataset.l)}%`;
    });
    return box;
  }
  function weeksBlock(p) {
    if (!p.weeks?.length) return null;
    return el("div", { class: "box" }, el("h2", {}, `Semanas de ${p.month}`),
      el("div", { class: "weeks" }, ...p.weeks.map((w) => el("div", { class: `wk${w.met ? " is-met" : ""}${w.current ? " is-current" : ""}${!w.ended && !w.current ? " is-future" : ""}` },
        el("strong", {}, `${w.start.slice(8)}/${w.start.slice(5, 7)}`),
        el("span", {}, w.excused ? "Excusada" : w.met ? "✔ Cumplida" : w.current ? `${h1(w.totalHours)}/${h1(w.targetHours)} h` : w.ended ? `✖ ${h1(w.totalHours)} h` : "—"),
        el("span", { class: "small muted" }, `${h1(w.gameHours)} juego · ${h1(w.discordHours)} Discord`)))));
  }

  // ---------- Excusas ----------
  async function staffExcuses(s) {
    const st = await api("/api/staff/me");
    if (!st.current) return s.replaceChildren(el("div", { class: "notice" }, "Todavía no tienes un rango de staff activo."));
    const r = st.excuseRules;
    const form = el("form", { class: "form" },
      el("div", { class: "row" },
        el("label", {}, "¿Qué no vas a poder (o no pudiste) cumplir?", el("select", { name: "kind" },
          el("option", { value: "week:current" }, "Esta semana (cuota semanal)"), el("option", { value: "week:previous" }, "La semana pasada"),
          el("option", { value: "month:current" }, "Este mes (todas las tareas)"), el("option", { value: "month:previous", selected: Boolean(st.removalDueAt) }, "El mes pasado")))),
      el("label", {}, "Motivo", el("textarea", { name: "reason", required: true, maxlength: "800", rows: "3", placeholder: "Ej.: exámenes finales, viaje sin internet, enfermedad…" })),
      el("label", {}, "Prueba o enlace (opcional)", el("input", { name: "url", type: "url", placeholder: "https://…" })),
      el("div", { class: "form-actions" }, el("button", { class: "btn btn--yolk", type: "submit" }, "Enviar excusa")));
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const f = new FormData(form);
      const [scope, which] = String(f.get("kind")).split(":");
      act(e.submitter, () => api("/api/staff/excuse", { scope, which, reason: f.get("reason"), url: f.get("url") }), "Excusa enviada. Un rango superior la revisará.", () => show("staff-excusas"));
    });
    const ST = { pending: "En revisión", approved: "Aprobada", rejected: "Rechazada" };
    s.replaceChildren(...[
      st.removalDueAt ? el("div", { class: "notice notice--bad" }, `Sales del staff el ${new Date(st.removalDueAt).toLocaleDateString("es-CO", { dateStyle: "long" })} si no te aprueban una excusa del mes pasado. Mientras esté en revisión no se aplica.`) : null,
      el("div", { class: "box" }, el("h2", {}, "Presentar una excusa"),
        el("p", { class: "muted" }, `Si una semana o un mes no puedes cumplir, cuéntalo aquí. Si la aprueban, esa semana cuenta como cumplida o ese mes no suma falta, y mantienes tu rango. Tienes ${r.days} días después del cierre de mes para excusar el mes pasado. Excusas aprobadas este año: ${r.usedThisYear} de ${r.maxPerYear}.`), form),
      el("div", { class: "box" }, el("h2", {}, "Mis excusas"), st.excuses.length ? el("table", { class: "tbl" },
        el("thead", {}, el("tr", {}, ...["Enviada", "Periodo", "Motivo", "Estado", "Respuesta"].map((x) => el("th", {}, x)))),
        el("tbody", {}, ...st.excuses.map((x) => el("tr", {}, el("td", {}, when(x.createdAt)), el("td", {}, x.scope === "week" ? `Semana del ${x.period.split("-").reverse().join("/")}` : `Mes ${x.period}`),
          el("td", { class: "small" }, x.reason), el("td", {}, pill(x.status, ST[x.status])), el("td", { class: "small" }, x.reviewNote ? `${x.reviewedBy}: ${x.reviewNote}` : x.reviewedBy || "")))))
        : empty("No has presentado excusas."))].filter(Boolean));
  }

  async function staffExcuseReview(body) {
    const { excuses } = await api("/api/mod/staff/excuses");
    body.replaceChildren(excuses.length ? el("div", { class: "list" }, ...excuses.map((x) => {
      const note = noteInput("Respuesta (obligatoria si rechazas)");
      return el("article", { class: `item${x.removal_due_at ? " item--urgent" : ""}` },
        el("div", { class: "item__head" }, el("span", { class: "item__title" }, `📝 ${userLine(x.user)}`), rankPill(x.rank)),
        el("p", { class: "item__meta" }, `${x.scope === "week" ? `Semana del ${x.period.split("-").reverse().join("/")}` : `Mes ${x.period}`} · ${when(x.created_at)} · ${x.strikes} mes(es) sin cumplir`,
          x.removal_due_at ? el("strong", {}, ` · sale del staff el ${new Date(x.removal_due_at).toLocaleDateString("es-CO")} si se rechaza`) : ""),
        el("p", {}, x.reason), x.url ? el("p", {}, link(x.url, "Ver prueba")) : null,
        el("div", { class: "item__actions" }, note,
          btn("Aprobar", "btn--green", (b) => act(b, () => api("/api/mod/staff/excuse", { id: x.id, action: "approve", note: note.value }), "Excusa aprobada: mantiene su rango.", refreshMod)),
          btn("Rechazar", "btn--red", (b) => { if (!note.value.trim()) return flash("Escribe el motivo en la respuesta.", "bad"); act(b, () => api("/api/mod/staff/excuse", { id: x.id, action: "reject", note: note.value }), "Excusa rechazada.", refreshMod); })));
    })) : empty("No hay excusas por revisar."));
  }

  // ---------- Ajustes del staff (Admin) ----------
  async function adminStaffSettings(s) {
    const d = await api("/api/mod/staff/settings");
    const st = structuredClone(d.settings);
    const ro = !isAdmin();
    const RK = ["Helper", "ModeratorJr", "Moderator"];
    const numIn = (get, set, { min = 0, max = 500, step = 1 } = {}) => {
      const i = el("input", { type: "number", min: String(min), max: String(max), step: String(step), value: String(get()), class: "num", disabled: ro });
      i.addEventListener("input", () => set(Number(i.value)));
      return i;
    };
    const TASKS = staffProgram.tasks;
    const targets = el("table", { class: "tbl tbl--grid" },
      el("thead", {}, el("tr", {}, el("th", {}, "Tarea del mes"), ...RK.map((r) => el("th", {}, RANK_NAME[r])))),
      el("tbody", {}, ...TASKS.map((t) => el("tr", {}, el("th", { scope: "row" }, t.name, el("div", { class: "small muted" }, `${t.unit}${t.track === "auto" ? " · automática" : " · con evidencia"}${t.optional ? " · extra" : ""}`)),
        ...RK.map((r) => el("td", {}, numIn(() => st.targets[t.key][r], (v) => { st.targets[t.key][r] = v; }, { max: t.key === "weeks" ? 5 : 500 })))))));
    const weekly = el("table", { class: "tbl tbl--grid" },
      el("thead", {}, el("tr", {}, el("th", {}, "Cuota semanal"), ...RK.map((r) => el("th", {}, RANK_NAME[r])))),
      el("tbody", {},
        el("tr", {}, el("th", { scope: "row" }, "Horas de conexión (juego + Discord)"), ...RK.map((r) => el("td", {}, numIn(() => st.weekly[r].hours, (v) => { st.weekly[r].hours = v; }, { max: 80, step: 0.5 })))),
        el("tr", {}, el("th", { scope: "row" }, "Mínimo en el juego", el("div", { class: "small muted" }, "aunque escriba mucho en Discord")), ...RK.map((r) => el("td", {}, numIn(() => st.weekly[r].minGameHours, (v) => { st.weekly[r].minGameHours = v; }, { max: 80, step: 0.5 }))))));
    const promo = el("table", { class: "tbl tbl--grid" },
      el("thead", {}, el("tr", {}, el("th", {}, "Para pedir ascenso a"), el("th", {}, "Moderator Jr"), el("th", {}, "Moderator"))),
      el("tbody", {}, ...[["minDays", "Días mínimos en su rango", 365], ["minPercent", "% de tareas del mes en curso", 100], ["completeMonths", "Meses cumplidos seguidos", 6]].map(([k, label, max]) =>
        el("tr", {}, el("th", { scope: "row" }, label), ...["ModeratorJr", "Moderator"].map((r) => el("td", {}, numIn(() => st.promotion[r][k], (v) => { st.promotion[r][k] = v; }, { max })))))));
    const rules = el("div", { class: "form" }, el("div", { class: "row" }, ...[
      ["failMonthsToRemove", "Meses seguidos sin cumplir para salir (0 = nunca)", 12], ["excuseDays", "Días para presentar excusa antes de salir", 30],
      ["maxExcusesPerYear", "Excusas aprobadas por año", 24], ["warnDay", "Día del mes del aviso", 28], ["warnPercent", "Avisar si va por debajo del %", 100], ["graceDays", "Días para subir evidencias del mes pasado", 10],
    ].map(([k, label, max]) => el("label", {}, label, numIn(() => st.rules[k], (v) => { st.rules[k] = v; }, { max })))));
    const chans = el("textarea", { rows: "2", placeholder: "IDs de canales separados por coma (clic derecho en el canal → Copiar ID)", disabled: ro }, st.discord.channels.join(", "));
    chans.addEventListener("input", () => { st.discord.channels = chans.value.split(/[\s,]+/).filter(Boolean); });
    const counts = el("input", { type: "checkbox", checked: st.discord.countsForDays, disabled: ro });
    counts.addEventListener("change", () => { st.discord.countsForDays = counts.checked; });
    const chStatus = (list) => list.length ? el("ul", { class: "checks" }, ...list.map((c) => el("li", { class: c.error ? "bad" : "ok" },
      el("strong", {}, `${c.error ? "✖" : "✔"} #${c.name || c.id}`), el("span", { class: "small muted" }, c.error ? ` — ${c.error}` : c.lastRead ? ` — leído ${ago(c.lastRead)}` : " — todavía no se leyó")))) : el("p", { class: "small muted" }, "Sin canales: la actividad en Discord no cuenta todavía.");
    const chBox = el("div", {}, chStatus(d.channels));
    const discord = el("div", { class: "form" },
      el("label", {}, "Canales que cuentan como actividad", chans),
      el("div", { class: "row" },
        el("label", {}, "Ventana (minutos con al menos un mensaje)", numIn(() => st.discord.windowMinutes, (v) => { st.discord.windowMinutes = v; }, { min: 1, max: 30 })),
        el("label", {}, "Peso (1 = cada minuto en Discord vale 1 minuto de juego)", numIn(() => st.discord.weight, (v) => { st.discord.weight = v; }, { max: 3, step: 0.05 })),
        el("label", {}, "Tope por día (minutos)", numIn(() => st.discord.dailyCapMinutes, (v) => { st.discord.dailyCapMinutes = v; }, { max: 600 }))),
      el("label", { class: "check" }, counts, "Un día con 10 minutos de actividad en Discord cuenta como día activo"),
      chBox,
      !ro ? el("div", { class: "form-actions" }, btn("Leer los canales ahora", "btn--white", (b) => act(b, () => api("/api/mod/staff/discord-poll", {}), (o) => { chBox.replaceChildren(chStatus(o.channels)); return `${o.messages} mensaje(s) nuevos, ${o.counted} del staff.${o.errors.length ? " Hay errores en algún canal." : ""}`; }))) : null,
      el("p", { class: "small muted" }, "El bot lee cada 5 minutos solo quién escribió y cuándo (nunca el texto, no hace falta «Message Content Intent»). Necesita «Ver canal» y «Leer el historial de mensajes» en esos canales. La primera lectura empieza desde ese momento, no cuenta mensajes viejos."));
    const save = !ro ? el("div", { class: "form-actions sticky-actions" },
      btn("Guardar ajustes", "btn--yolk", (b) => act(b, () => api("/api/mod/staff/settings", { settings: st }), "Ajustes guardados. Se aplican desde ya a las tareas y cuotas.", async () => { staffProgram = await api("/api/staff/program"); show("admin-staff-ajustes"); })),
      btn("Volver a los valores por defecto", "btn--white", (b) => { if (confirm("¿Volver a los valores por defecto?")) act(b, () => api("/api/mod/staff/settings", { reset: true }), "Ajustes restablecidos.", () => show("admin-staff-ajustes")); }),
      d.updatedAt ? el("span", { class: "small muted" }, `Último cambio: ${d.updatedBy} · ${when(d.updatedAt)}`) : null) : el("div", { class: "notice" }, "Solo el Admin cambia estos valores. Así se mide tu rango.");
    s.replaceChildren(
      el("div", { class: "box" }, el("h2", {}, "Cuota semanal de conexión"), el("p", { class: "small muted" }, "Se cumple si juego + crédito de Discord llega a las horas y el juego llega al mínimo. Con más actividad en Discord se piden menos horas en el juego, nunca menos que el mínimo."), el("div", { class: "scrollx" }, weekly)),
      el("div", { class: "box" }, el("h2", {}, "Actividad en Discord"), discord),
      el("div", { class: "box" }, el("h2", {}, "Metas del mes"), el("p", { class: "small muted" }, "0 = esa tarea no se pide en ese rango. «Semanas con la cuota cumplida» nunca pide más semanas de las que tiene el mes."), el("div", { class: "scrollx" }, targets)),
      el("div", { class: "box" }, el("h2", {}, "Requisitos de ascenso"), el("p", { class: "small muted" }, "Para que el propio miembro pida el ascenso. Un rango superior puede proponerlo igual, y al final decide quien aprueba (a Moderator, solo el Admin)."), el("div", { class: "scrollx" }, promo)),
      el("div", { class: "box" }, el("h2", {}, "Faltas, avisos y excusas"), rules),
      save);
  }

  // ---------- Arranque ----------
  async function start() {
    const params = new URLSearchParams(location.search);
    const loginErr = params.get("error");
    if (loginErr) { history.replaceState(null, "", location.pathname + location.hash); }
    try {
      [me, program] = await Promise.all([api("/api/me"), program ? Promise.resolve(program) : api("/api/creators/program")]);
    } catch {
      $("view-login").hidden = false;
      return flash("No pudimos conectar con el servidor. Inténtalo en un momento.", "bad");
    }
    if (loginErr) flash(LOGIN_ERRORS[loginErr] || "No se pudo iniciar sesión.", "bad");
    if (!me.user) {
      $("view-app").hidden = true; $("who").hidden = true; $("view-login").hidden = false;
      document.body.classList.remove("is-app"); $("nav").replaceChildren(); $("page-title").textContent = "Panel";
      $("login-btn").href = `/api/auth/discord/login?next=${encodeURIComponent("/creadores/panel/" + (location.hash || ""))}`;
      if (!me.discord) flash(LOGIN_ERRORS.discord_off, "bad");
      return;
    }
    $("view-login").hidden = true; $("view-app").hidden = false; $("who").hidden = false;
    document.body.classList.add("is-app");
    const u = me.user;
    $("who-pic").src = u.avatar || "/img/icon-192.png";
    $("who-name").textContent = u.globalName || u.username;
    const RANK_NAME = { Helper: "Helper", ModeratorJr: "Moderator Jr", Moderator: "Moderator" };
    $("who-badges").replaceChildren(...[
      u.roles.admin && el("span", { class: "badge badge--admin" }, "Admin"),
      !u.roles.admin && u.roles.staffRank && el("span", { class: `badge badge--staff badge--${u.roles.staffRank}` }, RANK_NAME[u.roles.staffRank]),
      !u.roles.admin && !u.roles.staffRank && u.roles.moderator && el("span", { class: "badge badge--mod" }, "Moderador"),
      u.roles.creator && el("span", { class: "badge badge--creator" }, "Creador"),
    ].filter(Boolean));
    if (!staffProgram) staffProgram = await api("/api/staff/program").catch(() => null);
    renderNav();
    if (isModJr()) loadQueue().catch(() => {});
    show((location.hash || "#inicio").slice(1));
  }

  $("burger").addEventListener("click", () => document.body.classList.toggle("nav-open"));
  $("scrim").addEventListener("click", () => document.body.classList.remove("nav-open"));
  $("logout").addEventListener("click", async () => {
    await api("/api/auth/logout", {}).catch(() => {});
    me = null; creator = null; queue = null;
    start();
  });
  window.addEventListener("hashchange", () => { if (me?.user) show(location.hash.slice(1)); });
  start();
})();
