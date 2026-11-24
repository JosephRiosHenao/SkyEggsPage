// Panel de métricas de Prueba tu suerte.
(() => {
  const $ = (id) => document.getElementById(id);
  const fmt = new Intl.NumberFormat("es-CO");
  const n = (v) => fmt.format(v || 0);
  const TIERS = [
    ["common", "Común", "#9AA7BD", 80],
    ["uncommon", "Poco común", "#3FC35A", 15],
    ["rare", "Raro", "#4FB4FF", 4],
    ["epic", "Épico", "#C77DFF", 0.75],
    ["legendary", "Legendario", "#FFC21A", 0.2],
    ["mythic", "Mítico", "#FF6FAE", 0.05],
  ];
  const PET_NAME = { common: "común", uncommon: "poco común", rare: "rara", epic: "épica", legendary: "legendaria", mythic: "mítica" };
  const TIER_NAME = Object.fromEntries(TIERS.map((t) => [t[0], t[1]]));
  const TIER_COLOR = Object.fromEntries(TIERS.map((t) => [t[0], t[2]]));

  const el = (tag, attrs = {}, ...kids) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") node.className = v;
      else if (k === "style") node.style.cssText = v;
      else node.setAttribute(k, v);
    }
    for (const k of kids) node.append(k instanceof Node ? k : document.createTextNode(String(k)));
    return node;
  };
  const svgEl = (tag, attrs = {}) => {
    const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    return node;
  };

  const api = async (path, body) => {
    const res = await fetch(path, body === undefined
      ? { credentials: "same-origin" }
      : { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || "error"), { status: res.status });
    return data;
  };

  const show = (view) => { $("login").hidden = view !== "login"; $("dash").hidden = view !== "dash"; };

  // ---------- Login ----------
  $("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("login-err").textContent = "";
    try {
      await api("/api/admin/login", { user: $("login-user").value, password: $("login-pass").value });
      $("login-pass").value = "";
      start();
    } catch (err) {
      $("login-err").textContent = err.status === 429 ? "Demasiados intentos. Espera 15 minutos." : "Usuario o contraseña incorrectos.";
    }
  });
  $("logout").addEventListener("click", async () => {
    await api("/api/admin/logout", {}).catch(() => {});
    show("login");
  });

  // ---------- Gráfica de barras (una serie) con tooltip ----------
  const tip = $("tip");
  function barChart(host, points, label) {
    host.replaceChildren();
    const W = 640, H = 190, L = 34, B = 22, T = 8;
    const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": label, preserveAspectRatio: "none" });
    const max = Math.max(1, ...points.map((p) => p.v));
    // Tope del eje: 3 pasos enteros "redondos" (1, 2, 5, 10, 20, 50…).
    const step = (() => {
      const raw = Math.max(1, max / 3);
      const p = 10 ** Math.floor(Math.log10(raw));
      return [1, 2, 5, 10].map((m) => m * p).find((s2) => s2 >= raw);
    })();
    const nice = step * 3;
    for (let i = 0; i <= 3; i++) {
      const y = T + (H - B - T) * (1 - i / 3);
      svg.append(svgEl("line", { class: "gridline", x1: L, x2: W, y1: y, y2: y }));
      const t = svgEl("text", { class: "axis", x: L - 6, y: y + 4, "text-anchor": "end" });
      t.textContent = n(Math.round((nice * i) / 3));
      svg.append(t);
    }
    if (!points.some((p) => p.v > 0)) {
      const t = svgEl("text", { class: "empty", x: (W + L) / 2, y: H / 2, "text-anchor": "middle" });
      t.textContent = "Sin datos en este periodo";
      svg.append(t);
    }
    const slot = (W - L) / points.length;
    const bw = Math.max(2, Math.min(22, slot - 2));
    points.forEach((p, i) => {
      const h = ((H - B - T) * p.v) / nice;
      const x = L + i * slot + (slot - bw) / 2;
      const hit = svgEl("rect", { class: "hit", x: L + i * slot, y: T, width: slot, height: H - B - T });
      const r = Math.min(4, bw / 2, h);
      const bar = svgEl("path", {
        class: "bar",
        d: h <= 0 ? "" : `M${x},${H - B} V${H - B - h + r} Q${x},${H - B - h} ${x + r},${H - B - h} H${x + bw - r} Q${x + bw},${H - B - h} ${x + bw},${H - B - h + r} V${H - B} Z`,
      });
      hit.addEventListener("mousemove", (e) => {
        tip.hidden = false;
        tip.textContent = `${p.day}: ${n(p.v)}`;
        tip.style.left = `${e.clientX + 12}px`;
        tip.style.top = `${e.clientY - 30}px`;
      });
      hit.addEventListener("mouseleave", () => { tip.hidden = true; });
      svg.append(hit, bar);
      const every = Math.ceil(points.length / 8);
      const last = points.length - 1;
      if ((i % every === 0 && last - i >= every / 2) || i === last) {
        const t = svgEl("text", { class: "axis", x: L + i * slot + slot / 2, y: H - 6, "text-anchor": "middle" });
        t.textContent = p.day.slice(5).replace("-", "/");
        svg.append(t);
      }
    });
    host.append(svg);
  }

  const tile = (label, value, sub) =>
    el("div", { class: "tile" }, el("div", { class: "tile__label" }, label), el("div", { class: "tile__value" }, value), el("div", { class: "tile__sub" }, sub || ""));
  const mini = (pairs) => pairs.map(([label, v]) => el("div", {}, el("b", {}, n(v)), el("span", {}, label)));
  const when = (t) => (t ? new Date(t).toLocaleString("es-CO", { dateStyle: "short", timeStyle: "short" }) : "—");
  const who = (r) => (r.name ? (r.displayName && r.displayName !== r.name ? `${r.displayName} (@${r.name})` : `@${r.name}`) : `#${r.userId}`);
  const tierCell = (t) => el("td", {}, el("span", { class: "dot", style: `background:${TIER_COLOR[t] || "#999"}` }), TIER_NAME[t] || t);

  // ---------- Carga ----------
  async function load() {
    let m;
    try {
      m = await api(`/api/admin/metrics?days=${$("days").value}`);
    } catch (err) {
      if (err.status === 401) return show("login");
      $("meta").textContent = "No se pudieron cargar las métricas.";
      return;
    }
    const lastPull = m.connections.lastServerPull;
    const gameAlive = lastPull && Date.now() - lastPull < 10 * 60_000;
    $("meta").textContent = `Hoy: ${m.today} (hora de Colombia) · actualizado ${when(m.generatedAt)} · límites por día: ${m.limits.maxPerDay.mythic} míticas, ${m.limits.maxPerDay.legendary} legendarias · nivel mínimo ${m.limits.minLevel} · códigos vencen en ${m.limits.codeTtlHours} h · juego ${gameAlive ? "conectado" : "sin señal en los últimos 10 min"} (última: ${when(lastPull)})`;

    $("tiles").replaceChildren(
      tile("Tiradas hoy", n(m.rolls.today), `${n(m.rolls.total)} en total`),
      tile("Visitantes hoy", n(m.connections.visitorsToday), `${n(m.connections.visitorsRange)} en el periodo`),
      tile("Jugadores en el juego hoy", n(m.connections.playersToday), `${n(m.connections.serversToday)} servidores · ${n(m.connections.playersKnown)} conocidos`),
      tile("Premios entregados hoy", n(m.rewards.deliveredToday), `${n(m.rewards.pending)} pendientes`),
      tile("Míticas hoy", n(m.rolls.byTierToday.mythic), `${n(m.rolls.byTierToday.legendary)} legendarias`),
      tile("Tiradas con tope", n(m.rolls.cappedTotal), "ganó pero ya tenía el máximo del día"),
    );

    const totalAll = Object.values(m.rolls.byTierAll).reduce((a, b) => a + b, 0);
    $("tiers").tBodies[0].replaceChildren(...TIERS.map(([k, , , exp]) => el("tr", {},
      tierCell(k),
      el("td", { class: "num" }, n(m.rolls.byTierToday[k])),
      el("td", { class: "num" }, n(m.rolls.byTierRange[k])),
      el("td", { class: "num" }, n(m.rolls.byTierAll[k])),
      el("td", { class: "num" }, totalAll ? `${((100 * m.rolls.byTierAll[k]) / totalAll).toFixed(k === "mythic" || k === "legendary" ? 3 : 2)}%` : "—"),
      el("td", { class: "num" }, `${exp}%`),
    )));
    $("tier-note").textContent = `Modo buzón: ${n(m.rolls.byMode.user)} tiradas · modo código: ${n(m.rolls.byMode.code)} tiradas.`;

    $("codes").replaceChildren(...mini([["generados", m.codes.issued], ["canjeados", m.codes.redeemed], ["activos", m.codes.active], ["vencidos", m.codes.expired], ["míticos", m.codes.byTier.mythic], ["legendarios", m.codes.byTier.legendary]]));
    $("rewards").replaceChildren(...mini([["entregados", m.rewards.delivered], ["pendientes", m.rewards.pending], ["por buzón", m.rewards.bySource.user], ["por código", m.rewards.bySource.code], ["míticas", m.rewards.byTier.mythic], ["legendarias", m.rewards.byTier.legendary]]));

    const s = m.series;
    barChart($("ch-rolls"), s.map((d) => ({ day: d.day, v: Object.values(d.rolls).reduce((a, b) => a + b, 0) })), "Tiradas por día");
    barChart($("ch-visitors"), s.map((d) => ({ day: d.day, v: d.visitors })), "Visitantes por día");
    barChart($("ch-players"), s.map((d) => ({ day: d.day, v: d.players })), "Jugadores conectados al juego por día");
    barChart($("ch-rewards"), s.map((d) => ({ day: d.day, v: d.rewards })), "Premios ganados por día");

    $("recent").tBodies[0].replaceChildren(...(m.rewards.recent.length ? m.rewards.recent.map((r) => el("tr", {},
      el("td", {}, when(r.createdAt)),
      el("td", {}, who(r)),
      tierCell(r.tier),
      el("td", r.code ? { title: r.code } : {}, r.source === "admin" ? (r.code ? "Código del panel" : "Regalo del panel") : r.source === "code" ? "Código" : "Buzón"),
      el("td", {}, el("span", { class: `pill${r.status === "delivered" ? " pill--ok" : ""}` }, r.status === "delivered" ? `Entregado ${when(r.deliveredAt)}` : "Pendiente")),
    )) : [el("tr", {}, el("td", { colspan: "5" }, "Todavía no hay premios."))]));

    $("top").tBodies[0].replaceChildren(...(m.rewards.topUsers.length ? m.rewards.topUsers.map((r) => el("tr", {},
      el("td", {}, who(r)), el("td", { class: "num" }, n(r.mythic)), el("td", { class: "num" }, n(r.legendary)), el("td", { class: "num" }, n(r.total)),
    )) : [el("tr", {}, el("td", { colspan: "4" }, "Sin premios en los últimos 7 días."))]));
  }

  // ---------- Generar códigos ----------
  const pretty = (c) => `${c.slice(0, 3)}-${c.slice(3, 8)}-${c.slice(8)}`;
  $("code-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.submitter; if (btn) btn.disabled = true;
    try {
      const r = await api("/api/admin/codes", { tier: $("code-tier").value, count: Number($("code-count").value), days: Number($("code-days").value) });
      if (!r.ok) throw new Error(r.error);
      $("code-list").value = r.codes.map(pretty).join("\n");
      $("code-list").rows = Math.min(10, Math.max(2, r.codes.length));
      $("code-out").hidden = false;
      loadCodes(); load();
    } catch (err) {
      if (err.status === 401) return show("login");
      $("code-list").value = "No se pudieron generar los códigos.";
      $("code-out").hidden = false;
    } finally { if (btn) btn.disabled = false; }
  });
  $("code-copy").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText($("code-list").value); $("code-copy").textContent = "¡Copiados!"; }
    catch { $("code-list").select(); $("code-copy").textContent = "Cópialos con Ctrl+C"; }
    setTimeout(() => { $("code-copy").textContent = "Copiar todos"; }, 2000);
  });

  async function loadCodes() {
    try {
      const { codes } = await api("/api/admin/codes");
      const label = { active: "Activo", redeemed: "Canjeado", expired: "Vencido" };
      $("admin-codes").tBodies[0].replaceChildren(...(codes.length ? codes.map((c) => el("tr", {},
        el("td", {}, pretty(c.code)),
        tierCell(c.tier),
        el("td", {}, when(c.createdAt)),
        el("td", {}, when(c.expiresAt)),
        el("td", {}, el("span", { class: `pill${c.status === "redeemed" ? " pill--ok" : ""}` },
          c.status === "redeemed" ? `Canjeado por ${who({ userId: c.redeemedBy, name: c.name, displayName: c.displayName })}` : label[c.status])),
      )) : [el("tr", {}, el("td", { colspan: "5" }, "Todavía no has generado códigos."))]));
    } catch { /* la tabla queda como estaba */ }
  }

  // ---------- Enviar regalo ----------
  let giftTarget = null;
  const alertMsg = (node, text, ok) => { node.textContent = text; node.className = `note ${ok ? "ok" : text ? "err" : ""}`; };
  const giftDefault = $("gift-msg").textContent;
  $("gift-search").addEventListener("submit", async (e) => {
    e.preventDefault();
    const q = $("gift-q").value.trim();
    $("gift-picks").replaceChildren();
    $("gift-form").hidden = true;
    giftTarget = null;
    alertMsg($("gift-msg"), "Buscando…", true);
    try {
      const r = await api(`/api/players/search?q=${encodeURIComponent(q)}`);
      if (!r.players.length) return alertMsg($("gift-msg"), "No se encontró esa cuenta.", false);
      alertMsg($("gift-msg"), "Elige la cuenta:", true);
      for (const p of r.players) {
        const b = el("button", { type: "button", class: "pickrow" },
          el("img", { src: p.avatar || "/img/icon-192.png", alt: "" }),
          el("span", {}, `${p.displayName} `, el("small", {}, `@${p.name}${p.played ? " · juega Sky Eggs" : " · nunca entró al juego"}`)));
        b.addEventListener("click", () => {
          giftTarget = p;
          $("gift-picks").replaceChildren();
          $("gift-to").textContent = `Para: ${p.displayName} (@${p.name}) · id ${p.userId}`;
          $("gift-form").hidden = false;
          alertMsg($("gift-msg"), giftDefault, true);
        });
        $("gift-picks").append(el("li", {}, b));
      }
    } catch (err) {
      alertMsg($("gift-msg"), err.status === 429 ? "Demasiadas búsquedas, espera un momento." : "No se pudo buscar.", false);
    }
  });
  $("gift-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!giftTarget) return;
    const tier = $("gift-tier").value;
    const count = Number($("gift-count").value);
    const what = `${count} mascota${count > 1 ? "s" : ""} ${PET_NAME[tier]}${count > 1 ? "s" : ""}`;
    if (!window.confirm(`¿Enviar ${what} a @${giftTarget.name}?`)) return;
    const btn = e.submitter; if (btn) btn.disabled = true;
    try {
      const r = await api("/api/admin/gift", { userId: giftTarget.userId, tier, count });
      if (!r.ok) throw Object.assign(new Error(r.error), {});
      alertMsg($("gift-msg"), `Enviado: ${what} para @${r.player.name}. ${r.player.played ? "Le llega en menos de un minuto si está conectado." : "Le llegará cuando entre al juego."}`, true);
      load();
    } catch (err) {
      if (err.status === 401) return show("login");
      alertMsg($("gift-msg"), "No se pudo enviar el regalo.", false);
    } finally { if (btn) btn.disabled = false; }
  });

  $("days").addEventListener("change", load);
  $("refresh").addEventListener("click", load);

  const start = () => { show("dash"); load(); loadCodes(); };
  api("/api/admin/me").then(start).catch(() => show("login"));
})();

// Dentro del panel (/creadores/panel/#admin-suerte): sin cabecera propia y avisando la altura.
(() => {
  if (new URLSearchParams(location.search).get("embed") !== "1" || window.parent === window) return;
  document.documentElement.classList.add("is-embed");
  const post = () => window.parent.postMessage({ type: "se-admin-height", height: document.documentElement.scrollHeight }, location.origin);
  new ResizeObserver(post).observe(document.body);
  window.addEventListener("load", post);
})();
