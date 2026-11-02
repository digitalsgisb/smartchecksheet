import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../server/store.js';
import { createShiftBoard } from '../server/shiftBoard.js';
import { shiftSchedule } from '../server/domain.js';

const token = 'test-shift-feed-token-at-least-32-characters';
function fixture(t, mode = 'attendance') {
  const db = openStore(':memory:'); t.after(() => db.close());
  db.prepare('INSERT INTO production_line_groups VALUES(?,?)').run('ABB2', 'conversion-port-klang');
  let clock = Date.parse('2026-11-02T04:00:00Z');
  const p = { id: '20261102-Day-ABB2', date: '2026-11-02', shift: 'Day', overtime: false, status: 'active', ...shiftSchedule('2026-11-02', 'Day', false) };
  const state = { shift: p };
  const people = [{ id: 'pk', name: 'Same Name', department: 'PRODUCTION', line: 'FC', checksheet_group: 'fc1', base: 'PORT KLANG', active: 1, status: 'IN' },
    { id: 'sy', name: 'Same Name', department: 'PRODUCTION', line: 'FC', checksheet_group: 'fc1', base: 'SENDAYAN', active: 1, status: 'IN' }];
  const board = createShiftBoard({ db, mode, token, now: () => clock, lines: () => ['ABB2'], snapshot: () => state, attendance: { url: 'http://attendance', token: 'private', groups: [{ id: 'fc1', label: 'FC1', lines: ['FC'], assignment: 'fc1', accountLines: ['ABB2'] }] }, fetcher: async () => ({ ok: true, json: async () => ({ connection_scope: 'integration', employees: people }) }) });
  const response = () => ({ code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
  const feed = (auth = token) => { const res = response(); board.feed({ headers: { authorization: `Bearer ${auth}` } }, res); return res; };
  const select = (grace = 30) => board.prepare('ABB2', { ...p, attendanceEmployeeIds: ['pk'], boardGraceMinutes: grace });
  return { db, board, p, state, feed, select, response, advance: value => { clock = Date.parse(value); } };
}
test('confirmed NO OT and WITH OT shifts calculate the delayed board cutoff from actual shift details', async t => {
  const f = fixture(t); f.board.save('ABB2', f.p, await f.select()); f.board.capture();
  let row = f.feed().body.shifts[0];
  assert.equal(row.endAt, '2026-11-02T08:15:00.000Z');
  assert.equal(row.greyAt, '2026-11-02T08:45:00.000Z');
  assert.deepEqual(row.employeeIds, ['pk']);
  assert.equal(JSON.stringify(row).includes('Same Name'), false);
  f.p.overtime = true; Object.assign(f.p, shiftSchedule(f.p.date, f.p.shift, true));
  f.board.save('ABB2', f.p, await f.select(15)); f.board.capture();
  row = f.feed().body.shifts[0];
  assert.equal(row.greyAt, '2026-11-02T12:15:00.000Z');
  assert.equal(f.feed().body.shifts.length, 1);
});
test('pending OT changes are not published until the source shift confirms them', async t => {
  const f = fixture(t); f.board.save('ABB2', f.p, await f.select()); f.board.capture();
  f.board.save('ABB2', f.p, { ...await f.select(), overtime: true }); f.board.capture();
  assert.equal(f.feed().body.shifts[0].overtime, false);
  f.p.overtime = true; Object.assign(f.p, shiftSchedule(f.p.date, f.p.shift, true)); f.board.capture();
  assert.equal(f.feed().body.shifts[0].overtime, true);
});
test('early manual end uses its observed end plus grace and remains stable across restarts and rollover', async t => {
  const f = fixture(t); f.board.save('ABB2', f.p, await f.select()); f.board.capture();
  f.p.status = 'ended'; f.board.capture();
  const ended = f.feed().body.shifts[0]; assert.equal(ended.greyAt, '2026-11-02T04:30:00.000Z');
  f.advance('2026-11-02T05:00:00Z'); f.board.capture(); assert.deepEqual(f.feed().body.shifts[0], ended);
  f.state.shift = null; f.board.capture(); assert.deepEqual(f.feed().body.shifts[0], ended);
});
test('night shifts cross midnight and board grace is explicitly 15 or 30 minutes', async t => {
  const f = fixture(t); Object.assign(f.p, { shift: 'Night', overtime: true, id: 'night' }, shiftSchedule('2026-11-02', 'Night', true));
  f.board.save('ABB2', f.p, await f.select(30)); f.board.capture();
  assert.equal(f.feed().body.shifts[0].greyAt, '2026-11-03T00:30:00.000Z');
  await assert.rejects(f.board.prepare('ABB2', { ...f.p, attendanceEmployeeIds: ['pk'], boardGraceMinutes: 0 }), /15 or 30/);
});
test('employee ID and plant membership are verified without matching ambiguous names', async t => {
  const f = fixture(t);
  for (const ids of [['sy'], ['unknown'], ['pk', 'pk']]) await assert.rejects(f.board.prepare('ABB2', { ...f.p, attendanceEmployeeIds: ids, boardGraceMinutes: 30 }));
  const res = f.response(); await f.board.options({ line: 'ABB2' }, res); assert.deepEqual(res.body.employees.map(e => e.id), ['pk']);
  assert.equal(await f.board.prepare('ABB2', f.p), null);
});
test('dedicated feed credentials are required, demo feeds are disabled, and remapped lines disappear', async t => {
  const f = fixture(t); f.board.save('ABB2', f.p, await f.select()); f.board.capture();
  assert.equal(f.feed('private').code, 401); assert.equal(f.feed('').code, 401);
  f.db.prepare('UPDATE production_line_groups SET group_id=?').run('conversion-sendayan'); assert.deepEqual(f.feed().body.shifts, []);
  const demo = fixture(t, 'demo'); assert.equal(demo.feed().code, 401);
});
