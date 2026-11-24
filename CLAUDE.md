# Sky Eggs: página web

Landing estática del juego de Roblox **Sky Eggs (Huevos del cielo)**. Público: niños. Idioma: español.

## Estructura

- `site/`: todo lo que se publica (sin paso de compilación).
  - `index.html`, `css/styles.css`, `js/main.js` (huevo interactivo).
  - `img/`: imágenes en WebP; `fonts/`: Lilita One y Baloo 2 auto-alojadas.
  - `__SITE_URL__` en HTML, `robots.txt` y `sitemap.xml` se reemplaza al construir la imagen (build arg `SITE_URL`).
- `site/creadores/`: página pública del Programa de Creadores (`index.html`) y panel con login de Discord (`panel/`). Estilos en `creadores.css`. Sin `style=` en línea (la CSP lo bloquea): usar clases o `el.style` desde JS.
- `site/admin/`: panel de métricas con login (datos de `/api/admin/*`). `noindex`. También se incrusta en el panel (`?embed=1`).
- `site/staff/`: página pública del programa de staff (generada).
- `api/`: API de "Prueba tu suerte" (Node 22 sin dependencias + `node:sqlite`). Sorteo en el servidor, búsqueda de cuenta por usuario o nombre visible, modo buzón y modo código, endpoints del juego (`/api/game/pull|ack|redeem` con `X-Game-Key`) y panel. Pruebas: `cd api && npm test`. Ver `DEPLOY.md` §6.
- `Dockerfile` + `docker/`: nginx con caché, gzip y cabeceras de seguridad. `/healthz` responde `ok`.
- `docker-compose.yml`: servicio `skyeggs-web` con labels de Traefik (dominio desde `.env`).
- `docker-compose.traefik.yml`: Traefik con Let's Encrypt, solo si el servidor no tiene uno.
- `.github/workflows/deploy.yml`: construye, publica en GHCR y despliega por SSH.

## Dominios

- Principal: `skyeggs.pro`. `www.skyeggs.pro`, `huevosdelcielo.pro` y `www.huevosdelcielo.pro` redirigen 301 al principal (labels de Traefik en `docker-compose.yml`). Todos apuntan a `173.249.60.5`.

## Enlaces clave (no cambiar sin pedirlo)

- Juego: https://www.roblox.com/es/games/77372347150746/Huevos-del-cielo
- Discord: https://discord.gg/sTgtR7KdGQ

## Instalación en el servidor

Seguir `DEPLOY.md` paso a paso. Resumen:

1. Clonar en `/opt/skyeggspage`, `cp .env.example .env` (ya trae `DOMAIN=skyeggs.pro` y `ALT_DOMAIN=huevosdelcielo.pro`).
2. Detectar si ya existe Traefik (`docker ps`, `docker network ls`) y ajustar `TRAEFIK_NETWORK`, `TRAEFIK_ENTRYPOINT`, `TRAEFIK_CERTRESOLVER`. Si no existe, crear la red `traefik` y levantar `docker-compose.traefik.yml`.
3. `docker compose up -d --build` y comprobar `curl -I https://$DOMAIN`.
4. Para el despliegue automático: clave SSH de despliegue, secrets `SSH_HOST`/`SSH_USER`/`SSH_KEY` y variable `DEPLOY_ENABLED=true` (y `SITE_URL=https://skyeggs.pro`, opcional) en GitHub.

No tocar otros contenedores ni la configuración de un Traefik existente sin confirmarlo con el dueño.

## Programa de creadores

- Tres actores con roles de Discord: admin (1 persona), moderadores y creadores; los aspirantes no tienen rol. API en `api/src/creators.js` (reglas), `discord.js` (OAuth) y `program.js` (niveles, packs, bono de Robux). Todo cambio de staff pasa por `audit()`.
- Los packs de `program.js` tienen que coincidir con `CreatorServiceConfig.Packs` del juego. El texto de la página pública (`site/creadores/index.html`) también los repite: actualizar los tres a la vez.
- Rangos automáticos, avisos al buzón y creadores antiguos: `api/src/lifecycle.js` (el texto de los avisos vive en el juego, `WebRewardServiceConfig.CreatorNotices`). Lista pública y panel de métricas del staff: `api/src/insights.js`; carrusel en `site/js/creators.js` (portada y /creadores/). Roles de Discord con bot opcional (`DISCORD_BOT_TOKEN`, `discord.js`).
- Guía para cada actor: pestaña "Guía" del panel y `docs/GUIA-PROGRAMA-CREADORES.md`.

## Programa de staff

- Rangos Helper → ModeratorJr → Moderator (roles de Discord en `config.discord.staffRoles`). Reglas en `api/src/staff.js`; rangos, comandos, tareas y preguntas del formulario en `api/src/staffProgram.js` (fuente única para la API, el panel y `/staff/`).
- `site/staff/index.html` se genera con `node scripts/build-staff-page.mjs`: no editarla a mano.
- Ajustes que cambia el Admin (metas, cuota semanal juego + Discord, ascensos, excusas): `api/src/staffSettings.js` (tabla `settings`). Actividad en Discord por REST: `api/src/discordActivity.js`. Inicio por rol: `api/src/home.js`. Anuncios con mención en el canal del staff: `api/src/announce.js`. Carrusel de `/staff/`: `site/staff/staff.js` + `GET /api/staff/public`.
- Tareas: cuota obligatoria (`min`) + meta opcional (`goal`) por rango; 2 meses sin cuotas = baja un rango. Sin `;Duty`: cuenta el tiempo conectado menos el AFK.
- Juego: kind `staffset` en `WebRewardService`, `StaffActivity` (cuenta comandos y `;Duty`) y `Config.Commands.StaffTools` (`;Report`, `;sc`, `;Duty`, `;PlayerInfo`, `;StaffHelp`). Los comandos de cada rango viven en `Config.Roles` de HD Admin; si cambian, actualizar `staffProgram.js` y regenerar la página.
- Panel: barra lateral en `site/creadores/panel/` (`navGroups()` en `panel.js`); "Prueba tu suerte" se incrusta desde `/admin/?embed=1`.

## Bot de Discord y cuentas (2026-11-24)

- Para usar el panel hay que estar en el servidor de Discord **y** tener la cuenta de Roblox vinculada (`discord_users.roblox_user_id`, `C.linkAccount`, `POST /api/account/roblox`; la API responde `join_guild` / `link_roblox`). Al aprobar un creador o staff su cuenta pasa a ser la del panel (`syncAccount`).
- Roles pendientes: si aprueban a alguien que no está en el servidor, `sweepPendingRoles` (cada 10 min) y el login le ponen el rol cuando se une.
- `bot.js` (REST, botones con firma Ed25519 en `POST /api/discord/interactions`), `videos.js` (anuncio de videos aprobados), `eggAlerts.js` (alertas de huevos absurdos que manda el juego a `/api/game/egg-alert`), `assets.js` (imágenes del juego en `MEDIA_DIR`, catálogo de `/api/game/catalog`). Ver `DEPLOY.md` §9.

## Conexión con el juego

- El juego (place principal) tiene `WebRewardService`: cada ~60 s manda los jugadores conectados a `/api/game/pull`, recibe sus premios pendientes, los envía al buzón (`MailService.Send`, Id `web-<id>`, tirada de mascota de la rareza ganada) y confirma con `/api/game/ack`. Los códigos `SKY…` se canjean en la caja de Códigos del juego, que llama a `/api/game/redeem`.
- Las probabilidades viven en `api/src/config.js` (`TIERS`) y en `site/js/main.js` (solo los textos). Cambiarlas es decisión del dueño.

## Probar en local

```bash
cd site && python3 -m http.server 8080   # los __SITE_URL__ quedan sin reemplazar, es normal
```
