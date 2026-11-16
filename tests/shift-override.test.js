import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../server/store.js';
import { createManualWorkspace } from '../server/manualWorkspace.js';
import { createShiftOverride } from '../server/shiftOverride.js';
const team = { date: '2026-11-16', shift: 'Day', overtime: false, supervisor: 'Supervisor', leader: 'Leader', forming: ['F'], waterjet: ['W'], assembly: ['A'], quality: 'Q' };
// 10:00 Malaysia time on a Day shift.
function fixture(t, at = '2026-11-16T02:00:00Z') { t.mock.method(Date, 'now', () => Date.parse(at)); const db = openStore(':memory:'); t.after(() => db.close()); return { db, w: createManualWorkspace({ db, line: 'ABB3' }) }; }

test('override ends the active shift with a report and starts a new shift at once', t => {
  const { db, w } = fixture(t);
  w.action('shift', team, 'Operator'); w.action('setup', { model: 'M', lot: 'L', plan: 60, cycle: 1 }, 'Operator'); w.action('adjust', { adjust: 1, reason: 'Count' }, 'Operator');
  const result = w.action('restart-shift', { ...team, supervisor: 'New supervisor', reason: 'Wrong team at start' }, 'Operator');
  const after = w.snapshot();
  assert.ok(result.endedReportId);
  assert.equal(JSON.parse(db.prepare('SELECT snapshot FROM reports WHERE id=?').get(result.endedReportId).snapshot).shift.id, '20261116-Day-ABB3');
  assert.equal(after.shift.status, 'active'); assert.equal(after.shift.id, '20261116-Day-ABB3-R2'); assert.equal(after.shift.supervisor, 'New supervisor');
  assert.equal(after.shift.override.reason, 'Wrong team at start'); assert.equal(after.shift.reason, undefined);
  assert.equal(after.setup, null); assert.equal(after.live.shiftActual, 0);
  assert.match(after.audit[0].label, /Shift override: ended early.*Wrong team at start/);
  assert.equal(after.audit[0].changes.before.id, '20261116-Day-ABB3');
  w.action('restart-shift', { ...team, reason: 'Again' }, 'Operator');
  assert.equal(w.snapshot().shift.id, '20261116-Day-ABB3-R3');
});

test('override can start a shift before its usual start time', t => {
  const { w } = fixture(t, '2026-11-16T06:00:00Z'); // 14:00, Night NO OT normally starts at 16:15
  w.action('shift', team, 'Operator');
  w.action('restart-shift', { ...team, shift: 'Night', reason: 'Early change' }, 'Operator');
  const s = w.snapshot().shift;
  assert.equal(s.shift, 'Night'); assert.equal(s.status, 'active'); assert.equal(s.startAt, '2026-11-16T06:00:00.000Z');
});

test('override needs a reason, an idle timer and a shift that has not ended', t => {
  const { w } = fixture(t);
  w.action('shift', team, 'Operator');
  assert.throws(() => w.action('restart-shift', { ...team, reason: '' }, 'Operator'), /Reason/);
  assert.throws(() => w.action('restart-shift', { ...team, date: '2026-11-15', reason: 'x' }, 'Operator'), /already ended/);
  w.action('timer', { action: 'start', revision: w.snapshot().timer.revision, category: 'Machine', reason: 'Repair', targetMinutes: 0 }, 'Operator');
  assert.throws(() => w.action('restart-shift', { ...team, reason: 'x' }, 'Operator'), /downtime timer/);
  assert.equal(w.snapshot().shift.id, '20261116-Day-ABB3');
});

test('override password is checked, limited per line and off when unset', () => {
  let now = 0; const o = createShiftOverride({ password: 'secret-pass', now: () => now });
  assert.doesNotThrow(() => o.check('ABB3', 'secret-pass'));
  for (let i = 0; i < 5; i++) assert.throws(() => o.check('ABB3', 'wrong'), /Wrong override password/);
  assert.throws(() => o.check('ABB3', 'secret-pass'), /Too many/);
  assert.doesNotThrow(() => o.check('ABB2', 'secret-pass'));
  now += 15 * 60000; assert.doesNotThrow(() => o.check('ABB3', 'secret-pass'));
  assert.throws(() => o.check('ABB3', undefined), /Wrong/);
  assert.throws(() => createShiftOverride({ password: '' }).check('ABB3', 'x'), /not set up/);
});
