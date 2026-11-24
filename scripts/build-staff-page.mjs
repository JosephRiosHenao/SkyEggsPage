// Genera site/staff/index.html desde api/src/staffProgram.js (fuente única). Uso: node scripts/build-staff-page.mjs
import { writeFileSync } from "node:fs";
import { RANKS, TASKS, RULES } from "../api/src/staffProgram.js";
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const rankCards = RANKS.map((r, i) => `
          <article class="st-rank st-rank--${r.key}">
            <p class="st-rank__step">Rango ${i + 1}</p>
            <h3>${r.emoji} ${esc(r.name)}</h3>
            <p class="st-rank__sum">${esc(r.summary)}</p>
            <h4>Beneficios</h4>
            <ul>${r.benefits.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>
            <h4>En Discord</h4>
            <ul>${r.discord.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>
          </article>`).join("");
const cmdBlocks = RANKS.map((r) => `
          <details class="st-cmds st-cmds--${r.key}"${r.key === "Helper" ? " open" : ""}>
            <summary>${r.emoji} Comandos de ${esc(r.name)}</summary>
            <dl>${r.game.map((c) => `<dt><code>${esc(c.cmd)}</code></dt><dd>${esc(c.desc || "Incluido.")}</dd>`).join("")}</dl>
          </details>`).join("");
const taskRows = TASKS.map((t) => `
              <tr><th scope="row">${esc(t.name)}${t.optional ? " <span class=\"st-tag\">extra</span>" : ""}<span>${esc(t.desc)}</span></th>${RANKS.map((r) => `<td>${t.targets[r.key] ? `${t.targets[r.key]} ${esc(t.unit)}` : "—"}</td>`).join("")}<td>${t.track === "auto" ? "Automática" : "Con evidencia"}</td></tr>`).join("");
const html = `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Staff de Sky Eggs | Helper, Moderator Jr y Moderator</title>
  <meta name="description" content="Únete al staff de Sky Eggs: empieza como Helper, ayuda a los jugadores en el juego y en Discord, gana comandos exclusivos y asciende a Moderator.">
  <meta name="theme-color" content="#231A63">
  <link rel="canonical" href="__SITE_URL__/staff/">
  <meta property="og:type" content="website">
  <meta property="og:locale" content="es_ES">
  <meta property="og:site_name" content="Sky Eggs">
  <meta property="og:title" content="Staff de Sky Eggs">
  <meta property="og:description" content="Empieza como Helper y asciende a Moderator. Comandos exclusivos, etiqueta en el juego y rol en Discord.">
  <meta property="og:url" content="__SITE_URL__/staff/">
  <meta property="og:image" content="__SITE_URL__/img/og.jpg">
  <link rel="icon" href="/favicon.ico" sizes="any">
  <link rel="icon" href="/favicon-32.png" type="image/png" sizes="32x32">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  <link rel="preload" href="/fonts/lilita-one-400.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="/css/styles.css?v=__ASSET_V__">
  <link rel="stylesheet" href="/creadores/creadores.css?v=__ASSET_V__">
  <link rel="stylesheet" href="/staff/staff.css?v=__ASSET_V__">
</head>
<body class="cr st">
  <a class="skip" href="#contenido">Saltar al contenido</a>
  <!-- Generado por scripts/build-staff-page.mjs desde api/src/staffProgram.js: no editar a mano. -->
  <header class="nav">
    <a class="nav__logo" href="/" aria-label="Sky Eggs, inicio">
      <img src="/favicon-32.png" width="32" height="32" alt="">
      <span>Sky Eggs</span>
    </a>
    <nav class="nav__links" aria-label="Principal">
      <a href="#rangos">Rangos</a>
      <a href="#comandos">Comandos</a>
      <a href="#tareas">Tareas</a>
      <a href="#preguntas">Preguntas</a>
    </nav>
    <a class="btn btn--yolk btn--sm" href="/creadores/panel/">Mi panel</a>
  </header>

  <main id="contenido">
    <section class="cr-hero">
      <div class="cr-hero__inner wrap">
        <div class="cr-hero__copy">
          <p class="cr-hero__kicker">Staff de Sky Eggs</p>
          <h1 class="cr-hero__title">Cuida las islas y ayuda a los jugadores</h1>
          <p class="cr-hero__lead">Empieza como Helper, gana tu etiqueta y tus comandos en el juego, y sube a Moderator Jr y Moderator cumpliendo tus tareas del mes.</p>
          <div class="cr-hero__actions">
            <a class="btn btn--yolk btn--lg" href="/creadores/panel/#staff-aplicar">Quiero ser Helper</a>
            <a class="btn btn--ghost" href="/creadores/panel/">Ya soy staff</a>
          </div>
          <p class="cr-hero__note">Se entra con Discord y se vincula tu cuenta de Roblox. Tienes que tener 13 años o más.</p>
        </div>
        <div class="cr-hero__art" aria-hidden="true">
          <img class="cr-hero__cover" src="/img/portada-sm.webp" width="560" height="560" alt="">
          <span class="sticker sticker--live">🛟 HELPER</span>
          <span class="sticker sticker--views">;Duty</span>
          <span class="sticker sticker--vip">STAFF ON DUTY</span>
        </div>
      </div>
    </section>

    <section class="cr-steps" aria-labelledby="como-title">
      <div class="wrap">
        <h2 class="section-title" id="como-title">Cómo entrar</h2>
        <ol class="flight">
          <li class="flight__stop"><h3>Entra con Discord</h3><p>Abre el panel con tu cuenta de Discord del servidor de Sky Eggs.</p></li>
          <li class="flight__stop"><h3>Vincula tu Roblox</h3><p>Eliges tu cuenta de la lista de jugadores (tienes que haber jugado Sky Eggs).</p></li>
          <li class="flight__stop"><h3>Responde el formulario</h3><p>Preguntas sobre ti, tu horario y cómo actuarías en casos reales.</p></li>
          <li class="flight__stop"><h3>Un Moderator te aprueba</h3><p>Te escribe por Discord y te da el rol y la etiqueta HELPER. Llegan solos al juego.</p></li>
        </ol>
      </div>
    </section>

    <section class="st-ranks" id="rangos" aria-labelledby="rangos-title">
      <div class="wrap">
        <h2 class="section-title section-title--light" id="rangos-title">Tres rangos</h2>
        <p class="section-lead section-lead--light">Todos empiezan como Helper. A Moderator Jr asciende un Moderator o el Admin; a Moderator, <strong>solo el Admin</strong>. Cada rango tiene los comandos del anterior.</p>
        <div class="st-ranks__grid">${rankCards}
        </div>
      </div>
    </section>

    <section class="st-commands" id="comandos" aria-labelledby="cmd-title">
      <div class="wrap">
        <h2 class="section-title" id="cmd-title">Comandos en el juego</h2>
        <p class="section-lead">Escríbelos en el chat del juego o en la barra de comandos de HD Admin. Todo lo que haces queda registrado.</p>${cmdBlocks}
      </div>
    </section>

    <section class="st-tasks" id="tareas" aria-labelledby="tareas-title">
      <div class="wrap">
        <h2 class="section-title" id="tareas-title">Tareas del mes</h2>
        <p class="section-lead">Para mantener el rango cumples las tareas de tu rango cada mes. Las automáticas las mide el juego y la página; para las demás subes capturas al panel y un rango superior las aprueba. Si pasan <strong>2 meses seguidos</strong> sin cumplirlas, sales del staff. El día 20 te avisamos si vas por debajo de la mitad.</p>
        <div class="st-table">
          <table>
            <thead><tr><th scope="col">Tarea</th>${RANKS.map((r) => `<th scope="col">${r.emoji} ${esc(r.name)}</th>`).join("")}<th scope="col">Cómo se mide</th></tr></thead>
            <tbody>${taskRows}
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <section class="cr-rules" aria-labelledby="reglas-title">
      <div class="wrap">
        <h2 class="section-title" id="reglas-title">Normas del staff</h2>
        <ul class="rules">${RULES.map((r) => `<li>${esc(r)}</li>`).join("")}<li><strong>13 años o más</strong> y cuenta de Roblox que haya jugado Sky Eggs.</li></ul>
      </div>
    </section>

    <section class="cr-faq" id="preguntas" aria-labelledby="faq-title">
      <div class="wrap">
        <h2 class="section-title" id="faq-title">Preguntas</h2>
        <details><summary>Ya soy Helper, Moderator Jr o Moderator, ¿tengo que aplicar?</summary><p>No. Entra al panel con Discord y vincula tu cuenta de Roblox antes del <strong>1 de diciembre de 2026</strong>. Si no lo haces, pierdes el rango en el juego y en Discord y tendrás que llenar el formulario de Helper.</p></details>
        <details><summary>¿Cómo se cuentan mis horas?</summary><p>El juego avisa a la página cada minuto quién del staff está conectado. Las horas en servicio cuentan cuando activas <code>;Duty</code>.</p></details>
        <details><summary>¿Qué cuenta como acción de moderación?</summary><p><code>;Warn</code>, <code>;Mute</code>, <code>;Kick</code>, <code>;Jail</code>, los baneos y los <code>;Report</code> que envías. Úsalos solo cuando hacen falta: los abusos se revisan.</p></details>
        <details><summary>¿Cómo subo de rango?</summary><p>Cumple tus tareas y pide el ascenso desde el panel. A Moderator Jr lo aprueba un Moderator o el Admin; a Moderator, solo el Admin.</p></details>
        <details><summary>Me rechazaron, ¿puedo volver a aplicar?</summary><p>Sí, 14 días después del rechazo.</p></details>
        <details><summary>¿Cómo reporto a un jugador?</summary><p>Cualquier jugador puede escribir <code>;Report &lt;jugador&gt; &lt;motivo&gt;</code> en el juego. El reporte llega al panel del staff.</p></details>
      </div>
    </section>

    <section class="cr-cta">
      <div class="wrap cr-cta__inner">
        <h2 class="section-title section-title--light">¿Te unes al staff?</h2>
        <a class="btn btn--white btn--lg" href="/creadores/panel/#staff-aplicar">Quiero ser Helper</a>
      </div>
    </section>
  </main>

  <footer class="footer">
    <div class="wrap footer__inner">
      <p class="footer__legal">Sky Eggs (Huevos del cielo) es un juego creado en Roblox. Esta página no está afiliada a Roblox Corporation ni a Discord Inc.</p>
      <p class="footer__legal"><a href="/">Volver a Sky Eggs</a> · <a href="/creadores/">Programa de creadores</a></p>
    </div>
  </footer>
</body>
</html>
`;
writeFileSync(new URL("../site/staff/index.html", import.meta.url), html);
console.log("site/staff/index.html listo");
