import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../server/store.js';
import { createManualWorkspace } from '../server/manualWorkspace.js';
import { prsLines, prsTotals, prsPages, prsModelTotals } from '../src/prsLines.js';

const team = { date: '2026-10-30', shift: 'Day', overtime: true, supervisor: 'Supervisor', leader: 'Leader', forming: ['F'], waterjet: ['W'], assembly: ['A'], quality: 'Q' };
test('SPV signs an hour once, without remarks, separately from the shift verification', t => {
  t.mock.method(Date, 'now', () => Date.parse('2026-10-30T02:00:00Z'));
  const db = openStore(':memory:'); t.after(() => db.close());
  const w = createManualWorkspace({ db, line: 'ABB3' }); w.action('shift', team, 'Operator');
  w.action('verify', { hour: '9.00-10.00' }, 'Aminah');
  const [sign] = w.snapshot().verification;
  assert.equal(sign.hour, '9.00-10.00'); assert.equal(sign.status, 'verified'); assert.equal(sign.remarks, ''); assert.equal(sign.actor, 'Aminah');
  assert.throws(() => w.action('verify', { hour: '9.00-10.00' }, 'Other'), /already signed/);
  w.action('verify', { status: 'verified' }, 'Aminah');
  assert.equal(w.snapshot().verification.filter(v => !v.hour).length, 1);
});
test('PRS lines put downtime on the last segment of its hour, sign each hour once and page with the live hour last', () => {
  const id = 'S';
  const state = { shift: { id }, downtime: [{ id: 'd', shiftId: id, slot: '9.00-10.00', category: 'Schedule', reason: 'Y1 - Model Change', duration: 30 }, { id: 'x', shiftId: 'old', slot: '9.00-10.00', category: 'Machine', duration: 99 }],
    verification: [{ id: 'v', shiftId: id, hour: '9.00-10.00', actor: 'Aminah' }, { id: 'w', shiftId: id, actor: 'Shift check' }] };
  const rows = [{ id: 'live', slot: '10.00-11.00', live: true, plan: 40, actual: 4 }, { id: 'a', slot: '9.00-10.00', plan: 20, actual: 20 }, { id: 'b', slot: '9.00-10.00', plan: 10, actual: 7 }, { id: 'n', slot: '0.00-1.00', plan: 5, actual: 5 }, { id: 'e', slot: '20.00-21.00', plan: 5, actual: 5 }];
  const lines = prsLines(state, rows);
  assert.deepEqual(lines.map(l => [l.id, l.no, l.downtime.length, l.signed?.actor || null]), [['a', 1, 0, 'Aminah'], ['b', 1, 1, 'Aminah'], ['live', 2, 0, null], ['e', 3, 0, null], ['n', 4, 0, null]]);
  const totals = prsTotals(lines);
  assert.deepEqual([totals.plan, totals.actual, totals.minutes.Schedule, totals.minutes.Machine, totals.signed, totals.hours], [80, 41, 30, 0, 1, 4]);
  assert.deepEqual(prsModelTotals([{ model: 'A', lot: '1', plan: 10, actual: 8 }, { model: 'B', lot: '2', plan: 5, actual: 6 }, { model: 'A', lot: '3', plan: 10, actual: 12 }, { model: 'A', lot: '1', plan: 1, actual: 1 }, { slot: 'x', empty: true }]),
    [{ model: 'A', plan: 21, actual: 21, lots: ['1', '3'] }, { model: 'B', plan: 5, actual: 6, lots: ['2'] }]);
  const pages = prsPages([{ id: 1, slot: 'a' }, { id: 2, slot: 'b' }, { id: 3, slot: 'c' }, { id: 'L', slot: 'd', live: true }], 3);
  assert.deepEqual(pages.map(page => page.map(line => line.id)), [[2, 3, 'L'], [1, 'L']]);
});
