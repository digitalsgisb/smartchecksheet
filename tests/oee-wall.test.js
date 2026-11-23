import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../server/store.js';
import { createExecutiveWorkspace } from '../server/executive.js';

const lines = ['ABB2', 'ABB7', 'SDY1', 'SDY2'];
const states = {
  ABB2: { mode: 'live', machineConnected: true, shift: { status: 'active', shift: 'Day', overtime: true, date: '2026-11-23' }, setup: { model: '0244 AT' }, live: { status: 'Running', statusCode: 0, shiftActual: 420, totalReject: 3, hourTarget: 60, timers: { run: 3600, downtime: 300 }, oee: { oee: 0.8123, availability: 0.9, performance: 0.95, quality: 0.99, progress: 0.5 } } },
  ABB7: { mode: 'live', machineConnected: false, shift: { status: 'active', shift: 'Day', date: '2026-11-23' }, live: { oee: { oee: 0.5 } } },
  SDY1: { mode: 'live', machineConnected: true, shift: null, live: { oee: { oee: 0.7 } } },
  SDY2: { mode: 'manual', shift: { status: 'ended' }, live: {} }
};
function setup(t) {
  const db = openStore(':memory:'); t.after(() => db.close());
  const insert = db.prepare('INSERT INTO production_line_groups(line, group_id) VALUES(?,?)');
  for (const line of ['ABB2', 'ABB7']) insert.run(line, 'conversion-port-klang');
  for (const line of ['SDY1', 'SDY2']) insert.run(line, 'conversion-sendayan');
  const workspace = createExecutiveWorkspace({ db, lines: () => lines, attendance: { groups: [] }, snapshot: line => states[line] });
  return async user => { let status = 200, body; await workspace.wall({ user }, { status(code) { status = code; return this; }, json(data) { body = data; } }); return { status, body }; };
}

test('OEE wall is for executives, management and developers only', async t => {
  const wall = setup(t);
  for (const role of ['operator', 'display']) assert.equal((await wall({ role, lines })).status, 403);
  for (const role of ['management', 'developer']) assert.deepEqual((await wall({ role, lines })).body.lines.map(l => l.line), lines);
});

test('an executive sees only their own plant, with plant names and running state', async t => {
  const wall = setup(t);
  const { body } = await wall({ role: 'executive', lines, executiveGroup: 'conversion-port-klang' });
  assert.deepEqual(body.lines.map(l => [l.line, l.plant, l.running]), [['ABB2', 'Port Klang', true], ['ABB7', 'Port Klang', true]]);
  const abb2 = body.lines[0];
  assert.equal(abb2.oee, 81.2); assert.equal(abb2.output, 420); assert.equal(abb2.model, '0244 AT'); assert.deepEqual(abb2.shift, { shift: 'Day', overtime: true, date: '2026-11-23' });
  assert.equal(abb2.runTime, 3600); assert.equal(abb2.downTime, 300);
  assert.equal(body.lines[1].oee, 0, 'disconnected lines never show stale OEE');
});

test('lines without an active shift are listed as not running', async t => {
  const wall = setup(t);
  const { body } = await wall({ role: 'developer', lines });
  assert.deepEqual(body.lines.filter(l => !l.running).map(l => l.line), ['SDY1', 'SDY2']);
  assert.equal(body.lines.find(l => l.line === 'SDY2').machine, false);
});
