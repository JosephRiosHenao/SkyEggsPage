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
    bad_roblox: "Escribe tu usuario de Roblox (3 a 20 letras, números o _).",
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
    if (!res.ok) throw Object.assign(new Error(data.error || "error"), { status: res.status });
    return data;
  }
  function flash(text, kind = "ok") {
    const box = el("div", { class: `notice notice--${kind}` }, text);
    $("flash").replaceChildren(box);
    box.scrollIntoView({ block: "nearest", behavior: "smooth" });
    if (kind === "ok") setTimeout(() => box.remove(), 6000);
  }
  const errText = (e) => ERRORS[e.message] || "Algo salió mal. Inténtalo de nuevo.";
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
  let me = null;          // { user, application }
  let program = null;     // niveles y packs
  let creator = null;     // estado del creador
  let queue = null;       // cola de moderación
  let current = null;

  const roles = () => me?.user?.roles || {};
  const isCreator = () => roles().creator || roles().admin;
  const isMod = () => roles().moderator || roles().admin;

  function tabList() {
    const t = [["inicio", "Inicio"]];
    if (!isCreator() && !isMod()) t.push(["aplicar", "Aplicar"]);
    if (isCreator()) t.push(["metas", "Metas"], ["evidencias", "Evidencias"], ["roblox", "Mi Roblox"], ["bonos", "Bonos"]);
    t.push(["comandos", "Comandos"]);
    if (isMod()) t.push(["moderacion", "Moderación"]);
    t.push(["guia", "Guía"]);
    return t;
  }

  function renderTabs() {
    const pending = queue ? queue.applications.length + queue.links.length + queue.evidences.length + queue.bonuses.length + queue.specials.length : 0;
    $("tabs").replaceChildren(...tabList().map(([key, label]) => el("button", {
      class: "tab", role: "tab", type: "button", "aria-selected": String(key === current), "aria-controls": `tab-${key}`,
      onclick: () => { location.hash = key; },
    }, label, key === "moderacion" && pending ? el("span", { class: "count" }, String(pending)) : null)));
  }

  async function show(key) {
    const allowed = tabList().map((t) => t[0]);
    if (!allowed.includes(key)) key = allowed.includes("metas") ? "metas" : "inicio";
    current = key;
    for (const s of document.querySelectorAll("[data-tab]")) { s.hidden = s.dataset.tab !== key; s.id = `tab-${s.dataset.tab}`; }
    renderTabs();
    const section = document.querySelector(`[data-tab="${key}"]`);
    try {
      if (RENDER[key]) await RENDER[key](section);
    } catch (e) {
      if (e.status === 401) return start();
      section.replaceChildren(el("div", { class: "notice notice--bad" }, errText(e)));
    }
  }

  // ---------- Secciones ----------
  const RENDER = {
    async inicio(s) {
      const u = me.user;
      const box = el("div", { class: "box" }, el("h2", {}, `Hola, ${u.globalName || u.username}`));
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
      if (isMod()) add(true, roles().admin ? "Eres el admin" : "Eres moderador", "Revisa la pestaña Moderación y la Guía para moderadores.", "moderacion");
      box.append(steps);
      s.replaceChildren(box);
    },

    async aplicar(s) {
      const a = me.application;
      const box = el("div", { class: "box", id: "aplicar" }, el("h2", {}, "Aplica al programa"));
      if (a && a.status !== "rejected") {
        const map = { pending: ["pending", "En revisión", "Un moderador la revisará pronto y te escribirá por Discord."], contacted: ["contacted", "Contactado", "Un moderador te escribió por Discord. Revisa tus mensajes."], approved: ["approved", "Aprobada", "Espera a que te den el rol de Content Creator en Discord y vuelve a entrar en esta página."] };
        const [cls, label, text] = map[a.status];
        box.append(el("p", {}, "Estado de tu solicitud: ", pill(cls, label)), el("p", { class: "muted" }, text));
        if (a.review_note) box.append(el("p", {}, el("strong", {}, "Nota del moderador: "), a.review_note));
        return s.replaceChildren(box);
      }
      if (a?.status === "rejected") box.append(el("div", { class: "notice notice--bad" }, `Tu última solicitud fue rechazada${a.review_note ? `: ${a.review_note}` : "."} Puedes volver a aplicar 7 días después.`));
      const platformRow = (i) => el("div", { class: "row" },
        el("label", {}, "Red", el("select", { name: `ptype${i}` }, ...["YouTube", "TikTok", "Twitch", "Kick", "Instagram", "Facebook", "Otra"].map((p) => el("option", {}, p)))),
        el("label", {}, "Enlace a tu perfil o canal", el("input", { name: `purl${i}`, type: "url", placeholder: "https://…", maxlength: "400", required: i === 0 })),
        el("label", {}, "Seguidores", el("input", { name: `pfol${i}`, type: "number", min: "0", placeholder: "0" })));
      const form = el("form", { class: "form" },
        el("label", {}, "Tu usuario de Roblox", el("input", { name: "robloxName", required: true, maxlength: "32", placeholder: "Ej: PepitoGamer" })),
        el("p", { class: "hint" }, "Tu Discord ya lo tenemos: es la cuenta con la que entraste."),
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
        act(e.submitter, () => api("/api/creators/apply", { robloxName: f.get("robloxName"), email: f.get("email"), sampleUrl: f.get("sampleUrl"), about: f.get("about"), age13: f.get("age13") === "on", platforms }),
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
      const hist = el("div", { class: "box" }, el("h2", {}, "Lo que ya reclamaste"),
        creator.claims.length ? el("table", { class: "tbl" }, el("thead", {}, el("tr", {}, el("th", {}, "Periodo"), el("th", {}, "Pack"), el("th", {}, "Vistas"), el("th", {}, "Fecha"))),
          el("tbody", {}, ...creator.claims.map((c) => el("tr", {}, el("td", {}, c.type === "week" ? `Semana ${c.key}` : `Mes ${c.key}`), el("td", {}, c.pack), el("td", {}, n(c.views)), el("td", {}, when(c.createdAt))))))
          : el("p", { class: "empty" }, "Todavía nada. ¡Sube tu primer video!"));
      s.replaceChildren(...[warn, wk, mo, hist].filter(Boolean));
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
          el("p", { class: "muted" }, "Ya puedes quitar el código de tu perfil. Para cambiar de cuenta, habla con un moderador."));
        return s.replaceChildren(box);
      }
      if (l.status === "pending") {
        box.append(el("div", { class: "notice" }, "En revisión. Haz esto para que el moderador pueda aprobarla:"),
          el("ol", { class: "guide-inline" },
            el("li", {}, "Copia este código: ", el("span", { class: "code-big" }, l.code)),
            el("li", {}, "Ponlo en la descripción (Acerca de) de tu perfil de Roblox: ", link(`https://www.roblox.com/users/${l.roblox.userId}/profile`, `@${l.roblox.name}`), "."),
            el("li", {}, "Avisa a un moderador en Discord. Cuando lo apruebe, ya puedes quitarlo.")));
      }
      if (l.status === "rejected") box.append(el("div", { class: "notice notice--bad" }, `La vinculación anterior fue rechazada${l.note ? `: ${l.note}` : "."} Puedes pedirla otra vez.`));
      const picks = el("div", { class: "picks" });
      const form = el("form", { class: "form" },
        el("label", {}, l.status === "pending" ? "¿Te equivocaste de cuenta? Búscala otra vez" : "Busca tu cuenta (usuario o nombre visible)",
          el("div", { class: "form-actions" }, el("input", { name: "q", required: true, minlength: "3", maxlength: "32", placeholder: "Ej: PepitoGamer" }), el("button", { class: "btn btn--sm btn--white", type: "submit" }, "Buscar"))));
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        picks.replaceChildren(el("p", { class: "small muted" }, "Buscando…"));
        try {
          const r = await api(`/api/players/search?q=${encodeURIComponent(new FormData(form).get("q"))}`);
          picks.replaceChildren(...(r.players.length ? r.players.map((p) => el("button", {
            class: "pickrow", type: "button",
            onclick: (ev) => act(ev.currentTarget, () => api("/api/creators/link", { userId: p.userId }), "Listo. Ahora pon el código en tu perfil de Roblox.", () => show("roblox")),
          }, el("img", { src: p.avatar || "/img/icon-192.png", alt: "" }), el("span", {}, el("strong", {}, p.displayName), ` @${p.name}${p.played ? " · juega Sky Eggs" : ""}`))) : [el("p", { class: "empty" }, "No encontramos esa cuenta.")]));
        } catch (err) { picks.replaceChildren(el("p", { class: "notice notice--bad" }, errText(err))); }
      });
      box.append(form, picks);
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

    async moderacion(s) {
      queue = await api("/api/mod/queue");
      renderTabs();
      const admin = queue.actor.role === "admin";
      const sub = el("nav", { class: "tabs" });
      const body = el("div");
      const views = [
        ["solicitudes", `Solicitudes (${queue.applications.length})`, () => modApplications(body)],
        ["vinculos", `Vinculaciones (${queue.links.length})`, () => modLinks(body)],
        ["evidencias", `Evidencias (${queue.evidences.length})`, () => modEvidences(body)],
        ["bonos", `Bonos Robux (${queue.bonuses.length})`, () => modBonuses(body, admin)],
        ...(admin ? [["especiales", `Pedidos especiales (${queue.specials.length})`, () => modSpecials(body)]] : []),
        ["creadores", "Creadores", () => modCreators(body)],
        ["registro", "Registro", () => modAudit(body)],
      ];
      let active = sessionStorage.getItem("se_modtab") || "solicitudes";
      if (!views.some((v) => v[0] === active)) active = "solicitudes";
      const paint = () => {
        sub.replaceChildren(...views.map(([k, label, fn]) => el("button", { class: "tab", type: "button", "aria-selected": String(k === active), onclick: () => { active = k; try { sessionStorage.setItem("se_modtab", k); } catch { /* sin almacenamiento */ } paint(); } }, label)));
        const v = views.find((x) => x[0] === active);
        Promise.resolve(v[2]()).catch((e) => body.replaceChildren(el("div", { class: "notice notice--bad" }, errText(e))));
      };
      paint();
      s.replaceChildren(el("div", { class: "box" }, el("h2", {}, admin ? "Moderación (admin)" : "Moderación"),
        el("p", { class: "small muted" }, `Actúas como ${queue.actor.name}. Todo lo que hagas queda en el Registro.`), sub, body));
    },
  };

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
  const refreshMod = () => show("moderacion");
  const noteInput = (ph = "Nota (se guarda en el registro)") => el("input", { class: "wide", placeholder: ph, maxlength: "500" });
  const btn = (text, cls, fn) => el("button", { class: `btn btn--mini ${cls}`, type: "button", onclick: (e) => fn(e.currentTarget) }, text);
  const empty = (t) => el("p", { class: "empty" }, t);

  function modApplications(body) {
    const items = queue.applications.map((a) => {
      const note = noteInput();
      return el("article", { class: "item" },
        el("div", { class: "item__head" }, el("span", { class: "item__title" }, `${userLine(a.user)}`), pill(a.status, a.status === "contacted" ? "Contactado" : "Nueva")),
        el("p", { class: "item__meta" }, `Roblox: ${a.roblox_name}${a.email ? ` · ${a.email}` : ""} · enviada ${when(a.created_at)}`),
        el("ul", { class: "item__meta" }, ...a.platforms.map((p) => el("li", {}, `${p.type}: `, link(p.url, p.url), p.followers ? ` · ${n(p.followers)} seguidores` : ""))),
        a.sample_url ? el("p", { class: "item__meta" }, "Video de ejemplo: ", link(a.sample_url, a.sample_url)) : null,
        el("p", { class: "item__meta" }, a.about),
        a.review_note ? el("p", { class: "item__meta" }, `Nota (${a.reviewed_by}): ${a.review_note}`) : null,
        el("div", { class: "item__actions" }, note,
          a.status === "pending" ? btn("Contactado", "btn--white", (b) => act(b, () => api("/api/mod/application", { id: a.id, action: "contacted", note: note.value }), "Marcada como contactada.", refreshMod)) : null,
          btn("Aprobar", "btn--green", (b) => act(b, () => api("/api/mod/application", { id: a.id, action: "approve", note: note.value }), "Aprobada. Dale el rol de Content Creator en Discord y ;SetCreator en el juego.", refreshMod)),
          btn("Rechazar", "btn--red", (b) => { if (!note.value.trim()) return flash("Escribe el motivo en la nota.", "bad"); act(b, () => api("/api/mod/application", { id: a.id, action: "reject", note: note.value }), "Rechazada.", refreshMod); })));
    });
    body.replaceChildren(...(items.length ? [el("div", { class: "list" }, ...items)] : [empty("No hay solicitudes pendientes.")]));
  }

  function modLinks(body) {
    const items = queue.links.map((c) => {
      const note = noteInput();
      return el("article", { class: "item" },
        el("div", { class: "item__head" }, el("span", { class: "item__title" }, userLine(c.user)), el("span", { class: "code-big" }, c.link_code)),
        el("p", { class: "item__meta" }, "Roblox: ", link(`https://www.roblox.com/users/${c.roblox_user_id}/profile`, `@${c.roblox_name} (${c.roblox_display})`), ` · id ${c.roblox_user_id} · pedido ${when(c.link_requested_at)}`),
        el("p", { class: "item__meta" }, "Abre el perfil y comprueba que el código esté en la descripción."),
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

  async function modCreators(body) {
    const { creators } = await api("/api/mod/creators");
    const label = { approved: "Vinculado", pending: "En revisión", rejected: "Rechazado", none: "Sin vincular" };
    body.replaceChildren(creators.length ? el("div", { class: "scrollx" }, el("table", { class: "tbl" },
      el("thead", {}, el("tr", {}, ...["Creador", "Roblox", "Semana", "Mes", "Videos (mes)", "Último pack"].map((h) => el("th", {}, h)))),
      el("tbody", {}, ...creators.map((c) => el("tr", {},
        el("td", {}, c.global_name ? `${c.global_name} (@${c.username})` : `@${c.username}`),
        el("td", {}, c.roblox_name ? `@${c.roblox_name} · ${label[c.link_status] || ""}` : label.none),
        el("td", {}, n(c.week_views)), el("td", {}, n(c.month_views)), el("td", {}, String(c.month_videos)), el("td", {}, c.last_pack || "—"))))))
      : empty("Todavía no hay creadores."));
  }

  const ACTION_TEXT = {
    "application.approve": "aprobó la solicitud de", "application.reject": "rechazó la solicitud de", "application.contacted": "contactó a",
    "link.approve": "aprobó la vinculación de", "link.reject": "rechazó la vinculación de",
    "evidence.approve": "aprobó una evidencia de", "evidence.probe": "volvió a leer las vistas de una evidencia", "evidence.reject": "rechazó una evidencia de", "evidence.update": "actualizó las vistas de",
    "bonus.approve": "aprobó un bono de", "bonus.reject": "rechazó un bono de", "bonus.paid": "pagó el bono de",
    "special.approve": "aprobó el pedido de", "special.reject": "rechazó el pedido de", "special.done": "cumplió el pedido de",
    claim: "reclamó un pack para", "codes.create": "generó códigos", "gift.send": "envió un regalo a", upload: "subió una captura",
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
      $("login-btn").href = `/api/auth/discord/login?next=${encodeURIComponent("/creadores/panel/" + (location.hash || ""))}`;
      if (!me.discord) flash(LOGIN_ERRORS.discord_off, "bad");
      return;
    }
    $("view-login").hidden = true; $("view-app").hidden = false; $("who").hidden = false;
    const u = me.user;
    $("who-pic").src = u.avatar || "/img/icon-192.png";
    $("who-name").textContent = u.globalName || u.username;
    $("who-badges").replaceChildren(...[
      u.roles.admin && el("span", { class: "badge badge--admin" }, "Admin"),
      !u.roles.admin && u.roles.moderator && el("span", { class: "badge badge--mod" }, "Moderador"),
      u.roles.creator && el("span", { class: "badge badge--creator" }, "Creador"),
    ].filter(Boolean));
    for (const b of document.querySelectorAll("[data-role]")) b.hidden = b.dataset.role === "admin" ? !u.roles.admin : !isMod();
    if (isMod()) api("/api/mod/queue").then((q) => { queue = q; renderTabs(); }).catch(() => {});
    show((location.hash || "#inicio").slice(1));
  }

  $("logout").addEventListener("click", async () => {
    await api("/api/auth/logout", {}).catch(() => {});
    me = null; creator = null; queue = null;
    start();
  });
  window.addEventListener("hashchange", () => { if (me?.user) show(location.hash.slice(1)); });
  start();
})();
