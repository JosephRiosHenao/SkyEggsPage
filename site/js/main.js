// Sky Eggs: huevo interactivo conectado al juego.
// El resultado lo decide el servidor (/api/roll); aquí solo se anima.
(() => {
  const year = document.getElementById("year");
  if (year) year.textContent = String(new Date().getFullYear());

  const egg = document.getElementById("egg");
  if (!egg) return;
  const $ = (id) => document.getElementById(id);
  const result = $("egg-result");
  const again = $("egg-again");
  const confetti = $("confetti");
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const TIERS = {
    common: { name: "¡Común!", odds: "8 de cada 10 huevos", color: "#D7E3F4" },
    uncommon: { name: "¡Poco común!", odds: "1 de cada 7 huevos", color: "#5BE07A" },
    rare: { name: "¡Raro!", odds: "1 de cada 25 huevos", color: "#4FB4FF" },
    epic: { name: "¡Épico!", odds: "1 de cada 133 huevos", color: "#C77DFF" },
    legendary: { name: "¡Legendario!", odds: "1 de cada 500 huevos", color: "#FFC21A", pet: "legendaria" },
    mythic: { name: "¡MÍTICO!", odds: "1 de cada 2.000 huevos", color: "#FF6FAE", pet: "mítica" },
  };
  const TAPS = 3;
  let taps = 0;
  let busy = false;

  // ---------- Almacenamiento (puede no existir en algunos navegadores) ----------
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* sin almacenamiento */ } },
  };
  let mode = store.get("se_mode") === "code" ? "code" : "mail";
  let me = store.get("se_player"); // { userId, name, displayName, avatar }

  const api = async (path, body) => {
    const res = await fetch(path, body === undefined
      ? { headers: { accept: "application/json" } }
      : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || "error"), { status: res.status });
    return data;
  };
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  api("/api/visit", {}).catch(() => {});

  // ---------- Pestañas ----------
  const tabs = { mail: $("tab-mail"), code: $("tab-code") };
  const panels = { mail: $("panel-mail"), code: $("panel-code") };
  const setMode = (m) => {
    mode = m;
    store.set("se_mode", m);
    for (const k of Object.keys(tabs)) {
      tabs[k].setAttribute("aria-selected", String(k === m));
      tabs[k].tabIndex = k === m ? 0 : -1;
      panels[k].hidden = k !== m;
    }
  };
  for (const k of Object.keys(tabs)) {
    tabs[k].addEventListener("click", () => setMode(k));
    tabs[k].addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        const next = k === "mail" ? "code" : "mail";
        setMode(next);
        tabs[next].focus();
      }
    });
  }

  // ---------- Buscar la cuenta (usuario o nombre visible) ----------
  const finder = $("finder");
  const input = $("finder-q");
  const help = $("finder-help");
  const list = $("finder-list");
  const meBox = $("me");
  const helpText = help.textContent;
  const say = (text, isError) => { help.textContent = text; help.classList.toggle("is-error", Boolean(isError)); };

  const renderMe = async () => {
    const has = Boolean(me && me.userId);
    finder.hidden = has;
    meBox.hidden = !has;
    list.replaceChildren();
    if (!has) return;
    $("me-pic").src = /^https:\/\/[a-z0-9.-]+\.rbxcdn\.com\//.test(me.avatar || "") ? me.avatar : "/img/icon-192.png";
    $("me-name").textContent = me.displayName && me.displayName !== me.name ? `${me.displayName} (@${me.name})` : `@${me.name}`;
    $("me-left").textContent = "";
    try {
      const r = await api(`/api/players/remaining?userId=${me.userId}`);
      $("me-left").textContent = `Hoy te quedan ${r.remaining.mythic} míticas y ${r.remaining.legendary} legendarias.`;
    } catch { /* no es grave */ }
  };

  const choose = (p) => {
    me = { userId: p.userId, name: p.name, displayName: p.displayName, avatar: p.avatar };
    store.set("se_player", me);
    renderMe();
    say(helpText);
  };

  finder.addEventListener("submit", async (e) => {
    e.preventDefault();
    const q = input.value.trim().replace(/^@/, "");
    if (q.length < 3) return say("Escribe al menos 3 letras.", true);
    say("Buscando…");
    list.replaceChildren();
    try {
      const r = await api(`/api/players/search?q=${encodeURIComponent(q)}`);
      if (!r.players.length) return say("No encontramos esa cuenta. Revisa cómo se escribe.", true);
      say(r.players.length === 1 ? "¿Eres tú?" : "¿Cuál eres tú?");
      for (const p of r.players) {
        const li = el("li");
        const b = el("button", "pick");
        b.type = "button";
        const img = el("img", "pick__pic");
        img.src = p.avatar || "/img/icon-192.png";
        img.alt = "";
        img.width = 52; img.height = 52;
        const text = el("span", "pick__text");
        text.append(el("span", "pick__dn", p.displayName), el("br"), el("span", "pick__un", `@${p.name}`));
        if (p.played) { text.append(el("br"), el("span", "pick__badge", "Juega Sky Eggs")); }
        b.append(img, text, el("span", "pick__go", "¡Soy yo!"));
        b.setAttribute("aria-label", `${p.displayName}, @${p.name}${p.played ? ", juega Sky Eggs" : ""}. Elegir esta cuenta`);
        b.addEventListener("click", () => choose(p));
        li.append(b);
        list.append(li);
      }
      list.querySelector("button")?.focus();
    } catch (err) {
      say(err.status === 429 ? "Vas muy rápido. Espera un momento." : "No pudimos buscar ahora. Intenta otra vez.", true);
    }
  });

  $("me-change").addEventListener("click", () => {
    me = null;
    store.del("se_player");
    renderMe();
    input.focus();
  });

  // ---------- Huevo ----------
  const hint = (text) => {
    const left = TAPS - taps;
    result.style.removeProperty("--tier");
    result.innerHTML = "";
    result.append(el("p", "egg-result__hint"));
    const p = result.firstChild;
    if (text) p.textContent = text;
    else { p.append("Faltan ", el("b", null, String(left)), ` ${left === 1 ? "toque" : "toques"}`); }
  };

  const burst = (color) => {
    if (reduced) return;
    const colors = [color, "#FFC21A", "#FF6FAE", "#4FB4FF", "#FFFFFF"];
    const frag = document.createDocumentFragment();
    for (let i = 0; i < 36; i++) {
      const p = document.createElement("i");
      const a = Math.random() * Math.PI * 2;
      const d = 120 + Math.random() * 170;
      p.style.setProperty("--x", `${Math.cos(a) * d}px`);
      p.style.setProperty("--y", `${Math.sin(a) * d - 60}px`);
      p.style.setProperty("--r", `${Math.random() * 720 - 360}deg`);
      p.style.setProperty("--c", colors[i % colors.length]);
      p.style.animationDelay = `${Math.random() * 0.08}s`;
      frag.appendChild(p);
    }
    confetti.replaceChildren(frag);
  };

  const prizeLines = (tier, r) => {
    const info = TIERS[tier];
    const out = [];
    if (r.code) {
      out.push(el("p", "egg-result__prize", `¡Ganaste una mascota ${info.pet}! Tu código:`));
      const box = el("div", "code-box");
      const pretty = `${r.code.slice(0, 3)}-${r.code.slice(3, 8)}-${r.code.slice(8)}`;
      const code = el("span", "code-box__code", pretty);
      const copy = el("button", "btn btn--yolk btn--sm", "Copiar");
      copy.type = "button";
      copy.addEventListener("click", async () => {
        try { await navigator.clipboard.writeText(r.code); copy.textContent = "¡Copiado!"; } catch { copy.textContent = "Cópialo a mano"; }
      });
      box.append(code, copy);
      out.push(box);
      const days = Math.max(1, Math.round((r.expiresAt - Date.now()) / 86_400_000));
      out.push(el("p", "egg-result__sub", `Canjéalo en el juego: Tienda → Códigos. Vence en ${days} ${days === 1 ? "día" : "días"} y solo sirve una vez.`));
    } else if (r.reward) {
      out.push(el("p", "egg-result__prize", `¡Mascota ${info.pet} enviada a tu buzón! 🎁`));
      out.push(el("p", "egg-result__sub", r.reward.needsLevel
        ? `Te llega cuando seas nivel ${r.reward.needsLevel} en el juego. Ábrela en el buzón del Lobby.`
        : "Entra al juego y ábrela en el buzón del Lobby."));
    } else if (r.capped) {
      out.push(el("p", "egg-result__prize", `Ya cobraste todas las mascotas ${info.pet}s de hoy.`));
      out.push(el("p", "egg-result__sub", "Vuelve mañana para ganar más."));
    }
    return out;
  };

  const open = async () => {
    busy = true;
    egg.setAttribute("aria-busy", "true");
    let r;
    try {
      r = await api("/api/roll", mode === "mail" ? { mode: "user", userId: me.userId } : { mode: "code" });
    } catch (err) {
      busy = false;
      egg.removeAttribute("aria-busy");
      taps = TAPS - 1;
      egg.dataset.taps = String(taps);
      if (err.message === "unknown_player") { me = null; store.del("se_player"); renderMe(); }
      hint(err.status === 429 ? "¡Despacio! Espera unos segundos y toca otra vez." : "No pudimos abrir el huevo. Toca otra vez.");
      return;
    }
    busy = false;
    egg.removeAttribute("aria-busy");
    const tier = TIERS[r.tier] ? r.tier : "common";
    const info = TIERS[tier];
    egg.style.setProperty("--tier", info.color);
    egg.classList.add("is-open");
    egg.setAttribute("aria-label", "Huevo abierto");
    egg.setAttribute("aria-disabled", "true");
    result.style.setProperty("--tier", info.color);
    result.replaceChildren(el("p", "egg-result__tier", info.name), el("p", "egg-result__odds", `Sale ${info.odds}.`), ...prizeLines(tier, r));
    again.hidden = false;
    burst(info.color);
    if (r.remaining && me) $("me-left").textContent = `Hoy te quedan ${r.remaining.mythic} míticas y ${r.remaining.legendary} legendarias.`;
  };

  egg.addEventListener("click", () => {
    if (busy || egg.classList.contains("is-open")) return;
    if (mode === "mail" && !(me && me.userId)) {
      hint("Primero escribe tu usuario de Roblox arriba, o elige “Quiero un código”.");
      input.focus();
      return;
    }
    taps += 1;
    egg.dataset.taps = String(taps);
    egg.classList.remove("is-shaking");
    void egg.offsetWidth; // reinicia la animación
    egg.classList.add("is-shaking");
    if (taps >= TAPS) open(); else hint();
  });

  again.addEventListener("click", () => {
    taps = 0;
    delete egg.dataset.taps;
    egg.classList.remove("is-open", "is-shaking");
    egg.removeAttribute("aria-disabled");
    egg.setAttribute("aria-label", "Tocar el huevo");
    confetti.replaceChildren();
    again.hidden = true;
    hint();
    egg.focus();
  });

  setMode(mode);
  renderMe();
})();
