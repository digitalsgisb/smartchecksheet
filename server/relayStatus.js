// Health of each line's Pi event relay: its once-a-minute heartbeat (queue size, set-aside events, last error) and the last event delivered.
// A heartbeat is never stored as a machine event.
export const RELAY_STALE_MS = 10 * 60000;
export function createRelayStatus({ db, now = Date.now }) {
  db.exec('CREATE TABLE IF NOT EXISTS relay_status (line TEXT PRIMARY KEY, seen_at TEXT, waiting INTEGER NOT NULL DEFAULT 0, refused INTEGER NOT NULL DEFAULT 0, last_error TEXT NOT NULL DEFAULT \'\', relay TEXT NOT NULL DEFAULT \'\', last_event_at TEXT)');
  const count = value => Number.isInteger(value) && value >= 0 ? Math.min(value, 1e9) : 0;
  const text = (value, max) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
  return {
    heartbeat(line, p = {}) {
      db.prepare(`INSERT INTO relay_status(line,seen_at,waiting,refused,last_error,relay) VALUES(?,?,?,?,?,?) ON CONFLICT(line) DO UPDATE SET seen_at=excluded.seen_at, waiting=excluded.waiting, refused=excluded.refused, last_error=excluded.last_error, relay=excluded.relay`)
        .run(line, new Date(now()).toISOString(), count(p.waiting), count(p.refused), text(p.last_error, 200), text(p.relay, 40));
    },
    delivered(line) {
      db.prepare('INSERT INTO relay_status(line,last_event_at) VALUES(?,?) ON CONFLICT(line) DO UPDATE SET last_event_at=excluded.last_event_at').run(line, new Date(now()).toISOString());
    },
    status(line) {
      const row = db.prepare('SELECT * FROM relay_status WHERE line=?').get(line);
      if (!row) return { seenAt: null, lastEventAt: null, waiting: null, refused: null, lastError: '', healthy: false };
      const seen = Date.parse(row.seen_at || '');
      return { seenAt: row.seen_at || null, lastEventAt: row.last_event_at || null, waiting: row.seen_at ? row.waiting : null, refused: row.seen_at ? row.refused : null, lastError: row.last_error, healthy: Number.isFinite(seen) && now() - seen < RELAY_STALE_MS };
    }
  };
}
