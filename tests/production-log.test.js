import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../server/store.js';
import { createProductionLog, findGaps, hourBuckets } from '../server/productionLog.js';

const at = hm => Date.parse(`2026-11-25T${hm}+08:00`);
function setup() {
  let clock = at('08:00:00');
  const db = openStore(':memory:'), log = createProductionLog({ db, now: () => clock });
  // One telemetry message per second from..to (hh:mm:ss), with the counter going up at the given times.
  const run = (from, to, pieces, start = 0, extra = {}) => { let total = start; for (let t = at(from); t <= at(to); t += 1000) { clock = t; if (pieces.some(p => at(p) === t)) total++; log.observe('ABB7', '20261125-Day-MF', { output: total, ...extra }, { date: '2026-11-25', shift: 'Day', cycle: 0.5 }); } return total; };
  return { db, log, run, set: t => { clock = t; } };
}

test('each piece gets the second it came out, and a long stop with telemetry is a gap', () => {
  const { log, run } = setup();
  run('08:00:00', '08:10:00', ['08:01:00', '08:02:00', '08:09:30']);
  const result = log.shiftLog('ABB7', '20261125-Day-MF');
  assert.deepEqual(result.counters.output.ticks.map(t => [t.at, t.qty, t.total]), [[at('08:01:00'), 1, 1], [at('08:02:00'), 1, 2], [at('08:09:30'), 1, 3]]);
  // Cycle 0.5 min x 3 = 90 s: 08:00→08:01 is 60 s (fine), 08:02→08:09:30 is 450 s (gap).
  assert.deepEqual(result.gaps.map(g => [g.from, g.to, g.seconds, g.limitSeconds, g.until]), [[at('08:02:00'), at('08:09:30'), 450, 90, 'piece']]);
  assert.deepEqual(log.shifts('ABB7', '2026-11-25').map(s => s.id), ['20261125-Day-MF']);
  assert.deepEqual(log.shifts('ABB7', '2026-11-24'), []);
});

test('time when the server received nothing is "no data", never a gap, and pieces counted meanwhile are catch-up', () => {
  const { log, run } = setup();
  const total = run('08:00:00', '08:02:00', ['08:01:00']);
  // Server down 08:02 → 08:30; the Pi counted 4 pieces meanwhile.
  run('08:30:00', '08:31:00', ['08:30:40'], total + 4);
  const result = log.shiftLog('ABB7', '20261125-Day-MF');
  assert.equal(result.coverage.length, 2);
  const catchup = result.counters.output.ticks.find(t => t.catchup);
  assert.deepEqual([catchup.at, catchup.qty, catchup.total], [at('08:30:00'), 4, 5]);
  assert.equal(result.gaps.length, 0, 'neither the outage nor the catch-up jump is a gap');
});

test('a server restart mid-shift picks up the saved total instead of counting the shift again', () => {
  const { db, run } = setup();
  run('08:00:00', '08:01:00', ['08:00:30']);
  let clock = at('08:05:00');
  const restarted = createProductionLog({ db, now: () => clock });
  restarted.observe('ABB7', '20261125-Day-MF', { output: 1 }, {});
  clock += 1000; restarted.observe('ABB7', '20261125-Day-MF', { output: 2 }, {});
  assert.deepEqual(restarted.shiftLog('ABB7', '20261125-Day-MF').counters.output.ticks.map(t => [t.qty, t.total, t.catchup]), [[1, 1, false], [1, 2, false]]);
});

test('Sendayan counters are logged separately; a counter that never moves is left out', () => {
  const { log, set } = setup();
  for (const [i, f, w] of [[0, 0, 0], [1, 1, 0], [2, 1, 1], [3, 2, 1]]) { set(at('08:00:00') + i * 1000); log.observe('SDY1', 's1', { output: 0, forming: f, waterjet: w }, { date: '2026-11-25' }); }
  const result = log.shiftLog('SDY1', 's1');
  assert.deepEqual(Object.keys(result.counters), ['forming', 'waterjet']);
  assert.equal(result.counters.forming.total, 2);
  assert.match(log.csv(result), /^Time,Counter,Pieces,Running total,Note\r\n2026-11-25 08:00:01,Forming,1,1,\r\n/);
});

test('a count corrected down is kept as a negative entry and does not end a gap', () => {
  const gaps = findGaps([{ at: 0, qty: 1 }, { at: 200000, qty: -1 }, { at: 600000, qty: 1 }], [{ from: 0, to: 600000 }], { cycle: 0 });
  assert.deepEqual(gaps.map(g => g.seconds), [600]);
});

test('with no cycle time the gap limit is 5 minutes; the running end of a live shift is "now"', () => {
  const gaps = findGaps([{ at: 0, qty: 1 }], [{ from: 0, to: 400000 }], { until: 400000 });
  assert.deepEqual(gaps.map(g => [g.seconds, g.limitSeconds, g.until]), [[400, 300, 'now']]);
});

test('only executives and managers open the log; manual lines say there is no sensor', () => {
  const { log, run } = setup();
  run('08:00:00', '08:00:05', ['08:00:02']);
  const routes = log.routes(line => line === 'LM');
  const call = (handler, role, line, query) => { const res = { code: 200, headers: {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, setHeader(k, v) { this.headers[k] = v; }, send(b) { this.body = b; } }; handler({ user: { role }, line, query }, res); return res; };
  for (const role of ['operator', 'display']) assert.equal(call(routes.log, role, 'ABB7', { shift: '20261125-Day-MF' }).code, 403);
  for (const role of ['management', 'executive', 'developer']) assert.equal(call(routes.log, role, 'ABB7', { shift: '20261125-Day-MF' }).body.counters.output.total, 1);
  assert.equal(call(routes.shifts, 'executive', 'LM', { date: '2026-11-25' }).body.manual, true);
  assert.equal(call(routes.log, 'executive', 'SDY1', { shift: '20261125-Day-MF' }).code, 404, 'another line cannot read this shift');
  assert.match(call(routes.csv, 'management', 'ABB7', { shift: '20261125-Day-MF' }).headers['Content-Disposition'], /production-log-20261125-Day-MF\.csv/);
});

test('piece times older than one year are deleted', () => {
  const { db, log, run, set } = setup();
  run('08:00:00', '08:00:03', ['08:00:01']);
  set(at('08:00:00') + 366 * 86400000); log.purge();
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM production_ticks').get().n, 0);
  assert.equal(log.shiftLog('ABB7', '20261125-Day-MF'), null);
});

test('hourly buckets follow the clock, count timed pieces only and match the Pi slot for plan, downtime and rejects', () => {
  const t = hm => Date.parse(`2026-11-25T${hm}+08:00`);
  const log = { live: false, shift: { startAt: new Date(t('08:00:00')).toISOString(), plan: 60 },
    coverage: [{ from: t('08:00:00'), to: t('09:30:00') }, { from: t('10:10:00'), to: t('10:15:00') }],
    counters: { output: { ticks: [{ at: t('08:00:05'), qty: 40, total: 40, catchup: true }, { at: t('08:10:00'), qty: 1, total: 41 }, { at: t('08:59:59'), qty: 1, total: 42 }, { at: t('09:00:00'), qty: 1, total: 43 }, { at: t('09:20:00'), qty: -1, total: 42 }, { at: t('10:15:00'), qty: 1, total: 43 }] } } };
  const records = { hourly: [{ slot: '8.00-9.00', plan: 30, actual: 20 }, { slot: '8.00-9.00', plan: 25, actual: 10 }],
    downtime: [{ id: 'd1', createdAt: new Date(t('09:05:00')).toISOString(), slot: '8.00-9.00', category: 'Machine', reason: 'Belt', duration: 12, action: 'Fixed' }],
    rejects: [{ id: 'r1', createdAt: new Date(t('09:10:00')).toISOString(), slot: '9.00-10.00', code: 'N1', ng: 2, slab: 1 }] };
  const { hours, downtime, rejects, catchup } = hourBuckets(log, records, t('11:00:00'));
  assert.deepEqual(hours.map(h => [h.hour, h.counts.output, h.plan, h.piActual, h.noData, h.partData, h.downtimeMinutes, h.rejectCount]),
    [[8, 2, 55, 30, false, false, 12, 0], [9, 0, null, null, false, true, 0, 3], [10, 1, null, null, false, true, 0, 0]]);
  assert.deepEqual([hours[2].from, hours[2].to], [t('10:00:00'), t('10:15:00')], 'the last hour ends where the data ends');
  assert.deepEqual(catchup, { output: 40 }, 'pieces counted during an outage belong to no hour');
  assert.deepEqual([downtime[0].hour, rejects[0].total], [8, 3], 'downtime goes to the slot the Pi stamped, not the time it was logged');
});

test('the running hour shows the full-hour target and an hour with no data is marked', () => {
  const t = hm => Date.parse(`2026-11-25T${hm}+08:00`);
  // SDY1 sends the whole-shift plan (201) as hourly_plan; the target comes from the 2-minute cycle instead: 30 pcs/h.
  const log = { live: true, shift: { startAt: new Date(t('08:00:00')).toISOString(), plan: 201, cycle: 2 }, coverage: [{ from: t('09:00:00'), to: t('09:20:00') }], counters: { output: { ticks: [{ at: t('09:10:00'), qty: 1, total: 1 }] } } };
  const { hours } = hourBuckets(log, {}, t('09:20:00'));
  assert.deepEqual(hours.map(h => [h.hour, h.noData, h.inProgress, h.target]), [[8, true, false, null], [9, false, true, 30]]);
  assert.equal(hourBuckets({ ...log, shift: { ...log.shift, cycle: null } }, {}, t('09:20:00')).hours[1].target, null, 'no cycle time, no plan line for the running hour');
});

test('planned stops seen in the live mode are kept per hour so the plan stays flat through them; DOWN is not one', () => {
  const { log, set } = setup();
  const send = (from, to, mode) => { for (let t = at(from); t <= at(to); t += 1000) { set(t); log.observe('ABB7', '20261125-Day-MF', { output: 0 }, { date: '2026-11-25', shift: 'Day', cycle: 2, mode }); } };
  send('08:00:00', '08:10:00', 'NORMAL'); send('08:10:01', '08:20:00', 'PLANNED STOP'); send('08:20:01', '08:25:00', 'DOWN'); send('08:25:01', '08:30:00', 'REST'); send('08:30:01', '08:31:00', 'NORMAL');
  const result = log.shiftLog('ABB7', '20261125-Day-MF', {});
  assert.deepEqual(result.planned.map(p => [p.mode, p.from, p.to]), [['PLANNED STOP', at('08:10:01'), at('08:20:00')], ['REST', at('08:25:01'), at('08:30:00')]]);
  assert.deepEqual(result.hours[0].planned, [[at('08:10:01'), at('08:20:00')], [at('08:25:01'), at('08:30:00')]]);
});
