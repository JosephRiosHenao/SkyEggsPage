// Carrusel "Nuestros creadores": creadores aprobados del programa (GET /api/creators/public).
// Se usa en la portada y en /creadores/. Todo el texto se pinta con textContent.
(() => {
  const root = document.querySelector("[data-creators]");
  if (!root) return;
  const track = root.querySelector(".cc__track");
  const prev = root.querySelector(".cc__prev");
  const next = root.querySelector(".cc__next");
  const fmt = new Intl.NumberFormat("es-CO", { notation: "compact", maximumFractionDigits: 1 });
  const ICON = { YouTube: "▶", TikTok: "♪", Twitch: "◆", Kick: "K", Instagram: "◎", Facebook: "f", Otra: "🔗" };

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const safeUrl = (u) => { try { const x = new URL(u); return x.protocol === "https:" || x.protocol === "http:" ? x.href : null; } catch { return null; } };

  function card(c) {
    const art = el("article", "cc__card");
    art.setAttribute("role", "listitem");
    const pic = el("img", "cc__pic");
    pic.src = c.avatar || "/img/icon-192.png";
    pic.alt = "";
    pic.width = 96; pic.height = 96;
    pic.loading = "lazy";
    const badge = el("span", "cc__tier", `${c.tierEmoji} ${c.tierName}`);
    badge.style.setProperty("--tier", c.tierColor); // CSP: sin style en línea
    const name = el("h3", "cc__name", c.name);
    const user = el("p", "cc__user", `@${c.username}`);
    const nets = el("ul", "cc__nets");
    for (const p of c.platforms.slice(0, 4)) {
      const href = safeUrl(p.url);
      if (!href) continue;
      const li = el("li");
      const a = el("a", "cc__net");
      a.href = href; a.target = "_blank"; a.rel = "noopener noreferrer nofollow";
      a.append(el("span", "cc__icon", ICON[p.type] || ICON.Otra), el("span", null, p.type));
      if (p.followers > 0) a.append(el("span", "cc__fol", fmt.format(p.followers)));
      a.setAttribute("aria-label", `${c.name} en ${p.type}${p.followers ? `, ${p.followers} seguidores` : ""}`);
      li.append(a);
      nets.append(li);
    }
    const play = el("a", "cc__roblox", "Perfil de Roblox");
    play.href = `https://www.roblox.com/users/${Number(c.userId)}/profile`;
    play.target = "_blank"; play.rel = "noopener noreferrer";
    art.append(pic, badge, name, user, nets, play);
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

  // Avance automático suave, que se detiene si el usuario interactúa o pide menos movimiento.
  let paused = matchMedia("(prefers-reduced-motion: reduce)").matches;
  for (const ev of ["pointerenter", "focusin", "touchstart"]) root.addEventListener(ev, () => { paused = true; }, { passive: true });
  setInterval(() => {
    if (paused || document.hidden || track.scrollWidth <= track.clientWidth) return;
    const atEnd = track.scrollLeft + track.clientWidth >= track.scrollWidth - 4;
    track.scrollTo({ left: atEnd ? 0 : track.scrollLeft + step(), behavior: "smooth" });
  }, 5000);

  fetch("/api/creators/public", { credentials: "omit" })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then((data) => {
      const list = Array.isArray(data.creators) ? data.creators : [];
      if (!list.length) return; // sin creadores aún: la sección queda oculta
      track.replaceChildren(...list.map(card));
      const count = root.querySelector("[data-creators-count]");
      if (count) count.textContent = String(list.length);
      root.hidden = false;
      update();
    })
    .catch(() => { /* sin API: la sección queda oculta */ });
})();
