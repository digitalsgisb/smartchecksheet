import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../server/store.js';
import { createManualWorkspace } from '../server/manualWorkspace.js';
import { segmentWindow, fixedPlan } from '../shared/hourlyPlan.js';

const my = text => Date.parse(`2026-11-24T${text}+08:00`);
const plan = (now, options, lost = 0, rate = 60) => fixedPlan(segmentWindow(now, options), lost, rate);

test('the hourly plan is fixed from the first minute and only planned time lowers it (same rule as the Pi)', () => {
  const shift = { shiftStart: my('08:00:00'), shiftEnd: my('20:00:00') };
  for (const at of ['10:00:01', '10:05:00', '10:59:59']) assert.equal(plan(my(at), shift), 60);
  assert.equal(plan(my('10:30:00'), shift, 15 * 60), 45, 'a 15-minute planned stop');
  assert.equal(plan(my('16:20:00'), { shiftStart: my('16:15:00'), shiftEnd: Date.parse('2026-11-25T00:30:00+08:00') }), 45, 'shift starts 16:15');
  assert.equal(plan(Date.parse('2026-11-25T00:10:00+08:00'), { shiftStart: my('16:15:00'), shiftEnd: Date.parse('2026-11-25T00:30:00+08:00') }), 30, 'shift ends 00:30');
  const closed = segmentWindow(my('10:20:00'), { ...shift, closing: true });
  assert.equal(fixedPlan(closed, 0, 60), 20, 'model change at 10:20 closes 20 minutes');
  assert.equal(plan(my('10:25:00'), { ...shift, segmentStart: closed.end }), 40);
  assert.equal(plan(my('11:00:01'), { ...shift, segmentStart: closed.end, standard: true }), 40);
  assert.equal(plan(my('11:30:00'), { ...shift, segmentStart: my('09:40:00') }), 60, 'a stale segment start never spans two hours');
  assert.equal(plan(my('10:05:00'), shift, 0, 0), 0);
});

test('a manual line shows the fixed plan, ignores machine downtime, lowers it for a planned stop and splits a model change', t => {
  t.mock.timers.enable({ apis: ['Date'], now: my('10:05:00') });
  const db = openStore(':memory:'), line = createManualWorkspace({ db, line: 'LM' });
  line.action('shift', { date: '2026-11-24', shift: 'Day', overtime: true, supervisor: 'S', leader: 'L', forming: ['A'], waterjet: ['B'], assembly: ['C'], quality: 'Q' }, 'Leader');
  line.action('setup', { model: 'D27A', lot: 'L1', plan: 60, cycle: 1 }, 'Leader');
  assert.equal(line.snapshot().live.plan, 60);
  const log = (category, duration) => line.action('timer', { action: 'log', revision: line.snapshot().timer.revision, category, reason: 'Test', actionTaken: 'Done', duration, targetMinutes: 0 }, 'Leader');
  log('Machine', 10); line.tick();
  assert.equal(line.snapshot().live.plan, 60, 'machine downtime does not lower the plan');
  log('Planned Stop', 15); line.tick();
  assert.equal(line.snapshot().live.plan, 45);
  t.mock.timers.setTime(my('10:20:00'));
  for (let i = 0; i < 12; i++) line.action('adjust', { adjust: 1, reason: 'count' }, 'Leader');
  line.action('setup', { model: 'D74A', lot: 'L9', plan: 30, cycle: 2 }, 'Leader');
  let state = line.snapshot();
  assert.deepEqual(state.hourly.map(r => [r.model, r.slot, r.plan, r.actual]), [['D27A', '10.00-11.00', 5, 12]], '20 minutes less the 15-minute planned stop');
  assert.equal(state.live.plan, 20, 'D74A runs 10:20-11:00 at 30 per hour');
  t.mock.timers.setTime(my('11:00:01')); line.tick();
  state = line.snapshot();
  assert.deepEqual(state.hourly.at(-1).model, 'D74A'); assert.equal(state.hourly.at(-1).plan, 20);
  assert.equal(state.live.plan, 30, 'the next hour starts with its full plan');
  t.mock.timers.setTime(my('11:10:00')); line.action('mode', { mode: 'REST' }, 'Leader');
  t.mock.timers.setTime(my('11:30:00')); line.action('mode', { mode: 'NORMAL' }, 'Leader'); line.tick();
  assert.equal(line.snapshot().live.plan, 20, 'a 20-minute rest comes off the plan');
});
