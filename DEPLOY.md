# Despliegue de la página de Sky Eggs

La página es estática (HTML, CSS y JS sin compilación) y se sirve con **nginx dentro de Docker**, detrás de **Traefik** con HTTPS automático. GitHub Actions construye la imagen, la publica en GHCR y actualiza el servidor por SSH en cada push a `main`.

```
push a main ──> GitHub Actions ──> imagen en ghcr.io/josephrioshenao/skyeggspage
                                    └─ SSH al servidor ─> git pull + docker compose pull + up -d
```

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
nano .env            # pon DOMAIN=tu-dominio.com y revisa el resto
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
curl -I https://TU-DOMINIO
```

## 4. Configurar GitHub Actions (despliegue automático)

En GitHub: **Settings → Secrets and variables → Actions**.

**Variables** (pestaña *Variables*):

| Nombre | Valor |
|---|---|
| `SITE_URL` | `https://tu-dominio.com` (sin barra final; debe coincidir con `DOMAIN`) |
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

## Problemas comunes

- **Certificado no se emite:** el DNS aún no apunta al servidor o el puerto 80 está cerrado (el reto HTTP de Let's Encrypt lo necesita).
- **404 de Traefik:** el contenedor no está en la red de Traefik (`TRAEFIK_NETWORK`) o el entrypoint/certresolver no coinciden con los de tu Traefik.
- **`denied` al hacer pull:** el paquete de GHCR es privado; el workflow ya inicia sesión al desplegar, pero para un pull manual usa `docker login ghcr.io`.
- **Canonical u Open Graph con `skyeggs.example.com`:** falta la variable `SITE_URL` en GitHub (o el `DOMAIN` en `.env` si construyes en el servidor).
