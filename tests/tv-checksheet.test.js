import test from 'node:test';
import assert from 'node:assert/strict';
import { tvChecksheet } from '../src/tvChecksheet.js';
import { shiftSchedule } from '../shared/shiftSchedule.js';

function fixture(shift = 'Day', overtime = false, date = '2026-11-13') {
  const id = `${date.replaceAll('-', '')}-${shift}-ABB3`;
  return {
    shift: { id, date, shift, overtime, status: 'active', ...shiftSchedule(date, shift, overtime) },
    setup: { model: 'Current model', lot: 'N' },
    live: { slot: '10.00-11.00', plan: 40, actual: 4, shiftActual: 31 },
    hourly: [{ id: 'current', shiftId: id, model: 'Current model', lot: 'N', slot: '9.00-10.00', plan: 40, actual: 27, restMinutes: 0 }],
    rejects: [{ shiftId: id, ng: 2, loft: 1, slab: 10, returnRoll: 5 }],
    downtime: [{ shiftId: id, duration: 6 }]
  };
}
const at = time => Date.parse(time);
const morning = at('2026-11-13T10:00:00+08:00');
const empty = { shift: null, setup: null, rows: [], output: 0, rejects: 0, downtime: 0, previous: false };

test('TV shows only the current shift rows and totals without changing saved records', () => {
  const state = fixture();
  state.hourly.unshift({ id: 'old', shiftId: 'old', actual: 999 });
  state.rejects.push({ shiftId: 'old', ng: 100, loft: 100 });
  state.downtime.push({ shiftId: 'old', duration: 999 });
  const saved = structuredClone(state), view = tvChecksheet(state, morning);
  assert.deepEqual(view.rows.map(row => row.id), ['current', 'live']);
  assert.equal(view.rows[1].live, true);
  assert.equal(view.setup.model, 'Current model');
  assert.equal(view.output, 31);
  assert.equal(view.rejects, 3);
  assert.equal(view.downtime, 6);
  assert.equal(view.previous, false);
  assert.deepEqual(state, saved);
});

test('missing, pending and NO PROD shifts hide unrelated production', () => {
  for (const shift of [null, { ...fixture().shift, status: 'pending' }, { ...fixture().shift, id: 'NO PROD' }]) {
    const state = { ...fixture(), shift, pendingShift: fixture('Night').shift };
    assert.deepEqual(tvChecksheet(state, morning), empty);
  }
});

test('only the latest saved shift from today or yesterday is shown as a previous shift', () => {
  for (const date of ['2026-11-12', '2026-11-13']) for (const status of ['active', 'ended']) {
    const state = fixture('Day', false, date);
    state.shift.status = status;
    state.pendingShift = fixture('Night').shift;
    state.hourly.push({ id: 'other-shift', shiftId: 'other-shift', actual: 999 });
    const view = tvChecksheet(state, at('2026-11-13T16:56:00+08:00'));
    assert.equal(view.shift.date, date);
    assert.equal(view.previous, true);
    assert.deepEqual(view.rows.map(row => row.id), ['current']);
    assert.equal(view.rows.some(row => row.live), false);
  }
});

test('shifts older than yesterday are hidden even if the saved status is still active', () => {
  for (const status of ['active', 'ended']) {
    const state = fixture('Day', false, '2026-11-11'); state.shift.status = status;
    assert.deepEqual(tvChecksheet(state, morning), empty);
  }
});

test('all four shifts use their working hours before switching to the previous shift fallback', () => {
  for (const shift of ['Day', 'Night']) for (const overtime of [false, true]) for (const legacy of [false, true]) {
    const state = fixture(shift, overtime), { startAt, endAt } = state.shift;
    if (legacy) { delete state.shift.startAt; delete state.shift.endAt; }
    assert.deepEqual(tvChecksheet(state, at(startAt) - 1), empty);
    assert.equal(tvChecksheet(state, at(startAt)).previous, false);
    assert.equal(tvChecksheet(state, at(endAt) - 1).previous, false);
    assert.equal(tvChecksheet(state, at(endAt)).previous, true);
  }
});

test('an overnight shift uses its production date and remains visible after midnight in Malaysia', () => {
  for (const overtime of [false, true]) {
    const state = fixture('Night', overtime, '2026-11-12');
    const view = tvChecksheet(state, at('2026-11-13T00:15:00+08:00'));
    assert.equal(view.output, 31);
    assert.equal(view.previous, false);
    assert.equal(tvChecksheet(state, morning).previous, true);
  }
});

test('confirmed schedule boundaries take precedence over the fallback schedule', () => {
  const state = fixture();
  state.shift.endAt = '2026-11-13T20:00:00+08:00';
  assert.equal(tvChecksheet(state, at('2026-11-13T18:00:00+08:00')).previous, false);
  assert.equal(tvChecksheet(state, at(state.shift.endAt)).previous, true);
});

test('the previous shift expires at Malaysia midnight once it is older than yesterday', () => {
  const state = fixture('Day', false, '2026-11-12');
  assert.equal(tvChecksheet(state, at('2026-11-13T23:59:59+08:00')).previous, true);
  assert.deepEqual(tvChecksheet(state, at('2026-11-14T00:00:00+08:00')), empty);
});

test('starting a new shift replaces the fallback and never mixes in old hourly rows', () => {
  const previous = fixture('Day', false, '2026-11-12'), current = fixture();
  assert.equal(tvChecksheet(previous, morning).previous, true);
  current.hourly.push(...previous.hourly);
  const view = tvChecksheet(current, morning);
  assert.equal(view.shift.id, current.shift.id);
  assert.equal(view.previous, false);
  assert.equal(view.rows.length, 2);
});

test('an empty current shift has no fabricated live hour or inherited rows', () => {
  const state = fixture();
  state.setup = null; state.live.shiftActual = 0;
  state.hourly = [{ id: 'old', shiftId: 'old', actual: 999 }]; state.rejects = []; state.downtime = [];
  const view = tvChecksheet(state, morning);
  assert.deepEqual(view.rows, []);
  assert.equal(view.setup, null);
  assert.equal(view.output, 0);
  assert.equal(view.rejects, 0);
  assert.equal(view.downtime, 0);
});

test('a configured current shift with zero output still shows its plan and live hour', () => {
  const state = fixture(); state.hourly = []; state.live.actual = 0; state.live.shiftActual = 0;
  const view = tvChecksheet(state, morning);
  assert.equal(view.rows.length, 1);
  assert.equal(view.rows[0].plan, 40);
  assert.equal(view.rows[0].actual, 0);
});

test('invalid shift dates, names and boundaries do not expose saved production', () => {
  for (const patch of [{ date: 'invalid' }, { shift: 'Unknown' }, { startAt: 'invalid' }, { endAt: 'invalid' }]) {
    const state = fixture(); Object.assign(state.shift, patch);
    assert.deepEqual(tvChecksheet(state, morning), empty);
  }
});
