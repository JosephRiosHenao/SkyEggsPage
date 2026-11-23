# Despliegue de la página de Sky Eggs

La página es estática (HTML, CSS y JS sin compilación) y se sirve con **nginx dentro de Docker**, detrás de **Traefik** con HTTPS automático. GitHub Actions construye la imagen, la publica en GHCR y actualiza el servidor por SSH en cada push a `main`.

```
push a main ──> GitHub Actions ──> imagen en ghcr.io/josephrioshenao/skyeggspage
                                    └─ SSH al servidor ─> git pull + docker compose pull + up -d
```

## Dominios

| Dominio | Qué hace |
|---|---|
| `skyeggs.pro` | Dominio principal (canonical, sitemap, Open Graph) |
| `www.skyeggs.pro` | Redirige 301 a `https://skyeggs.pro` |
| `huevosdelcielo.pro` y `www.huevosdelcielo.pro` | Redirigen 301 a `https://skyeggs.pro` |

Los cuatro apuntan a `173.249.60.5`. Traefik pide certificados para todos.

## 1. Requisitos del servidor

- Linux con Docker Engine y el plugin `docker compose` (v2).
- Puertos 80 y 443 abiertos.
- El dominio (y `www.` si se quiere) apuntando a la IP del servidor con registros **A/AAAA**.

## 2. Instalación inicial en el servidor

```bash
sudo mkdir -p /opt/skyeggspage && sudo chown "$USER" /opt/skyeggspage
git clone https://github.com/JosephRiosHenao/SkyEggsPage.git /opt/skyeggspage
cd /opt/skyeggspage
cp .env.example .env
nano .env            # ya trae DOMAIN=skyeggs.pro y ALT_DOMAIN=huevosdelcielo.pro; revisa lo de Traefik
```

### ¿Ya hay un Traefik corriendo?

Mira la red y el certresolver que usa:

```bash
docker ps --filter name=traefik
docker network ls                    # red de Traefik -> TRAEFIK_NETWORK
docker inspect traefik | grep -iE "certresolver|entrypoints"   # -> TRAEFIK_CERTRESOLVER / TRAEFIK_ENTRYPOINT
```

Ajusta esos valores en `.env` y salta al paso 3.

### Si NO hay Traefik

```bash
docker network create traefik
docker compose -f docker-compose.traefik.yml up -d   # usa ACME_EMAIL del .env
```

## 3. Primer arranque

Opción A, construir en el servidor (no necesita GHCR):

```bash
docker compose up -d --build
```

Opción B, usar la imagen publicada por Actions (si el paquete de GHCR es privado, haz `docker login ghcr.io` con un token con `read:packages`):

```bash
docker compose pull && docker compose up -d --no-build
```

Comprueba:

```bash
docker compose ps
curl -I https://skyeggs.pro
curl -I https://huevosdelcielo.pro   # debe responder 301 hacia skyeggs.pro
```

## 4. Configurar GitHub Actions (despliegue automático)

En GitHub: **Settings → Secrets and variables → Actions**.

**Variables** (pestaña *Variables*):

| Nombre | Valor |
|---|---|
| `SITE_URL` | `https://skyeggs.pro` (opcional: ya es el valor por defecto) |
| `DEPLOY_ENABLED` | `true` (actívalo cuando el servidor ya esté listo) |
| `DEPLOY_PATH` | `/opt/skyeggspage` (opcional, ese es el valor por defecto) |

**Secrets** (pestaña *Secrets*):

| Nombre | Valor |
|---|---|
| `SSH_HOST` | IP o dominio del servidor |
| `SSH_USER` | usuario con permiso para usar Docker |
| `SSH_KEY` | clave privada SSH (el servidor debe tener la pública en `~/.ssh/authorized_keys`) |
| `SSH_PORT` | opcional, por defecto 22 |

Crear una clave solo para el despliegue:

```bash
ssh-keygen -t ed25519 -f skyeggs_deploy -N "" -C "github-actions-skyeggs"
# en el servidor:
cat skyeggs_deploy.pub >> ~/.ssh/authorized_keys
# el contenido de skyeggs_deploy (privada) va al secret SSH_KEY
```

El job `deploy` usa el environment `production`; GitHub lo crea solo en la primera ejecución (ahí puedes exigir aprobación manual si quieres).

## 5. Cambiar de dominio

1. Cambia `DOMAIN` en `.env` del servidor.
2. Cambia la variable `SITE_URL` en GitHub.
3. Lanza el workflow (push o *Run workflow*). Traefik pide el certificado nuevo solo.

## 6. API de "Prueba tu suerte" y panel /admin

Contenedor `skyeggs-api` (Node + SQLite en el volumen `skyeggs-data`). Traefik le manda todo lo que empieza por `/api/`; lo demás sigue yendo a nginx. Hace el sorteo, guarda los premios, da los códigos y sirve los datos del panel `https://skyeggs.pro/admin/`.

### Primera vez (en el servidor)

```bash
cd /opt/skyeggspage
git pull
# 1) clave compartida con el juego
echo "GAME_KEY=$(openssl rand -hex 32)" >> .env
# 2) hash de la contraseña del panel (te la pide; mínimo 12 caracteres)
docker compose build skyeggs-api
docker compose run --rm --no-deps skyeggs-api node --disable-warning=ExperimentalWarning src/hash-password.js
#    copia la línea scrypt:... y ponla en .env como ADMIN_PASSWORD_HASH=scrypt:...
nano .env            # revisa ADMIN_USER, ADMIN_PASSWORD_HASH, límites y MIN_LEVEL
docker compose up -d skyeggs-api
curl -s https://skyeggs.pro/api/health      # {"ok":true}
```

3) En Roblox: **Creator Dashboard → Huevos del cielo → Secrets → Create Secret**, nombre `SkyEggsWeb`, valor = el mismo `GAME_KEY`, dominio permitido `skyeggs.pro`. Y en Studio, **Game Settings → Security → Allow HTTP Requests** activado (y publicado).

Mientras `.env` no tenga `GAME_KEY` y `ADMIN_PASSWORD_HASH`, el despliegue automático no levanta la API (la página sigue funcionando; el huevo muestra "No pudimos abrir el huevo").

### Variables

| Variable | Qué hace | Por defecto |
|---|---|---|
| `GAME_KEY` | Secreto que manda el juego en `X-Game-Key` | (obligatoria, ≥ 32 caracteres) |
| `ADMIN_USER` / `ADMIN_PASSWORD_HASH` | Login del panel | `admin` / (obligatoria) |
| `MAX_MYTHIC_PER_DAY` / `MAX_LEGENDARY_PER_DAY` | Premios que cada cuenta puede cobrar al día (hora de Colombia) | 5 / 5 |
| `MIN_LEVEL` | Nivel mínimo en el juego para recibir premios (quedan guardados hasta llegar) | 10 |
| `CODE_TTL_HOURS` | Horas que dura un código sin canjear | 72 |

### Acciones del panel

- **Generar códigos** míticos o legendarios (1–50, vencen en 1–30 días). Son de un solo uso, **no piden nivel ni cuentan para el tope diario** (pensados para sorteos). Se listan con su estado (activo, canjeado por quién, vencido).
- **Enviar regalo**: buscar al jugador por usuario o nombre visible y mandarle 1–10 tiradas de mascota de cualquier rareza. Llega al buzón como "Sky Eggs Team" (categoría Admin), aunque no tenga el nivel mínimo y sin gastar su tope. Cada acción queda en `docker logs skyeggs-api` (`[admin] …`).
- El juego necesita la versión de `WebRewardService` con `Config.AdminMail` y las 6 rarezas (publicar el place).

### Seguridad

- El resultado lo decide el servidor (`crypto.randomInt`); la página solo anima. Cambiar el JS no da premios.
- Los premios van siempre a la cuenta elegida, con tope diario por cuenta (también para los códigos, que se cuentan al canjear).
- El juego solo recibe "userId + rareza"; el premio real (tirada de mascota de esa rareza) lo arma el juego y lo valida el MailService.
- Endpoints del juego protegidos con `GAME_KEY` (comparación en tiempo constante). Panel con contraseña scrypt, cookie `HttpOnly; Secure; SameSite=Strict`, 5 intentos cada 15 min por IP.
- Si un día se pone Cloudflare delante, cambia `IP_HEADER` a `cf-connecting-ip` para que el límite por IP siga funcionando.

### Copia de seguridad

```bash
docker run --rm -v skyeggspage_skyeggs-data:/data -v "$PWD":/out alpine sh -c 'cp /data/skyeggs.db /out/skyeggs-$(date +%F).db'
```

## 7. Programa de creadores (login con Discord)

Página pública `https://skyeggs.pro/creadores/` y panel `https://skyeggs.pro/creadores/panel/`. Los roles salen del servidor de Discord de Sky Eggs: admin `1560889139375898775`, moderador `1563742282392543312`, creador `1561051688125730897`. Para leer los roles no hace falta bot (permiso `guilds.members.read` del propio usuario al entrar); el bot solo se usa, si lo configuras, para **poner y quitar** roles solo (ver abajo).

### Crear la aplicación de Discord (una vez)

1. Entra a https://discord.com/developers/applications → **New Application** (nombre: "Sky Eggs Creadores").
2. **OAuth2** → copia **Client ID** y pulsa **Reset Secret** para copiar el **Client Secret**.
3. En **OAuth2 → Redirects** agrega exactamente: `https://skyeggs.pro/api/auth/discord/callback`
4. En Discord: Ajustes de usuario → Avanzado → **Modo desarrollador**. Clic derecho en el servidor de Sky Eggs → **Copiar ID del servidor**.
5. (Opcional) En un canal privado de moderadores: Editar canal → Integraciones → **Webhooks** → Nuevo webhook → Copiar URL.

### En el servidor

```bash
cd /opt/skyeggspage
nano .env      # DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, DISCORD_GUILD_ID y, si quieres, DISCORD_WEBHOOK_URL
docker compose up -d skyeggs-api
```

Prueba: abre `https://skyeggs.pro/creadores/panel/`, entra con Discord y comprueba que salen tus insignias (Admin). Si dice "El login con Discord todavía no está configurado", falta alguna de las tres primeras variables.

### Roles de Discord automáticos (opcional, con el bot)

Sin librerías: la API usa la REST de Discord (`PUT/DELETE /guilds/{servidor}/members/{usuario}/roles/{rol}`).

1. En la misma aplicación de Discord → **Bot** → **Reset Token** y copia el token (nunca lo pegues en un chat ni en el repo).
2. **OAuth2 → URL Generator**: marca `bot` y el permiso **Manage Roles**; abre la URL e invita el bot al servidor de Sky Eggs.
3. En Ajustes del servidor → **Roles**, arrastra el rol del bot **por encima** de Content Creator y de los roles de rango (si queda debajo, Discord responde 403).
4. (Opcional) Crea un rol por rango (Activo, Viral, Estrella, Elite) y copia sus IDs.
5. En `.env`: `DISCORD_BOT_TOKEN=…` y, si los creaste, `DISCORD_ROLE_CREATOR_ACTIVE/VIRAL/STAR/ELITE`. `docker compose up -d skyeggs-api`.

Prueba: en Moderación → "Creadores y métricas" la tarjeta "roles de Discord" dice **Automático**. Cada cambio queda en el Registro ("actualizó los roles de Discord de…" o el error).

### Cómo funciona

- **Aspirante** (sin rol): llena la solicitud. **Moderador**: la revisa, contacta, aprueba o rechaza. Al aprobar, el juego recibe solo el rango **Creator** (tag + permisos de HD Admin) y un correo de bienvenida; con el bot, también el rol de Discord.
- **Rangos automáticos** (`api/src/lifecycle.js`, cada 15 min y al aprobar evidencias): Activo 3.000, Viral 3.500, Estrella 4.500 y Elite 5.000 vistas aprobadas en la semana. Si una semana entera no sube ningún video, vuelve a Creator (aviso al buzón 3 días antes; la bajada se aplica 24 h después del domingo). Los packs ya no suben el rango.
- **Creadores antiguos**: el juego manda el nivel de creador de cada jugador en `/game/pull`. Si tiene rango pero no está aprobado en la página, recibe un aviso al buzón y tiene 3 días para aplicar (sin pasar del 1 de enero de 2027). Si no aplica, o lo rechazan, pierde el rango al entrar al juego. Pestaña "Creadores antiguos" en Moderación.
- **Avisos al buzón**: kind `notice` (texto en `WebRewardServiceConfig.CreatorNotices` del juego) y cambios de rango kind `tierset`. Pestaña "Avisos" en Moderación.
- **Creador**: su cuenta de Roblox se elige de la lista de jugadores que ya entraron a Sky Eggs (si no aparece, tiene que jugar primero) y el moderador la confirma al aprobar la solicitud, sube evidencias (enlace + captura opcional), ve sus metas y reclama **1 pack por semana** (hasta 3 días después del domingo) y **1 por mes** (hasta 5 días después). El juego entrega el pack al buzón con `CreatorService.SendReward` (mismo id `cr-<periodo>-<userId>`: no se duplica con `;CreatorReward`).
- **Bono de Robux** (≥ 10.000 vistas, 100 R$ por cada 10.000, máx. 1.000 por video): moderador → admin (persona distinta) → el admin paga por el grupo y marca "Pagado".
- **Pedido especial** (≥ 100.000 vistas aprobadas en el mes): solo el admin lo resuelve.
- Cada acción de staff queda en `audit` con nombre, rol, hora y detalles (pestaña Registro).
- Las capturas se guardan en el volumen (`/data/uploads`) y solo las ven su dueño y el staff.
- Packs y niveles: `api/src/program.js`. Deben coincidir con `CreatorServiceConfig.Packs` del juego.
- **Vistas automáticas** (`api/src/views.js`): la imagen trae **yt-dlp** (en `/opt/ytdlp`, se actualiza solo cada día). Lee YouTube, TikTok, Twitch y Kick sin claves y refresca cada `VIEWS_REFRESH_HOURS` (6) mientras el video cuente para un reclamo. Solo se consultan esos dominios por https (sin extractor genérico). Si YouTube bloquea la IP del VPS, `YOUTUBE_API_KEY` (gratis) sirve de respaldo. `VIEWS_AUTO=false` lo apaga. Para ver qué pasa: `docker logs skyeggs-api | grep views`.

## Problemas comunes

- **Certificado no se emite:** el DNS aún no apunta al servidor o el puerto 80 está cerrado (el reto HTTP de Let's Encrypt lo necesita).
- **404 de Traefik:** el contenedor no está en la red de Traefik (`TRAEFIK_NETWORK`) o el entrypoint/certresolver no coinciden con los de tu Traefik.
- **`denied` al hacer pull:** el paquete de GHCR es privado; el workflow ya inicia sesión al desplegar, pero para un pull manual usa `docker login ghcr.io`.
- **Canonical u Open Graph con otro dominio:** revisa la variable `SITE_URL` en GitHub (o `DOMAIN` en `.env` si construyes en el servidor).
