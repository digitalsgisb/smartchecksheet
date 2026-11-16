import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../server/store.js';
import { createTvTimers } from '../server/tvTimers.js';
import { tvTimers, validateTvTimers, tvRotation } from '../shared/tvTimers.js';

const response = () => { const res = { statusCode: 200, body: null, status(code) { res.statusCode = code; return res; }, json(body) { res.body = body; return res; } }; return res; };

test('defaults, saved values and off switches decide the TV rotation', () => {
  assert.deepEqual(tvTimers(), { henkaten: 30, live: 60, oee: 60 });
  assert.deepEqual(tvTimers({ henkaten: 45, live: 'x', oee: 2 }), { henkaten: 45, live: 60, oee: 60 }, 'invalid saved values fall back');
  assert.deepEqual(tvRotation({ henkaten: 20, live: 0, oee: 90 }, true).map(p => [p.id, p.seconds]), [['henkaten', 20], ['oee', 90]]);
  assert.deepEqual(tvRotation({}, false).map(p => p.id), ['henkaten', 'live'], 'manual lines have no OEE panel');
});

test('timer input must be whole seconds in range, keeping a panel every line can show', () => {
  assert.deepEqual(validateTvTimers({ henkaten: 15, live: '120', oee: 0 }), { henkaten: 15, live: 120, oee: 0 });
  assert.throws(() => validateTvTimers({ henkaten: 3, live: 60, oee: 60 }), /4M Board: use whole seconds/);
  assert.throws(() => validateTvTimers({ henkaten: 30, live: 60.5, oee: 60 }), /Live Checksheet/);
  assert.throws(() => validateTvTimers({ henkaten: 30, live: 60, oee: 901 }), /OEE/);
  assert.throws(() => validateTvTimers({ henkaten: 0, live: 0, oee: 60 }), /Keep the 4M Board or the Live Checksheet on/);
  assert.throws(() => validateTvTimers(null), /Send a time/);
});

test('only a developer saves TV timers; the save is per line and pushed to open screens', t => {
  const db = openStore(':memory:'); t.after(() => db.close());
  const pushed = [];
  const timers = createTvTimers({ db, onChange: line => pushed.push(line) });
  const denied = response();
  timers.save({ user: { role: 'management', name: 'Manager' }, line: 'ABB3', body: { timers: { henkaten: 10, live: 10, oee: 10 } } }, denied);
  assert.equal(denied.statusCode, 403);
  const bad = response();
  timers.save({ user: { role: 'developer', name: 'Dev' }, line: 'ABB3', body: { timers: { henkaten: 1, live: 10, oee: 10 } } }, bad);
  assert.equal(bad.statusCode, 400);
  assert.deepEqual(pushed, []);
  const ok = response();
  timers.save({ user: { role: 'developer', name: 'Dev' }, line: 'ABB3', body: { timers: { henkaten: 20, live: 45, oee: 0 } } }, ok);
  assert.equal(ok.statusCode, 200);
  assert.deepEqual(pushed, ['ABB3']);
  assert.equal(timers.get('ABB3').oee, 0); assert.equal(timers.get('ABB3').updatedBy, 'Dev');
  assert.deepEqual([timers.get('ABB2').henkaten, timers.get('ABB2').updatedBy], [30, null], 'other lines keep their own times');
});
