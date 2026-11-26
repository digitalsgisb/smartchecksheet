// Live screens (tablets, TVs) get the latest state of their own line, at most about once a second.
// Each Pi message used to send every open screen a full snapshot at once, and Node keeps unsent data without limit,
// so a slow TV fell further and further behind while still looking "Connected" (ABB7, 26/11: 12 minutes behind).
// Now only the newest state is sent: a screen whose previous frame has not left the server yet is skipped (it gets the
// newest one once it drains), and a screen stuck for stuckMs is cut off so the browser reconnects and starts fresh.
export function createSseHub({ snapshot, allowed = () => true, now = Date.now, minGapMs = 900, stuckMs = 30000 }) {
  const clients = new Map();
  const frame = (line, cache) => { if (!cache.has(line)) cache.set(line, `event: state\ndata: ${JSON.stringify(snapshot(line))}\n\n`); return cache.get(line); };
  const drop = (res, end = 'end') => { clients.delete(res); try { res[end](); } catch { /* already closed */ } };
  function add(res, session) { clients.set(res, { ...session, dirty: false, sentAt: now(), stuckSince: 0 }); res.write(frame(session.line, new Map())); }
  // Without a line every screen is due (shared lists, settings); with one, only that line's screens.
  function mark(line) { for (const client of clients.values()) if (!line || client.line === line) client.dirty = true; }
  function flush() {
    const t = now(), cache = new Map();
    for (const [res, client] of clients) {
      if (!client.dirty) continue;
      if (res.writableNeedDrain) { client.stuckSince ||= t; if (t - client.stuckSince >= stuckMs) drop(res, 'destroy'); continue; }
      client.stuckSince = 0;
      if (t - client.sentAt < minGapMs) continue;
      if (!allowed(client)) { drop(res); continue; }
      client.dirty = false; client.sentAt = t; res.write(frame(client.line, cache));
    }
  }
  return { add, mark, flush, remove: res => clients.delete(res), drop, entries: () => [...clients.entries()], get size() { return clients.size; } };
}
