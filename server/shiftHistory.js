// Shift History: one plain timeline per line and production date, so a supervisor can see what really happened
// (forms sent and what the Pi answered, OT, edits, why a shift ended, model changes, downtime, hours closed).
// Sources: tablet commands (commands), durable Pi events (machine_events) and shift starts/ends the server saw (shift_log).
import { randomUUID } from 'node:crypto';

export const historyRoles = ['management', 'executive', 'developer'];
const clock = iso => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kuala_Lumpur', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
const hours = p => p?.startAt && p?.endAt ? `${clock(p.startAt)} – ${clock(p.endAt)}` : p?.workingTime || '';
const ot = p => p?.overtime === true ? 'WITH OT' : p?.overtime === false ? 'NO OT' : '';
const join = (...parts) => parts.filter(part => part !== '' && part != null).join(' · ');
const statusText = { confirmed: 'Accepted', scheduled: 'Queued', rejected: 'Refused', unconfirmed: 'No answer from the Pi', pending: 'Waiting for the Pi', failed: 'Not sent' };
const endReasons = { 'SCHEDULED SHIFT END': 'At its scheduled end time', 'MANUAL SHIFT END': 'By an end-shift message on the Pi (Node-RED or manual), not by the Checksheet', 'OVERRIDE SHIFT END': 'By "End and start new shift" in the Checksheet', 'MISSED SCHEDULED SHIFT END RECOVERED AT STARTUP': 'When the Pi restarted after its scheduled end time' };

export function describeCommand(kind, p = {}) {
  if (kind === 'shift') return { title: `Shift form: ${join(p.shift, p.date)}`, detail: join(ot(p), hours(p)) };
  if (kind === 'shift-edit') return { title: `Shift edited: ${join(p.shift, p.date)}`, detail: join(ot(p), hours(p)) };
  if (kind === 'restart-shift') return { title: `End and start new shift: ${join(p.shift, p.date)}`, detail: join(ot(p), hours(p), p.reason ? `Reason: ${p.reason}` : '') };
  if (kind === 'setup') return { title: `Model set: ${p.model || '—'}`, detail: join(p.lot ? `Lot ${p.lot}` : '', p.plan ? `Target ${p.plan}/h` : '') };
  if (kind === 'mode') return { title: `Mode: ${p.mode === 'REST' ? 'Rest' : p.mode === 'NORMAL' ? 'Normal' : p.mode || '—'}`, detail: '' };
  if (kind === 'timer') return { title: `Downtime timer: ${p.action || '—'}`, detail: join(p.category, p.reason, p.action === 'log' && p.duration ? `${p.duration} min` : '') };
  if (kind === 'reject') return { title: 'Reject entered', detail: join(p.code, p.remarks) };
  if (kind === 'condition') return { title: 'Machine condition entered', detail: '' };
  if (kind === 'adjust') return { title: `Count adjusted ${p.adjust > 0 ? '+1' : '-1'}`, detail: p.reason || '' };
  if (kind === 'end') return { title: 'Shift ended', detail: '' };
  return { title: kind, detail: '' };
}
export function describeEvent(e) {
  const p = e.payload || {};
  // The Pi sends the whole shift record under "shift" (an object); older events may carry plain fields.
  if (e.event_type === 'shift.started') { const s = p.shift && typeof p.shift === 'object' ? p.shift : p; return { title: 'Shift started on the Pi', detail: join(typeof s.shift === 'string' ? s.shift : '', ot(s), s.working_time || s.workingTime) }; }
  if (e.event_type === 'shift.ended') return { title: 'Shift ended on the Pi', detail: join(endReasons[p.end_reason] || p.end_reason, Number.isFinite(Number(p.shift_total_output)) ? `Output ${p.shift_total_output}` : '') };
  if (e.event_type === 'hourly.finalized') return { title: `Hour ${p.hour_slot || ''} closed`, detail: join(p.model, `Plan ${p.plan ?? '—'}`, `Actual ${p.actual ?? '—'}`) };
  if (e.event_type === 'downtime.recorded') return { title: `Downtime logged: ${p.category || '—'}`, detail: join(p.duration_minutes !== '' && p.duration_minutes != null ? `${p.duration_minutes} min` : '', p.description, p.action_taken) };
  if (e.event_type === 'model.configured') return { title: `Model on the Pi: ${p.model || '—'}`, detail: p.lot_number ? `Lot ${p.lot_number}` : '' };
  if (e.event_type === 'reject.recorded') return { title: 'Reject recorded on the Pi', detail: '' };
  if (e.event_type === 'parameter.recorded') return { title: 'Machine condition recorded on the Pi', detail: '' };
  return { title: e.event_type, detail: '' };
}
// A production date runs from the Day shift (08:00) to the end of its Night shift with OT (08:00 next day); keep a margin each side.
export function dayWindow(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date)) || Number.isNaN(Date.parse(`${date}T00:00:00+08:00`))) return null;
  const start = Date.parse(`${date}T06:00:00+08:00`);
  return { from: start, to: start + 28 * 3600000 };
}

export function createShiftHistory({ db }) {
  db.exec('CREATE TABLE IF NOT EXISTS shift_log (id TEXT PRIMARY KEY, line TEXT NOT NULL, at TEXT NOT NULL, shift_id TEXT, title TEXT NOT NULL, detail TEXT NOT NULL DEFAULT \'\', actor TEXT NOT NULL DEFAULT \'\'); CREATE INDEX IF NOT EXISTS shift_log_line_at ON shift_log(line, at);');
  function log(line, { shiftId = null, title, detail = '', actor = '' }) {
    db.prepare('INSERT INTO shift_log VALUES(?,?,?,?,?,?,?)').run(randomUUID(), line, new Date().toISOString(), shiftId, title, String(detail || '').slice(0, 300), String(actor || '').slice(0, 80));
  }
  function timeline(line, date) {
    const range = dayWindow(date); if (!range) throw new Error('Choose a valid date.');
    const inRange = at => { const t = Date.parse(at); return t >= range.from && t < range.to; };
    const iso = t => new Date(t).toISOString(), items = [];
    for (const c of db.prepare('SELECT id, kind, status, created_at, payload, result FROM commands WHERE line=? AND created_at>=? AND created_at<?').all(line, iso(range.from), iso(range.to))) {
      let p = {}; try { p = JSON.parse(c.payload); } catch { /* keep the row */ }
      items.push({ id: c.id, at: c.created_at, source: 'tablet', shiftId: p.id || null, actor: p.actor || '', status: statusText[c.status] || c.status, refused: ['rejected', 'failed'].includes(c.status), note: c.result || '', ...describeCommand(c.kind, p) });
    }
    for (const row of db.prepare('SELECT event_id, envelope FROM machine_events WHERE line=?').all(line)) {
      let e; try { e = JSON.parse(row.envelope); } catch { continue; }
      if (!inRange(e.occurred_at)) continue;
      items.push({ id: row.event_id, at: new Date(Date.parse(e.occurred_at)).toISOString(), source: 'pi', shiftId: e.shift_id || e.payload?.shift_id || null, actor: '', status: '', refused: false, note: '', ...describeEvent(e) });
    }
    for (const row of db.prepare('SELECT * FROM shift_log WHERE line=? AND at>=? AND at<?').all(line, iso(range.from), iso(range.to))) items.push({ id: row.id, at: row.at, source: 'server', shiftId: row.shift_id, actor: row.actor, status: '', refused: false, note: '', title: row.title, detail: row.detail });
    items.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.id.localeCompare(b.id));
    return { line, date, items, shifts: [...new Set(items.map(item => item.shiftId).filter(Boolean))] };
  }
  return {
    log, timeline,
    route(req, res) {
      if (!historyRoles.includes(req.user?.role)) return res.status(403).json({ error: 'Shift history is for supervisors and managers.' });
      try { res.json(timeline(req.line, String(req.query.date || ''))); } catch (error) { res.status(400).json({ error: error.message }); }
    }
  };
}
