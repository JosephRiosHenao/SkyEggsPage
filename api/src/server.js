// Arranque de la API de Sky Eggs.
import { createServer } from "node:http";
import { config, validateConfig } from "./config.js";
import { openDb } from "./db.js";
import { createApp } from "./app.js";

const problems = validateConfig();
if (problems.length) {
  for (const p of problems) console.error(`[config] ${p}`);
  process.exit(1);
}

const db = openDb(config.dbPath);
const server = createServer(createApp({ db, cfg: config }));
server.headersTimeout = 10_000;
server.requestTimeout = 15_000;
server.listen(config.port, () => console.log(`[api] escuchando en :${config.port}`));

const stop = () => server.close(() => { db.close(); process.exit(0); });
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
