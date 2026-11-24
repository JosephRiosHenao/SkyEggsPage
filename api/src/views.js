// Lectura automática de vistas, libre y sin claves ni cuentas.
// YouTube: páginas públicas + Return YouTube Dislike (ver probeYouTube). TikTok, Twitch y Kick: yt-dlp. Instagram, Facebook y el resto piden
// sesión: esas evidencias quedan con vistas fijas que pone un moderador.
import { spawn } from "node:child_process";

const HOSTS = [
  [/^(www\.|m\.|music\.)?youtube\.com$|^youtu\.be$/, "youtube"],
  [/^(www\.|m\.|vm\.|vt\.)?tiktok\.com$/, "tiktok"],
  [/^(www\.|m\.|clips\.)?twitch\.tv$/, "twitch"],
  [/^(www\.)?kick\.com$/, "kick"],
];

// Plataforma detectable o null. Solo https y hosts conocidos (evita pedir URLs internas).
export function trackableSite(rawUrl) {
  let u;
  try { u = new URL(rawUrl); } catch { return null; }
  if (u.protocol !== "https:" || u.port) return null;
  const host = u.hostname.toLowerCase();
  for (const [re, site] of HOSTS) if (re.test(host)) return site;
  return null;
}

function runYtDlp(cfg, url) {
  return new Promise((resolve) => {
    const args = [
      "--ignore-config", "--no-playlist", "--skip-download", "--dump-single-json",
      "--no-warnings", "--socket-timeout", "15", "--ies", "default,-generic",
      "--js-runtimes", "node", "--", url,
    ];
    let out = "", err = "", done = false;
    let child;
    try {
      child = spawn(cfg.views.ytdlpPath, args, { stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) { return resolve({ ok: false, error: `no se pudo ejecutar yt-dlp: ${e.message}` }); }
    const finish = (r) => { if (!done) { done = true; clearTimeout(timer); resolve(r); } };
    const timer = setTimeout(() => { child.kill("SIGKILL"); finish({ ok: false, error: "tardó demasiado" }); }, cfg.views.timeoutMs);
    child.stdout.on("data", (d) => { out += d; if (out.length > 8e6) { child.kill("SIGKILL"); finish({ ok: false, error: "respuesta demasiado grande" }); } });
    child.stderr.on("data", (d) => { if (err.length < 4000) err += d; });
    child.on("error", (e) => finish({ ok: false, error: `yt-dlp no disponible (${e.code || e.message})` }));
    child.on("close", (code) => {
      if (code !== 0) return finish({ ok: false, error: (err.split("\n").find((l) => l.includes("ERROR")) || err || `código ${code}`).replace(/^ERROR:\s*/, "").slice(0, 200) });
      try { finish({ ok: true, json: JSON.parse(out) }); } catch { finish({ ok: false, error: "respuesta ilegible" }); }
    });
  });
}

// ---------- YouTube sin claves ----------
// Desde IPs de servidor YouTube suele responder "Sign in to confirm you're not a bot" a yt-dlp y a /watch.
// Por eso se prueban, en orden, fuentes públicas que no piden cuenta ni configuración:
//  1. La página /shorts/<id>: sigue cargando desde servidores y trae las vistas exactas en ytInitialData.
//  2. La página /watch?v=<id> (videos normales), si YouTube no la bloquea en ese momento.
//  3. Return YouTube Dislike (returnyoutubedislikeapi.com): API libre con las vistas de cualquier video.
//  4. API oficial (solo si se puso YOUTUBE_API_KEY) y, al final, yt-dlp.
const YT_HEADERS = {
  "Accept-Language": "en-US,en;q=0.9",
  // Rechaza las cookies opcionales: evita la pantalla de consentimiento en servidores de Europa.
  Cookie: "SOCS=CAI; CONSENT=PENDING+999",
};

export function youtubeId(rawUrl) {
  let u;
  try { u = new URL(rawUrl); } catch { return null; }
  const id = u.hostname.toLowerCase() === "youtu.be" ? u.pathname.split("/")[1]
    : u.searchParams.get("v") || (u.pathname.match(/^\/(shorts|live|embed|v)\/([\w-]{11})/) || [])[2];
  return id && /^[\w-]{11}$/.test(id) ? id : null;
}

// "1,234,567 views" → 1234567 · "796" → 796 · "1.2M views" → 1200000 · "No views" → 0
export function parseCount(text) {
  if (typeof text !== "string") return NaN;
  const t = text.trim();
  if (/^no views/i.test(t)) return 0;
  const abbr = t.match(/^([\d.,]+)\s*([KMB])\b/i);
  if (abbr) return Math.round(Number(abbr[1].replace(",", ".")) * { k: 1e3, m: 1e6, b: 1e9 }[abbr[2].toLowerCase()]);
  const digits = (t.match(/^[\d.,\s  ]+/) || [""])[0].replace(/\D/g, "");
  return digits ? Number(digits) : NaN;
}

function jsonVar(html, name) {
  const m = html.match(new RegExp(`(?:var |window\\["?)${name}"?\\]?\\s*=\\s*(\\{.*?\\});\\s*(?:var |</script>)`, "s"));
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

function findKey(obj, key, depth = 0) {
  if (!obj || typeof obj !== "object" || depth > 40) return null;
  if (Object.hasOwn(obj, key)) return obj[key];
  for (const v of Object.values(obj)) { const r = findKey(v, key, depth + 1); if (r) return r; }
  return null;
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
function ymd(text) {
  if (typeof text !== "string") return null;
  let m = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}${m[2]}${m[3]}`;
  m = text.match(/([A-Z][a-z]{2})[a-z]*\.? (\d{1,2}), (\d{4})/);
  if (m && MONTHS[m[1].toLowerCase()]) return `${m[3]}${String(MONTHS[m[1].toLowerCase()]).padStart(2, "0")}${m[2].padStart(2, "0")}`;
  return null;
}

async function getText(fetchImpl, url, timeoutMs, headers = {}) {
  const res = await fetchImpl(url, { headers, redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
  const location = res.headers.get("location") || "";
  const body = res.status === 200 ? await res.text() : (await res.body?.cancel?.().catch(() => {}), "");
  return { status: res.status, location, body };
}

// Lee las vistas del HTML de /shorts/ o /watch. null si la página no las trae.
export function viewsFromPage(html, id) {
  const blocked = /google\.com\/sorry|consent\.youtube\.com/.test(html.slice(0, 3000));
  if (blocked) return null;
  const data = jsonVar(html, "ytInitialData");
  const player = jsonVar(html, "ytInitialPlayerResponse");
  const details = player?.videoDetails;
  const header = findKey(data, "videoDescriptionHeaderRenderer");
  const factoid = findKey(data, "viewCountFactoidRenderer")?.factoid?.factoidRenderer;
  const primary = findKey(data, "videoPrimaryInfoRenderer")?.viewCount?.videoViewCountRenderer;
  const candidates = [
    details?.videoId === id ? details?.viewCount : null,
    header?.views?.simpleText,
    factoid?.accessibilityText,
    primary?.originalViewCount,
    primary?.viewCount?.simpleText,
    factoid?.value?.simpleText,
  ];
  // Cada bloque de la página se actualiza a su ritmo: se toma el conteo exacto más alto.
  // El valor corto de la ficha ("1.2M") solo se usa si no hay ningún otro.
  const exact = candidates.slice(0, -1).map((c) => parseCount(String(c ?? ""))).filter(Number.isFinite);
  const views = exact.length ? Math.max(...exact) : parseCount(candidates.at(-1));
  if (!Number.isFinite(views)) return null;
  const micro = player?.microformat?.playerMicroformatRenderer;
  return {
    view_count: views,
    title: details?.title || null,
    uploader: details?.author || header?.channel?.simpleText || null,
    channel_url: details?.channelId ? `https://www.youtube.com/channel/${details.channelId}` : null,
    upload_date: ymd(micro?.publishDate || micro?.uploadDate) || ymd(header?.publishDate?.simpleText),
    is_live: Boolean(details?.isLive),
    was_live: Boolean(details?.isLiveContent),
  };
}

async function youtubeScrape(cfg, id, fetchImpl) {
  const t = Math.min(cfg.views.timeoutMs, 20_000);
  const s = await getText(fetchImpl, `https://www.youtube.com/shorts/${id}?hl=en&gl=US`, t, YT_HEADERS);
  if (s.status === 200) { const j = viewsFromPage(s.body, id); if (j) return { ok: true, json: j }; }
  // No es un short (YouTube redirige a /watch) o no trajo vistas: se intenta la página normal.
  const w = await getText(fetchImpl, `https://www.youtube.com/watch?v=${id}&hl=en&gl=US`, t, YT_HEADERS);
  if (w.status === 200) { const j = viewsFromPage(w.body, id); if (j) return { ok: true, json: j }; }
  const why = /sorry/.test(w.location) || /sorry/.test(w.body.slice(0, 3000)) ? "YouTube pidió verificación al servidor" : `YouTube respondió ${w.status}`;
  return { ok: false, error: why };
}

async function returnYouTubeDislike(cfg, id, fetchImpl) {
  const res = await fetchImpl(`https://returnyoutubedislikeapi.com/votes?videoId=${id}`, {
    headers: { Accept: "application/json" }, signal: AbortSignal.timeout(Math.min(cfg.views.timeoutMs, 15_000)),
  });
  const j = await res.json().catch(() => null);
  if (!res.ok || !j) return { ok: false, error: `Return YouTube Dislike: ${res.status}` };
  if (j.deleted) return { ok: false, error: "el video fue borrado o es privado" };
  const views = Number(j.viewCount);
  // Para videos recién publicados devuelve 0 hasta que actualiza sus datos: se reintenta sin contar como fallo.
  if (!Number.isFinite(views) || views <= 0) return { ok: false, retry: true, error: "YouTube aún no publica las vistas de este video; se vuelve a intentar" };
  return { ok: true, json: { view_count: views } };
}

// Título y canal públicos (oEmbed no muestra vistas pero no se bloquea). Nunca lanza.
async function youtubeOembed(id, fetchImpl) {
  try {
    const res = await fetchImpl(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return {};
    const j = await res.json();
    return { title: j.title, uploader: j.author_name, channel_url: j.author_url };
  } catch { return {}; }
}

// Respaldo opcional con la API oficial gratuita (solo si se pone YOUTUBE_API_KEY).
async function youtubeApi(cfg, id, fetchImpl) {
  const res = await fetchImpl(`https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet&id=${id}&key=${encodeURIComponent(cfg.views.youtubeApiKey)}`);
  const j = await res.json().catch(() => null);
  const item = j?.items?.[0];
  if (!res.ok || !item) return { ok: false, error: `API de YouTube: ${res.status}` };
  return {
    ok: true,
    json: {
      view_count: Number(item.statistics?.viewCount), title: item.snippet?.title, uploader: item.snippet?.channelTitle,
      channel_url: `https://www.youtube.com/channel/${item.snippet?.channelId}`, upload_date: (item.snippet?.publishedAt || "").slice(0, 10).replace(/-/g, ""),
    },
  };
}

async function probeYouTube(cfg, url, fetchImpl) {
  const id = youtubeId(url);
  if (!id) return { ok: false, error: "no se encontró el id del video" };
  const steps = [
    () => youtubeScrape(cfg, id, fetchImpl),
    () => returnYouTubeDislike(cfg, id, fetchImpl),
    cfg.views.youtubeApiKey ? () => youtubeApi(cfg, id, fetchImpl) : null,
    cfg.views.ytdlpPath ? () => runYtDlp(cfg, url) : null,
  ].filter(Boolean);
  const errors = [];
  let retry = false;
  for (const step of steps) {
    let r;
    try { r = await step(); } catch (e) { r = { ok: false, error: e.name === "TimeoutError" ? "tardó demasiado" : e.message }; }
    if (r.ok && Number.isFinite(Number(r.json?.view_count))) {
      if (!r.json.title || !r.json.uploader) r.json = { ...(await youtubeOembed(id, fetchImpl)), ...stripEmpty(r.json) };
      return r;
    }
    if (r.retry) retry = true;
    if (r.error) errors.push(r.error);
  }
  // Si alguna fuente dijo "todavía no", se prefiere ese motivo (no cuenta como fallo).
  if (retry) return { ok: false, retry: true, error: errors.find((e) => /aún no/.test(e)) };
  return { ok: false, error: errors[0] || "no se pudieron leer las vistas" };
}

const stripEmpty = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined && v !== ""));

// Devuelve { ok, views, meta } o { ok: false, error, retry? }.
export async function probeViews(cfg, url, fetchImpl = fetch) {
  const site = trackableSite(url);
  if (!site) return { ok: false, error: "esta red no permite leer vistas sin cuenta" };
  if (!cfg.views.enabled) return { ok: false, error: "lectura automática apagada" };
  const r = site === "youtube" ? await probeYouTube(cfg, url, fetchImpl) : await runYtDlp(cfg, url);
  if (!r.ok) return { ok: false, error: r.error, ...(r.retry ? { retry: true } : {}) };
  const j = r.json;
  const views = Number(j.view_count);
  if (!Number.isFinite(views) || views < 0) {
    return { ok: false, error: j.is_live ? "directo en curso: las vistas se leen cuando quede la grabación" : "la plataforma no muestra las vistas" };
  }
  const d = typeof j.upload_date === "string" && /^\d{8}$/.test(j.upload_date) ? `${j.upload_date.slice(0, 4)}-${j.upload_date.slice(4, 6)}-${j.upload_date.slice(6, 8)}` : null;
  return {
    ok: true,
    views: Math.floor(views),
    meta: {
      site,
      title: typeof j.title === "string" ? j.title.slice(0, 160) : null,
      channel: typeof (j.channel || j.uploader) === "string" ? String(j.channel || j.uploader).slice(0, 80) : null,
      channelUrl: typeof (j.channel_url || j.uploader_url) === "string" ? String(j.channel_url || j.uploader_url).slice(0, 300) : null,
      uploadDate: d,
      live: Boolean(j.is_live || j.was_live),
    },
  };
}

// Actualiza yt-dlp (las redes cambian seguido). Silencioso si falla.
export function updateYtDlp(cfg, log = console) {
  if (!cfg.views.enabled || !cfg.views.pipPath) return;
  try {
    const child = spawn(cfg.views.pipPath, ["install", "-q", "-U", "yt-dlp"], { stdio: "ignore" });
    child.on("close", (code) => log.info(`[views] actualización de yt-dlp: ${code === 0 ? "ok" : `falló (${code})`}`));
    child.on("error", () => {});
  } catch { /* sin pip */ }
}
