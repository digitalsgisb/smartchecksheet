import { tvTimers, validateTvTimers } from '../shared/tvTimers.js';

// TV Board panel times per line. Everyone on the line receives them in the snapshot (the TVs need them);
// only developers may change them. onChange pushes the new times to the open TVs at once.
export function createTvTimers({ db, onChange = () => {} }) {
  db.exec('CREATE TABLE IF NOT EXISTS tv_timers (line TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT NOT NULL)');
  function get(line) {
    const row = db.prepare('SELECT value, updated_at AS updatedAt, updated_by AS updatedBy FROM tv_timers WHERE line=?').get(line);
    let saved = {};
    try { saved = row ? JSON.parse(row.value) : {}; } catch {}
    return { ...tvTimers(saved), updatedAt: row?.updatedAt || null, updatedBy: row?.updatedBy || null };
  }
  return {
    get,
    save(req, res) {
      if (req.user?.role !== 'developer') return res.status(403).json({ error: 'Only a developer can change the TV timers.' });
      let value;
      try { value = validateTvTimers(req.body?.timers); } catch (error) { return res.status(400).json({ error: error.message }); }
      db.prepare('INSERT INTO tv_timers(line,value,updated_at,updated_by) VALUES(?,?,?,?) ON CONFLICT(line) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at, updated_by=excluded.updated_by').run(req.line, JSON.stringify(value), new Date().toISOString(), req.user.name);
      onChange(req.line);
      return res.json(get(req.line));
    }
  };
}
