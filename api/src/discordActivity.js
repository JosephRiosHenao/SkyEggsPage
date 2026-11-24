// Actividad del staff en Discord (2026-11-23). Sin Gateway ni librerías: cada 5 min el bot lee por
// REST los mensajes nuevos de los canales que eligió el Admin (GET /channels/{id}/messages?after=…).
// No hace falta "Message Content Intent": solo se mira el autor y la hora, nunca el texto.
// El bot necesita "Ver canal" y "Leer el historial de mensajes" en esos canales.
const API = "https://discord.com/api/v10";
const OFFSET_MS = -5 * 3_600_000;
const dayKey = (ms) => new Date(ms + OFFSET_MS).toISOString().slice(0, 10);
const big = (s) => BigInt(s);

// Hora de un snowflake de Discord.
export const snowflakeMs = (id) => Number((big(id) >> 22n) + 1420070400000n);

// Guarda los mensajes de los miembros del staff: ventanas activas y mensajes por día.
// messages = [{ id, author: { id, bot }, timestamp }]
export function recordDiscordMessages(db, settings, messages) {
  const staffIds = new Set(db.prepare("SELECT discord_id FROM staff WHERE link_status = 'approved' AND rank != 'None'").all().map((r) => r.discord_id));
  if (!staffIds.size) return 0;
  const winMs = settings.discord.windowMinutes * 60_000;
  const insWin = db.prepare("INSERT OR IGNORE INTO staff_discord_windows (discord_id, win, day) VALUES (?, ?, ?)");
  const insDay = db.prepare("INSERT INTO staff_discord_days (day, discord_id, messages) VALUES (?, ?, 1) ON CONFLICT(day, discord_id) DO UPDATE SET messages = messages + 1");
  let n = 0;
  for (const m of messages) {
    const uid = m?.author?.id;
    if (!uid || m.author.bot || !staffIds.has(uid)) continue;
    const ms = m.timestamp ? Date.parse(m.timestamp) : snowflakeMs(m.id);
    if (!Number.isFinite(ms)) continue;
    insWin.run(uid, Math.floor(ms / winMs), dayKey(ms));
    insDay.run(dayKey(ms), uid);
    n++;
  }
  return n;
}

// Minutos de Discord por día de un miembro entre d0 y d1 (incluidos), con el tope diario y el peso.
export function discordMinutesByDay(db, settings, discordId, d0, d1) {
  const rows = db.prepare("SELECT day, COUNT(*) AS w FROM staff_discord_windows WHERE discord_id = ? AND day BETWEEN ? AND ? GROUP BY day").all(String(discordId), d0, d1);
  const out = {};
  for (const r of rows) out[r.day] = Math.min(settings.discord.dailyCapMinutes, r.w * settings.discord.windowMinutes) * settings.discord.weight;
  return out;
}

// Lee los canales configurados. Primera vez: solo marca el último mensaje (no lee el pasado).
export async function pollDiscordChannels(db, cfg, settings, fetchImpl = fetch, now = Date.now(), maxPages = 5) {
  const out = { channels: 0, messages: 0, counted: 0, errors: [] };
  if (!cfg.discord.botToken || !settings.discord.channels.length) return out;
  const headers = { Authorization: `Bot ${cfg.discord.botToken}` };
  const save = db.prepare(`INSERT INTO discord_cursors (channel_id, last_id, name, updated_at, error) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(channel_id) DO UPDATE SET last_id = COALESCE(excluded.last_id, last_id), name = COALESCE(excluded.name, name), updated_at = excluded.updated_at, error = excluded.error`);
  for (const ch of settings.discord.channels) {
    out.channels++;
    const cur = db.prepare("SELECT * FROM discord_cursors WHERE channel_id = ?").get(ch);
    try {
      let name = cur?.name || null;
      if (!name) {
        const r = await fetchImpl(`${API}/channels/${ch}`, { headers });
        if (r.ok) name = (await r.json()).name || null;
      }
      let after = cur?.last_id;
      if (!after) {
        const r = await fetchImpl(`${API}/channels/${ch}/messages?limit=1`, { headers });
        if (!r.ok) throw new Error(explain(r.status, await r.json().catch(() => ({}))));
        const list = await r.json();
        save.run(ch, list[0]?.id || String((BigInt(now) - 1420070400000n) << 22n), name, now, null);
        continue;
      }
      for (let page = 0; page < maxPages; page++) {
        const r = await fetchImpl(`${API}/channels/${ch}/messages?limit=100&after=${after}`, { headers });
        if (r.status === 429) break; // límite de Discord: sigue en la próxima vuelta
        if (!r.ok) throw new Error(explain(r.status, await r.json().catch(() => ({}))));
        const list = (await r.json()).filter((m) => m && /^\d+$/.test(String(m.id)));
        if (!list.length) break;
        list.sort((a, b) => (big(a.id) < big(b.id) ? -1 : 1));
        out.messages += list.length;
        out.counted += recordDiscordMessages(db, settings, list);
        after = list[list.length - 1].id;
        save.run(ch, after, name, now, null);
        if (list.length < 100) break;
      }
      save.run(ch, null, name, now, null);
    } catch (e) {
      out.errors.push(`${ch}: ${e.message}`);
      save.run(ch, null, null, now, String(e.message).slice(0, 300));
    }
  }
  // Limpieza: ventanas de más de 120 días.
  db.prepare("DELETE FROM staff_discord_windows WHERE day < ?").run(dayKey(now - 120 * 86_400_000));
  return out;
}

function explain(status, body) {
  if (status === 403 || body?.code === 50001) return "403: el bot no puede ver ese canal (dale «Ver canal» y «Leer el historial de mensajes»)";
  if (status === 404 || body?.code === 10003) return "404: el canal no existe o el bot no está en el servidor";
  if (status === 401) return "401: token del bot inválido";
  return `${status}${body?.message ? `: ${body.message}` : ""}`;
}

export function discordChannelsStatus(db, settings) {
  return settings.discord.channels.map((id) => {
    const c = db.prepare("SELECT * FROM discord_cursors WHERE channel_id = ?").get(id);
    return { id, name: c?.name || null, lastRead: c?.updated_at || null, error: c?.error || null, started: Boolean(c?.last_id) };
  });
}
