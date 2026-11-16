import test from 'node:test';
import assert from 'node:assert/strict';
import { oeeFromLive, timersFromLive, machineStatusNames } from '../shared/oee.js';

// A mid-shift payload: 4 h on the clock, 30 min rest, 10 min model change, 20 min down, 2.5 min/pc standard.
const payload = { total_machine_time: 14400, total_rest_time: 1800, planned_stop_time: 0, model_change_time: 600, downtime: 1200, real_operating_time: 10800, standard_cycle_time: 2.5, product_count: 60, total_reject: 3, hourly_plan: 24, hourly_output: 18 };

test('matches the Node-RED oee calculator', () => {
  const k = oeeFromLive(payload);
  // planned = 14400 - 1800 - 0 - 600 = 12000; A = (12000 - 1200) / 12000 = 0.9
  assert.equal(k.availability, 0.9);
  // real time pcs = 10800 / 60 / 2.5 = 72; P = 60 / 72
  assert.equal(k.realTimePcs, 72);
  assert.equal(k.performance, 0.8333);
  // Q = (60 - 3) / 60
  assert.equal(k.quality, 0.95);
  assert.equal(k.oee, Math.round(0.9 * (60 / 72) * 0.95 * 10000) / 10000);
  assert.equal(k.shortPcs, -12);
  assert.equal(k.progress, 2.5, 'Grafana progress: product count 60 over the target 24, not clamped');
});

test('zero divisors give 0 and ratios stay within 0..1', () => {
  assert.deepEqual(oeeFromLive({}), { availability: 0, performance: 0, quality: 0, oee: 0, realTimePcs: 0, shortPcs: 0, progress: 0 });
  const ahead = oeeFromLive({ ...payload, product_count: 100, downtime: 99999 });
  assert.equal(ahead.performance, 1, 'more than the real-time target is capped at 100%');
  assert.equal(ahead.availability, 0, 'more downtime than planned time is 0%, not negative');
  assert.equal(oeeFromLive({ ...payload, total_reject: 80 }).quality, 0);
  assert.equal(oeeFromLive({ ...payload, standard_cycle_time: 0 }).performance, 0);
});

test('non-numbers are treated as 0', () => {
  assert.equal(oeeFromLive({ ...payload, downtime: '1200', product_count: null }).availability, 1);
  assert.equal(timersFromLive({ run_time: 'x', delay_time: 5 }).run, 0);
  assert.equal(timersFromLive({ run_time: 'x', delay_time: 5 }).delay, 5);
});

test('status codes follow the Python order, including Fill shift', () => {
  assert.equal(machineStatusNames[0], 'Running');
  assert.equal(machineStatusNames[7], 'Fill shift');
});
