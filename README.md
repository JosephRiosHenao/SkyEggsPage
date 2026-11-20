# Sky Eggs (Huevos del cielo): página web

Página oficial del juego de Roblox **Sky Eggs**: presenta el juego, enseña cómo se juega, deja abrir un huevo de prueba y lleva al juego y al Discord.

- 🎮 Jugar: https://www.roblox.com/es/games/77372347150746/Huevos-del-cielo
- 💬 Discord: https://discord.gg/sTgtR7KdGQ

## Probar en local

```bash
cd site
python3 -m http.server 8080
# abre http://localhost:8080
```

O con Docker:

```bash
cp .env.example .env   # pon DOMAIN
docker build --build-arg SITE_URL=http://localhost:8080 -t skyeggs-web .
docker run --rm -p 8080:80 skyeggs-web
```

## Desplegar

Ver [DEPLOY.md](DEPLOY.md): Docker + Traefik con HTTPS automático y despliegue por GitHub Actions en cada push a `main`.
