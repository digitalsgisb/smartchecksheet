// Henkaten history: every 4M entry kept for good (the board itself still starts fresh each shift), editable by
// executives and managers with a trail of what it said before. Voided entries stay visible, marked void.
import { randomUUID } from 'node:crypto';
import { requireText } from './domain.js';

export const editRoles = ['management', 'executive', 'developer'];
const categories = ['man', 'machine', 'material', 'method'];
const fields = ['category', 'issue', 'action', 'status', 'voidReason'];
const reportLine = key => String(key).replace(/^manual:/, '');
const row = r => r && { id: r.id, line: r.line, shiftId: r.shift_id, category: r.category, issue: r.issue, action: r.action, status: r.status, actor: r.actor, createdAt: r.created_at, resolvedAt: r.resolved_at, resolvedBy: r.resolved_by, editedAt: r.edited_at, editedBy: r.edited_by, voidReason: r.void_reason };

// One rule for all three workspaces: copy an edited entry into the shift's issues and redraw the two cards it touches.
export function applyHenkatenEdit(state, entry) {
  const item = state.issues?.find(i => i.id === entry.id); if (!item) return false;
  const before = item.category;
  Object.assign(item, { category: entry.category, issue: entry.issue, action: entry.action, status: entry.status, editedAt: entry.editedAt, editedBy: entry.editedBy, ...(entry.voidReason ? { voidReason: entry.voidReason } : {}) });
  for (const category of new Set([before, item.category])) {
    const card = state.henkaten?.[category]; if (!card) continue;
    const open = state.issues.filter(i => i.category === category && i.status === 'pending');
    if (open.length) state.henkaten[category] = { ...card, status: 'NG', issue: open[0].issue, action: open[0].action };
    else if (card.status === 'NG') state.henkaten[category] = { ...card, status: state.issues.some(i => i.category === category && i.status === 'resolved') ? 'OK' : 'WAITING', issue: '' };
  }
  return true;
}
// Reports keep the snapshot of their shift; downloads show the corrected Henkaten on top of it.
export function overlayIssues(snapshot, entries) {
  if (!Array.isArray(snapshot?.issues)) return snapshot;
  const byId = new Map(entries.map(e => [e.id, e]));
  return { ...snapshot, issues: snapshot.issues.map(i => { const e = byId.get(i.id); return e?.editedAt ? { ...i, category: e.category, issue: e.issue, action: e.action, status: e.status, editedAt: e.editedAt, editedBy: e.editedBy, voidReason: e.voidReason } : i; }) };
}

export function createHenkatenLog({ db }) {
  db.exec(`CREATE TABLE IF NOT EXISTS henkaten_entries (id TEXT PRIMARY KEY, line TEXT NOT NULL, shift_id TEXT, category TEXT NOT NULL, issue TEXT NOT NULL, action TEXT NOT NULL DEFAULT '', status TEXT NOT NULL, actor TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, resolved_at TEXT, resolved_by TEXT, edited_at TEXT, edited_by TEXT, void_reason TEXT);
    CREATE INDEX IF NOT EXISTS henkaten_entries_line_created ON henkaten_entries(line, created_at);
    CREATE TABLE IF NOT EXISTS henkaten_edits (id TEXT PRIMARY KEY, entry_id TEXT NOT NULL, at TEXT NOT NULL, actor TEXT NOT NULL, before TEXT NOT NULL, after TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS henkaten_edits_entry ON henkaten_edits(entry_id, at);`);
  const upsert = (update) => db.prepare(`INSERT INTO henkaten_entries(id,line,shift_id,category,issue,action,status,actor,created_at,resolved_at,resolved_by,edited_at,edited_by,void_reason) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO ${update ? 'UPDATE SET category=excluded.category, issue=excluded.issue, action=excluded.action, status=excluded.status, resolved_at=excluded.resolved_at, resolved_by=excluded.resolved_by, edited_at=excluded.edited_at, edited_by=excluded.edited_by, void_reason=excluded.void_reason WHERE henkaten_entries.edited_at IS NULL OR excluded.edited_at IS NOT NULL' : 'NOTHING'}`);
  const save = (statement, line, shiftId, i) => statement.run(String(i.id), line, shiftId || null, String(i.category || ''), String(i.issue || ''), String(i.action || ''), String(i.status || 'pending'), String(i.actor || ''), String(i.createdAt || new Date().toISOString()), i.resolvedAt || null, i.resolvedBy || null, i.editedAt || null, i.editedBy || null, i.voidReason || null);
  // First start: take the history that already exists in saved reports and line states (newest copy of each entry wins).
  if (!db.prepare('SELECT 1 FROM henkaten_entries LIMIT 1').get()) {
    const keep = upsert(false);
    db.exec('BEGIN');
    try {
      for (const s of db.prepare('SELECT line, value FROM state').all()) { try { const v = JSON.parse(s.value); for (const i of v.issues || []) if (i?.id) save(keep, reportLine(s.line), v.shift?.id, i); } catch { /* skip a broken row */ } }
      for (const r of db.prepare('SELECT line, shift_id, snapshot FROM reports ORDER BY created_at DESC').all()) { try { for (const i of JSON.parse(r.snapshot).issues || []) if (i?.id) save(keep, reportLine(r.line), r.shift_id, i); } catch { /* skip a broken row */ } }
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); console.error('Henkaten history import:', error.message); }
  }
  const write = upsert(true), seen = new Map();
  // Called whenever a workspace saves its state: the current shift's entries are copied as they are.
  function sync(line, shiftId, issues = []) {
    const key = JSON.stringify(issues); if (seen.get(line) === key) return; seen.set(line, key);
    for (const i of issues) if (i?.id) save(write, line, shiftId, i);
  }
  const get = id => row(db.prepare('SELECT * FROM henkaten_entries WHERE id=?').get(String(id)));
  function list(line, from, to) {
    const valid = d => /^\d{4}-\d{2}-\d{2}$/.test(String(d)) && !Number.isNaN(Date.parse(`${d}T00:00:00+08:00`));
    if (!valid(from) || !valid(to) || from > to) throw new Error('Choose a valid date range.');
    const start = new Date(Date.parse(`${from}T00:00:00+08:00`)).toISOString(), end = new Date(Date.parse(`${to}T00:00:00+08:00`) + 86400000).toISOString();
    const entries = db.prepare('SELECT * FROM henkaten_entries WHERE line=? AND created_at>=? AND created_at<? ORDER BY created_at DESC').all(line, start, end).map(row);
    const edits = db.prepare(`SELECT * FROM henkaten_edits WHERE entry_id IN (SELECT id FROM henkaten_entries WHERE line=? AND created_at>=? AND created_at<?) ORDER BY at`).all(line, start, end);
    for (const e of entries) e.edits = edits.filter(x => x.entry_id === e.id).map(x => ({ at: x.at, actor: x.actor, before: JSON.parse(x.before), after: JSON.parse(x.after) }));
    return { line, from, to, entries };
  }
  const own = (line, id) => { const entry = get(id); if (!entry || entry.line !== line) throw Object.assign(new Error('Entry not found for this line.'), { status: 404 }); return entry; };
  function change(line, id, next, actor) {
    const entry = own(line, id);
    const before = Object.fromEntries(fields.map(f => [f, entry[f] ?? null])), after = { ...before, ...next };
    if (fields.every(f => before[f] === after[f])) return entry;
    const at = new Date().toISOString();
    db.exec('BEGIN');
    try {
      db.prepare('UPDATE henkaten_entries SET category=?, issue=?, action=?, status=?, void_reason=?, edited_at=?, edited_by=? WHERE id=?').run(after.category, after.issue, after.action, after.status, after.voidReason, at, actor, entry.id);
      db.prepare('INSERT INTO henkaten_edits VALUES(?,?,?,?,?,?)').run(randomUUID(), entry.id, at, actor, JSON.stringify(before), JSON.stringify(after));
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    seen.delete(line);
    return get(entry.id);
  }
  function edit(line, id, p = {}, actor) {
    if (!categories.includes(p.category)) throw new Error('Choose Man, Machine, Material or Method.');
    if (own(line, id).status === 'void') throw new Error('This entry is void and cannot be edited.');
    return change(line, id, { category: p.category, issue: requireText(p.issue, 'Problem', 500), action: typeof p.action === 'string' ? p.action.trim().slice(0, 500) : '' }, actor);
  }
  function voidEntry(line, id, reason, actor) {
    if (own(line, id).status === 'void') throw new Error('This entry is already void.');
    return change(line, id, { status: 'void', voidReason: requireText(reason, 'Reason', 200) }, actor);
  }
  // All saved entries of one shift (used to correct report downloads).
  const forShift = (line, shiftId) => db.prepare('SELECT * FROM henkaten_entries WHERE line=? AND shift_id=?').all(line, shiftId).map(row);
  return { sync, list, edit, void: voidEntry, get, forShift };
}
