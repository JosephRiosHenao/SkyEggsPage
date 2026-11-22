// Lectura automática de vistas con yt-dlp (libre, sin claves ni cuentas).
// Solo para YouTube, TikTok, Twitch y Kick. Instagram, Facebook y el resto piden
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

// Respaldo opcional para YouTube con la API oficial gratuita (solo si se pone YOUTUBE_API_KEY).
async function youtubeApi(cfg, url, fetchImpl) {
  const u = new URL(url);
  const id = u.hostname === "youtu.be" ? u.pathname.slice(1) : u.searchParams.get("v") || (u.pathname.match(/\/(shorts|live|embed)\/([\w-]{11})/) || [])[2];
  if (!id || !/^[\w-]{11}$/.test(id)) return { ok: false, error: "no se encontró el id del video" };
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

// Devuelve { ok, views, meta } o { ok: false, error }.
export async function probeViews(cfg, url, fetchImpl = fetch) {
  const site = trackableSite(url);
  if (!site) return { ok: false, error: "esta red no permite leer vistas sin cuenta" };
  if (!cfg.views.enabled) return { ok: false, error: "lectura automática apagada" };
  let r = await runYtDlp(cfg, url);
  if ((!r.ok || !Number.isFinite(Number(r.json?.view_count))) && site === "youtube" && cfg.views.youtubeApiKey) {
    try { r = await youtubeApi(cfg, url, fetchImpl); } catch (e) { r = { ok: false, error: e.message }; }
  }
  if (!r.ok) return { ok: false, error: r.error };
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
