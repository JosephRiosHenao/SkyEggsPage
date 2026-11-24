// Imágenes de los assets del juego guardadas en la página (íconos de huevos y mascotas).
// El juego manda su catálogo (nombre, rareza, ícono) a POST /api/game/catalog; la API baja cada imagen una
// vez y la sirve en /api/media/asset/<id>.png. Así Discord (alertas) y la web no dependen de Roblox.
//
// Cómo se baja cada imagen:
//  1. Con ROBLOX_API_KEY (API key de Open Cloud de la cuenta del dueño, permiso legacy-asset:manage):
//     Asset Delivery → archivo original (sirve también para imágenes privadas del grupo).
//  2. Sin clave: API pública de miniaturas (420×420). Las imágenes privadas devuelven "bloqueada".
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

const KINDS = new Set(["egg", "pet", "other"]);
const assetIdOf = (v) => { const m = String(v ?? "").match(/(\d{5,20})/); return m ? Number(m[1]) : 0; };

export function sniffImage(buf) {
  if (!buf || buf.length < 4) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return { type: "image/png", ext: "png" };
  if (buf[0] === 0xff && buf[1] === 0xd8) return { type: "image/jpeg", ext: "jpg" };
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return { type: "image/gif", ext: "gif" };
  if (buf.length > 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return { type: "image/webp", ext: "webp" };
  return null;
}

// Catálogo que manda el juego. items = [{ kind, name, rarity, icon }]
export function saveCatalog(db, items, now = Date.now()) {
  const up = db.prepare(`INSERT INTO game_assets (asset_id, kind, name, rarity, updated_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(asset_id) DO UPDATE SET kind = excluded.kind, name = excluded.name, rarity = excluded.rarity, updated_at = excluded.updated_at`);
  let n = 0;
  for (const it of (Array.isArray(items) ? items : []).slice(0, 2000)) {
    const id = assetIdOf(it?.icon);
    const name = String(it?.name || "").slice(0, 80);
    if (!id || !name) continue;
    up.run(id, KINDS.has(it.kind) ? it.kind : "other", name, it.rarity ? String(it.rarity).slice(0, 30) : null, now);
    n++;
  }
  return { ok: true, saved: n };
}

export function catalog(db, cfg) {
  return db.prepare("SELECT asset_id, kind, name, rarity, file, source FROM game_assets ORDER BY kind, rarity, name").all().map((a) => ({
    assetId: a.asset_id, kind: a.kind, name: a.name, rarity: a.rarity,
    image: a.file ? `${cfg.siteUrl}/api/media/asset/${a.asset_id}` : null, source: a.source,
  }));
}

async function fromAssetDelivery(cfg, id, fetchImpl) {
  const meta = await fetchImpl(`https://apis.roblox.com/asset-delivery-api/v1/assetId/${id}`, { headers: { "x-api-key": cfg.roblox.apiKey }, signal: AbortSignal.timeout(10_000) });
  if (!meta.ok) throw new Error(`asset-delivery ${meta.status}${meta.status === 403 ? " (la API key necesita legacy-asset:manage y ser de la cuenta dueña)" : ""}`);
  const { location } = await meta.json();
  if (!location) throw new Error("asset-delivery sin location");
  const file = await fetchImpl(location, { signal: AbortSignal.timeout(15_000) });
  if (!file.ok) throw new Error(`descarga ${file.status}`);
  let buf = Buffer.from(await file.arrayBuffer());
  if (buf[0] === 0x1f && buf[1] === 0x8b) buf = gunzipSync(buf); // Roblox lo entrega comprimido
  return buf;
}

async function fromThumbnails(id, fetchImpl) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetchImpl(`https://thumbnails.roblox.com/v1/assets?assetIds=${id}&returnPolicy=PlaceHolder&size=420x420&format=Png&isCircular=false`, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`thumbnails ${r.status}`);
    const item = ((await r.json()).data || [])[0];
    if (item?.state === "Completed" && item.imageUrl) {
      const img = await fetchImpl(item.imageUrl, { signal: AbortSignal.timeout(10_000) });
      if (!img.ok) throw new Error(`imagen ${img.status}`);
      return Buffer.from(await img.arrayBuffer());
    }
    if (item?.state === "Blocked") throw new Error("imagen privada: hace falta ROBLOX_API_KEY con legacy-asset:manage");
    await new Promise((res) => setTimeout(res, 1500)); // Pending: Roblox la está generando
  }
  throw new Error("miniatura pendiente");
}

// Imagen de un asset: de disco si ya se bajó; si no, la baja y la guarda. Devuelve { bytes, type, ext } | null.
export async function assetImage(db, cfg, assetId, fetchImpl = fetch, { force = false } = {}) {
  const id = assetIdOf(assetId);
  if (!id) return null;
  const row = db.prepare("SELECT * FROM game_assets WHERE asset_id = ?").get(id);
  if (row?.file && !force) {
    const path = join(cfg.mediaDir, row.file);
    if (existsSync(path)) { const bytes = readFileSync(path); const t = sniffImage(bytes); if (t) return { bytes, ...t }; }
  }
  // No reintentar en bucle algo que acaba de fallar (10 min).
  if (row?.error && row.fetched_at && Date.now() - row.fetched_at < 10 * 60_000 && !force) return null;
  let bytes = null, source = null, error = null;
  if (cfg.roblox?.apiKey) {
    try { bytes = await fromAssetDelivery(cfg, id, fetchImpl); source = "asset-delivery"; } catch (e) { error = e.message; }
  }
  if (!bytes) {
    try { bytes = await fromThumbnails(id, fetchImpl); source = "thumbnails"; error = null; } catch (e) { error = error ? `${error}; ${e.message}` : e.message; }
  }
  const t = bytes && sniffImage(bytes);
  if (!t) {
    db.prepare(`INSERT INTO game_assets (asset_id, kind, name, updated_at, fetched_at, error) VALUES (?, 'other', ?, ?, ?, ?)
      ON CONFLICT(asset_id) DO UPDATE SET fetched_at = excluded.fetched_at, error = excluded.error`).run(id, `#${id}`, Date.now(), Date.now(), String(error || "no es una imagen").slice(0, 300));
    return null;
  }
  mkdirSync(cfg.mediaDir, { recursive: true });
  const file = `${id}.${t.ext}`;
  writeFileSync(join(cfg.mediaDir, file), bytes);
  db.prepare(`INSERT INTO game_assets (asset_id, kind, name, updated_at, file, source, fetched_at, error) VALUES (?, 'other', ?, ?, ?, ?, ?, NULL)
    ON CONFLICT(asset_id) DO UPDATE SET file = excluded.file, source = excluded.source, fetched_at = excluded.fetched_at, error = NULL`).run(id, `#${id}`, Date.now(), file, source, Date.now());
  return { bytes, ...t };
}

// Baja, sin prisa, las imágenes del catálogo que faltan (o todas con force). Una cada 500 ms.
let syncing = false;
export async function syncAssets(db, cfg, fetchImpl = fetch, log = console, { force = false, limit = 400 } = {}) {
  if (syncing) return { running: true };
  syncing = true;
  let ok = 0, failed = 0;
  try {
    const rows = db.prepare(`SELECT asset_id FROM game_assets WHERE ${force ? "1" : "file IS NULL"} ORDER BY kind = 'egg' DESC LIMIT ?`).all(limit);
    for (const r of rows) {
      const img = await assetImage(db, cfg, r.asset_id, fetchImpl, { force: true });
      if (img) ok++; else failed++;
      await new Promise((res) => setTimeout(res, 500));
    }
    if (ok || failed) log.info(`[assets] ${ok} imagen(es) guardada(s), ${failed} con error`);
  } finally { syncing = false; }
  return { ok, failed };
}

export function assetStatus(db) {
  return db.prepare("SELECT COUNT(*) AS total, SUM(file IS NOT NULL) AS saved, SUM(error IS NOT NULL) AS errors FROM game_assets").get();
}
