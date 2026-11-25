import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../server/store.js';
import { createShiftHistory, dayWindow } from '../server/shiftHistory.js';
import { createManualWorkspace } from '../server/manualWorkspace.js';

function seed() {
  const db = openStore(':memory:'), history = createShiftHistory({ db });
  const command = (id, kind, status, at, payload, result = null) => db.prepare('INSERT INTO commands(id,kind,status,created_at,payload,line,result) VALUES(?,?,?,?,?,?,?)').run(id, kind, status, at, JSON.stringify(payload), 'SDY2', result);
  const event = (id, type, at, shiftId, payload) => db.prepare('INSERT INTO machine_events(line,event_id,envelope) VALUES(?,?,?)').run('SDY2', id, JSON.stringify({ event_id: id, event_type: type, line_code: 'SDY2', shift_id: shiftId, occurred_at: at, payload }));
  // The night of 24/11 on SDY2, as it was recorded.
  command('c1', 'shift', 'confirmed', '2026-11-24T12:06:38.194Z', { id: '20261124-Night-SDY2', date: '2026-11-24', shift: 'Night', overtime: true, startAt: '2026-11-24T12:00:00.000Z', endAt: '2026-11-25T00:00:00.000Z', actor: 'Sendayan 2' });
  command('c2', 'mode', 'confirmed', '2026-11-24T15:59:14.070Z', { mode: 'REST', actor: 'Sendayan 2' });
  event('e1', 'shift.ended', '2026-11-25T00:30:01+08:00', '20261124-Night-SDY2', { end_reason: 'MANUAL SHIFT END', shift_total_output: 161 });
  command('c3', 'shift', 'rejected', '2026-11-24T17:48:20.742Z', { id: '20261125-Night-SDY2', date: '2026-11-25', shift: 'Night', overtime: false, startAt: '2026-11-25T08:15:00.000Z', endAt: '2026-11-25T16:30:00.000Z', actor: 'Sendayan 2' }, 'Another shift is still active.');
  command('other-day', 'mode', 'confirmed', '2026-11-26T03:00:00.000Z', { mode: 'REST', actor: 'x' });
  event('e-old', 'hourly.finalized', '2026-08-03T16:41:05+08:00', '20260803-Day-SDY2', { hour_slot: '16.00-17.00' });
  return { db, history };
}

test('one production date runs from 06:00 to 10:00 the next morning, Malaysia time', () => {
  assert.deepEqual(dayWindow('2026-11-24'), { from: Date.parse('2026-11-24T06:00:00+08:00'), to: Date.parse('2026-11-25T10:00:00+08:00') });
  assert.equal(dayWindow('24/11/2026'), null);
});

test('the timeline shows the night in plain words: OT, the break, why the shift ended and what the Pi refused', () => {
  const { history } = seed();
  const { items, shifts } = history.timeline('SDY2', '2026-11-24');
  assert.deepEqual(items.map(item => item.title), ['Shift form: Night · 2026-11-24', 'Mode: Rest', 'Shift ended on the Pi', 'Shift form: Night · 2026-11-25']);
  assert.equal(items[0].detail, 'WITH OT · 20:00 – 08:00'); assert.equal(items[0].status, 'Accepted'); assert.equal(items[0].actor, 'Sendayan 2');
  assert.match(items[2].detail, /^By an end-shift message on the Pi \(Node-RED or manual\), not by the Checksheet · Output 161$/);
  assert.equal(items[3].status, 'Refused'); assert.equal(items[3].refused, true); assert.equal(items[3].note, 'Another shift is still active.'); assert.equal(items[3].detail, 'NO OT · 16:15 – 00:30');
  assert.deepEqual(shifts, ['20261124-Night-SDY2', '20261125-Night-SDY2']);
  assert.equal(history.timeline('SDY1', '2026-11-24').items.length, 0, 'each line sees only its own records');
  assert.throws(() => history.timeline('SDY2', 'yesterday'), /valid date/);
});

test('only supervisors and managers open the history, for their selected line', () => {
  const { history } = seed();
  const call = role => { const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } }; history.route({ user: { role }, line: 'SDY2', query: { date: '2026-11-24' } }, res); return res; };
  assert.equal(call('operator').code, 403); assert.equal(call('display').code, 403);
  for (const role of ['management', 'executive', 'developer']) assert.equal(call(role).body.items.length, 4);
});

test('a manual line writes its own history: shift form, model and mode', () => {
  const db = openStore(':memory:'), history = createShiftHistory({ db });
  const workspace = createManualWorkspace({ db, line: 'LM', history });
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(new Date());
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kuala_Lumpur', hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
  const shift = { date: today, shift: hour >= 8 && hour < 16 ? 'Day' : 'Night', overtime: true, supervisor: 'S', leader: 'L', forming: ['A'], waterjet: ['B'], assembly: ['C'], quality: 'Q' };
  if (hour < 8) shift.date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(new Date(Date.now() - 86400000));
  workspace.action('shift', shift, 'Leader A');
  workspace.action('setup', { model: 'D27A', lot: 'L1', plan: 60, cycle: 1 }, 'Leader A');
  workspace.action('mode', { mode: 'REST' }, 'Leader A');
  const rows = db.prepare('SELECT title, detail, actor FROM shift_log WHERE line=? ORDER BY rowid').all('LM').map(row => ({ ...row }));
  assert.deepEqual(rows.map(row => row.title), [`Shift form: ${shift.shift} · ${shift.date}`, 'Model set: D27A', 'Mode: Rest']);
  assert.match(rows[0].detail, /^WITH OT · /); assert.equal(rows[1].detail, 'Lot L1 · Target 60/h'); assert.equal(rows[2].actor, 'Leader A');
});
