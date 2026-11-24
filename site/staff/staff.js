// Carrusel "Nuestro staff" de /staff/ (GET /api/staff/public): conectados primero, con botón para
// entrar a su servidor del juego. Mismo estilo que el carrusel de creadores. Todo con textContent.
(() => {
  const root = document.querySelector("[data-staff]");
  if (!root) return;
  const track = root.querySelector(".cc__track");
  const prev = root.querySelector(".cc__prev");
  const next = root.querySelector(".cc__next");
  const RANK = {
    Moderator: { name: "Moderator", emoji: "⚔️", color: "#22C55E" },
    ModeratorJr: { name: "Moderator Jr", emoji: "🛡️", color: "#10B981" },
    Helper: { name: "Helper", emoji: "🛟", color: "#38BDF8" },
  };
  const SEEN = { today: "Visto hoy", week: "Visto esta semana", older: "Hace tiempo que no entra" };
  const GAME = "https://www.roblox.com/es/games/77372347150746/Huevos-del-cielo";

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const safeJoin = (u) => { try { const x = new URL(u); return x.protocol === "https:" && x.hostname === "www.roblox.com" ? x.href : null; } catch { return null; } };

  function card(m) {
    const r = RANK[m.rank] || RANK.Helper;
    const art = el("article", `cc__card st-card${m.online ? " is-online" : ""}`);
    art.setAttribute("role", "listitem");
    const picWrap = el("div", "st-card__pic");
    const pic = el("img", "cc__pic");
    pic.src = m.avatar || "/img/icon-192.png";
    pic.alt = "";
    pic.width = 96; pic.height = 96;
    pic.loading = "lazy";
    const dot = el("span", "st-card__dot");
    dot.setAttribute("aria-hidden", "true");
    picWrap.append(pic, dot);
    const badge = el("span", "cc__tier", `${r.emoji} ${r.name}`);
    badge.style.setProperty("--tier", r.color); // CSP: sin style en línea
    const name = el("h3", "cc__name", m.name);
    const user = el("p", "cc__user", `@${m.username}`);
    const status = el("p", `st-card__status${m.online ? " is-online" : ""}`, m.online ? "● Conectado ahora" : SEEN[m.seen] || "Sin conexión");
    art.append(picWrap, badge, name, user, status);
    const join = m.online ? safeJoin(m.joinUrl) : null;
    if (join) {
      const a = el("a", "btn btn--yolk btn--sm st-card__join", "Unirme a su servidor");
      a.href = join; a.target = "_blank"; a.rel = "noopener noreferrer";
      a.setAttribute("aria-label", `Unirme al servidor de ${m.name} en Sky Eggs`);
      art.append(a);
    } else if (m.online) {
      const a = el("a", "btn btn--white btn--sm st-card__join", "Jugar Sky Eggs");
      a.href = GAME; a.target = "_blank"; a.rel = "noopener noreferrer";
      art.append(a);
    }
    const prof = el("a", "cc__roblox", "Perfil de Roblox");
    prof.href = `https://www.roblox.com/users/${Number(m.userId)}/profile`;
    prof.target = "_blank"; prof.rel = "noopener noreferrer";
    art.append(prof);
    return art;
  }

  const step = () => (track.firstElementChild ? track.firstElementChild.getBoundingClientRect().width + 16 : 280);
  const update = () => {
    prev.disabled = track.scrollLeft <= 4;
    next.disabled = track.scrollLeft + track.clientWidth >= track.scrollWidth - 4;
  };
  prev.addEventListener("click", () => track.scrollBy({ left: -step(), behavior: "smooth" }));
  next.addEventListener("click", () => track.scrollBy({ left: step(), behavior: "smooth" }));
  track.addEventListener("scroll", () => requestAnimationFrame(update), { passive: true });
  window.addEventListener("resize", update);

  let paused = matchMedia("(prefers-reduced-motion: reduce)").matches;
  for (const ev of ["pointerenter", "focusin", "touchstart"]) root.addEventListener(ev, () => { paused = true; }, { passive: true });
  setInterval(() => {
    if (paused || document.hidden || track.scrollWidth <= track.clientWidth) return;
    const atEnd = track.scrollLeft + track.clientWidth >= track.scrollWidth - 4;
    track.scrollTo({ left: atEnd ? 0 : track.scrollLeft + step(), behavior: "smooth" });
  }, 5000);

  const load = () => fetch("/api/staff/public", { credentials: "omit" })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then((data) => {
      const list = Array.isArray(data.staff) ? data.staff : [];
      if (!list.length) return;
      const keep = track.scrollLeft;
      track.replaceChildren(...list.map(card));
      track.scrollLeft = keep;
      root.querySelector("[data-staff-online]").textContent = String(data.online || 0);
      root.hidden = false;
      update();
    })
    .catch(() => { /* sin API: la sección queda oculta */ });
  load();
  setInterval(() => { if (!document.hidden) load(); }, 90_000); // quién está conectado cambia
})();
