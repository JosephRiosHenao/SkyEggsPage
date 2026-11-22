# API de Prueba tu suerte y del Programa de Creadores
# Node sin dependencias + SQLite integrado + yt-dlp (lectura de vistas sin claves).
FROM node:22-alpine

ENV NODE_ENV=production PORT=8080 DB_PATH=/data/skyeggs.db \
    YTDLP_PATH=/opt/ytdlp/bin/yt-dlp YTDLP_PIP=/opt/ytdlp/bin/pip
WORKDIR /app

# yt-dlp en un entorno propio, del usuario node, para que la API lo actualice sola cada día.
RUN apk add --no-cache python3 \
 && python3 -m venv /opt/ytdlp \
 && /opt/ytdlp/bin/pip install --no-cache-dir -q yt-dlp \
 && /opt/ytdlp/bin/yt-dlp --version \
 && chown -R node:node /opt/ytdlp

COPY package.json ./
COPY src ./src

RUN mkdir -p /data && chown -R node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD wget -qO- http://127.0.0.1:8080/api/health || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "src/server.js"]
