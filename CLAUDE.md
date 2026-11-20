# Sky Eggs: página web

Landing estática del juego de Roblox **Sky Eggs (Huevos del cielo)**. Público: niños. Idioma: español.

## Estructura

- `site/`: todo lo que se publica (sin paso de compilación).
  - `index.html`, `css/styles.css`, `js/main.js` (huevo interactivo).
  - `img/`: imágenes en WebP; `fonts/`: Lilita One y Baloo 2 auto-alojadas.
  - `__SITE_URL__` en HTML, `robots.txt` y `sitemap.xml` se reemplaza al construir la imagen (build arg `SITE_URL`).
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

## Probar en local

```bash
cd site && python3 -m http.server 8080   # los __SITE_URL__ quedan sin reemplazar, es normal
```
