// Sky Eggs: huevo interactivo
(() => {
  const year = document.getElementById("year");
  if (year) year.textContent = String(new Date().getFullYear());

  const egg = document.getElementById("egg");
  if (!egg) return;
  const result = document.getElementById("egg-result");
  const again = document.getElementById("egg-again");
  const confetti = document.getElementById("confetti");
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Probabilidades base de las mascotas en el juego (masa por rareza).
  const TIERS = [
    { name: "¡Común!", chance: 80, odds: "8 de cada 10 huevos", color: "#D7E3F4" },
    { name: "¡Poco común!", chance: 15, odds: "1 de cada 7 huevos", color: "#5BE07A" },
    { name: "¡Raro!", chance: 4, odds: "1 de cada 25 huevos", color: "#4FB4FF" },
    { name: "¡Épico!", chance: 0.75, odds: "1 de cada 133 huevos", color: "#C77DFF" },
    { name: "¡Legendario!", chance: 0.2, odds: "1 de cada 500 huevos", color: "#FFC21A" },
    { name: "¡MÍTICO!", chance: 0.05, odds: "1 de cada 2.000 huevos", color: "#FF6FAE" },
  ];
  const TAPS = 3;
  let taps = 0;

  const roll = () => {
    let r = Math.random() * 100;
    for (const t of TIERS) { if ((r -= t.chance) < 0) return t; }
    return TIERS[0];
  };

  const hint = () => {
    const left = TAPS - taps;
    result.innerHTML = `<p class="egg-result__hint" id="egg-hint">Faltan <b>${left}</b> ${left === 1 ? "toque" : "toques"}</p>`;
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

  const open = () => {
    const tier = roll();
    egg.style.setProperty("--tier", tier.color);
    egg.classList.add("is-open");
    egg.setAttribute("aria-label", "Huevo abierto");
    egg.setAttribute("aria-disabled", "true");
    result.style.setProperty("--tier", tier.color);
    result.innerHTML = `<p class="egg-result__tier">${tier.name}</p><p class="egg-result__odds">Sale ${tier.odds}.</p>`;
    again.hidden = false;
    burst(tier.color);
  };

  egg.addEventListener("click", () => {
    if (egg.classList.contains("is-open")) return;
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
})();
