import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { openStore } from '../server/store.js';
import { createManualWorkspace } from '../server/manualWorkspace.js';
import { createLiveWorkspace } from '../server/liveWorkspace.js';

const team = { supervisor: 'S', leader: 'L', forming: ['F'], waterjet: ['W'], assembly: ['A'], quality: 'Q', overtime: true };
const waiting = { status: 'WAITING', issue: '', action: '', count: 0 };

test('a new manual shift starts with a clean 4M board; the old problems stay in the previous report', t => {
  t.mock.method(Date, 'now', () => Date.parse('2026-10-30T02:00:00Z'));
  const db = openStore(':memory:'); t.after(() => db.close());
  const w = createManualWorkspace({ db, line: 'ABB3' });
  w.action('shift', { ...team, date: '2026-10-30', shift: 'Day' }, 'Operator');
  w.action('henkaten', { category: 'machine', status: 'NG', issue: 'Nozzle leak', action: 'Called maintenance' }, 'Operator');
  w.action('henkaten', { category: 'material', status: 'OK', action: 'Checked' }, 'Operator');
  const first = w.snapshot().shift.id;
  t.mock.method(Date, 'now', () => Date.parse('2026-10-30T13:00:00Z'));
  w.action('shift', { ...team, date: '2026-10-30', shift: 'Night' }, 'Operator');
  const after = w.snapshot();
  assert.notEqual(after.shift.id, first);
  for (const key of ['machine', 'material', 'method']) assert.deepEqual(after.henkaten[key], waiting);
  assert.equal(after.henkaten.man.status, 'NG');
  assert.deepEqual(after.issues.map(i => i.category), ['man']);
  const report = JSON.parse(db.prepare('SELECT snapshot FROM reports WHERE shift_id=?').get(first).snapshot);
  assert.ok(report.issues.some(i => i.issue === 'Nozzle leak' && i.status === 'pending'));
});

test('editing the running shift keeps the 4M board', t => {
  t.mock.method(Date, 'now', () => Date.parse('2026-10-30T02:00:00Z'));
  const db = openStore(':memory:'); t.after(() => db.close());
  const w = createManualWorkspace({ db, line: 'ABB3' });
  w.action('shift', { ...team, date: '2026-10-30', shift: 'Day' }, 'Operator');
  w.action('henkaten', { category: 'machine', status: 'NG', issue: 'Nozzle leak', action: 'Called maintenance' }, 'Operator');
  const s = w.snapshot().shift;
  w.action('shift-edit', { ...s, supervisor: 'New S', expectedShiftId: s.id, expectedVersion: 0 }, 'Operator');
  assert.equal(w.snapshot().henkaten.machine.status, 'NG');
  assert.ok(w.snapshot().issues.some(i => i.issue === 'Nozzle leak'));
});

test('a new shift from the Pi resets the live 4M board', t => {
  const db = openStore(':memory:'); t.after(() => db.close());
  const broker = new EventEmitter(); Object.assign(broker, { connected: true, subscribe() {}, publish(a, b, c, cb) { cb?.(); }, end() {} });
  const w = createLiveWorkspace({ db, config: { line: 'SDY1', models: [], people: null, mqttUrl: 'mqtt://pi', requireLineCode: true, productionLine: 'SendayanLine1' }, mqttConnect: () => broker });
  t.after(() => w.close());
  broker.emit('connect');
  const send = shift_id => broker.emit('message', 'smartchecksheet/live', Buffer.from(JSON.stringify({ line_code: 'SDY1', server_ms: Date.now(), shift_id, date: '2026-11-23', shift: 'Day', model: '-', current_mode: 'NORMAL', machine_status: 0, hour_slot: '8.00-9.00' })), {});
  send('20261123-Day-SendayanLine1');
  w.action('henkaten', { category: 'method', status: 'NG', issue: 'New SOP', action: 'Briefed' }, 'Operator');
  assert.equal(w.snapshot().henkaten.method.status, 'NG');
  send('20261123-Night-SendayanLine1');
  const after = w.snapshot();
  assert.deepEqual(after.henkaten.method, waiting);
  assert.deepEqual(after.issues.map(i => i.category), ['man']);
});
