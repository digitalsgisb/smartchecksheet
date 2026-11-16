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

test('live lines send one checksheet/shift_override command and follow Python to the new shift', async t => {
  const { EventEmitter } = await import('node:events'); const { createLiveWorkspace } = await import('../server/liveWorkspace.js');
  t.mock.method(Date, 'now', () => Date.parse('2026-11-16T02:00:00Z'));
  const db = openStore(':memory:'); t.after(() => db.close());
  class Broker extends EventEmitter { connected = true; sent = []; subscribe() {} publish(topic, payload, options, callback) { this.sent.push({ topic, payload: JSON.parse(payload) }); callback?.(); } end() {} message(topic, p) { this.emit('message', topic, Buffer.from(JSON.stringify(p)), {}); } }
  const broker = new Broker();
  const people = { supervisors: ['Supervisor', 'New supervisor'], leaders: ['Leader'], operators: ['F', 'W', 'A'], quality: ['Q'] };
  const w = createLiveWorkspace({ db, config: { line: 'ABB7', models: [], people, mqttUrl: 'mqtt://pi', requireLineCode: true, productionLine: 'MF' }, mqttConnect: () => broker });
  broker.emit('connect');
  const live = extra => ({ line_code: 'ABB7', server_ms: Date.now(), shift_id: '20261116-Day-MF', date: '2026-11-16', shift: 'Day', overtime: false, supervisor: 'Supervisor', leader: 'Leader', forming_operator: 'F', waterjet_operator: 'W', assembly_operator: 'A', quality_inspector: 'Q', model: '-', current_mode: 'NORMAL', machine_status: 0, total_product_count: 30, hour_slot: '10.00-11.00', ...extra });
  broker.message('smartchecksheet/live', live());
  assert.throws(() => w.action('restart-shift', { ...team, reason: '' }, 'Operator'), /Reason/);
  const result = w.action('restart-shift', { ...team, supervisor: 'New supervisor', reason: 'Wrong team', overridePassword: 'must-not-be-sent' }, 'Operator');
  assert.equal(result.pending, true);
  const sent = broker.sent.at(-1);
  assert.equal(sent.topic, 'checksheet/shift_override'); assert.equal(sent.payload.overrideReason, 'Wrong team'); assert.equal(sent.payload.overrideBy, 'Operator');
  assert.equal(sent.payload.productionLine, 'MF'); assert.equal(sent.payload.event_id, result.commandId); assert.equal(JSON.stringify(sent.payload).includes('must-not-be-sent'), false);
  assert.throws(() => w.action('restart-shift', { ...team, reason: 'Again' }, 'Operator'), /waiting for Python/);
  broker.message('abb7/shift_form_result', { status: 'ended', source_payload: {} });
  broker.message('abb7/shift_form_result', { status: 'active', source_payload: sent.payload, active_shift: { shift_id: '20261116-Day-MF-R2' } });
  const after = w.snapshot();
  assert.equal(after.shift.id, '20261116-Day-MF-R2'); assert.equal(after.shift.status, 'active'); assert.equal(after.shift.supervisor, 'New supervisor');
  assert.equal(after.commands.find(c => c.id === result.commandId).status, 'confirmed');
  assert.equal(after.reports.length, 1);
  w.close();
});
