import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../server/store.js';
import { createExecutiveWorkspace, executiveUser } from '../server/executive.js';

const pk = 'conversion-port-klang', sy = 'conversion-sendayan', rm = 'roll-making-port-klang';
const groups = [
  { id: 'fc1', label: 'FC 1', lines: ['FC'], assignment: 'fc1', accountLines: ['ABB2'] },
  { id: 'fc3', label: 'FC 3', lines: ['FC'], assignment: 'fc3', accountLines: ['ABB3'] },
  { id: 'roll', label: 'Roll Making', section: 'ROLL MAKING', accountLines: ['RM1'] }
];
const employees = [
  { id: '1', name: 'PK Operator', line: 'FC', checksheet_group: 'fc1', status: 'IN', department: 'PRODUCTION', active: 1 },
  { id: '2', name: 'Sendayan Operator', line: 'FC', checksheet_group: 'fc3', status: 'OUT', department: 'PRODUCTION', active: 1 },
  { id: '3', name: 'Roll Operator', line: 'RM1', production_section: 'ROLL MAKING', status: 'IN', department: 'PRODUCTION', active: 1 },
  { id: '4', name: 'Inactive', line: 'FC', checksheet_group: 'fc1', status: 'IN', department: 'PRODUCTION', active: 0 }
];
function fixture(t, options = {}) {
  const db = openStore(':memory:'); t.after(() => db.close());
  for (const [line, group] of [['ABB2', pk], ['ABB3', sy], ['RM1', rm]]) db.prepare('INSERT INTO production_line_groups VALUES(?,?)').run(line, group);
  const admin = { id: 'admin', name: 'Admin', role: 'developer', lines: ['ABB2', 'ABB3', 'RM1'] };
  const exec = { id: 'exec', name: 'Executive', role: 'executive', lines: admin.lines, executiveGroup: pk };
  const service = createExecutiveWorkspace({ db, lines: () => admin.lines, snapshot: () => ({ live: { actual: 0 }, connected: true, issues: [] }), attendance: { url: 'http://attendance', token: 'private-token', groups }, fetcher: async () => {
    if (options.down) throw new Error('private-token');
    return { ok: true, json: async () => ({ connection_scope: options.scope || 'integration', employees }) };
  } });
  const call = async (method, body = {}, user = exec, query = { date: '2027-01-02' }, params = {}) => {
    const res = { code: 200, status(code) { this.code = code; return this; }, json(value) { this.body = value; return this; } };
    await service[method]({ user, body, query, params }, res); return res;
  };
  const plan = { employeeId: '1', line: 'ABB2', shiftName: 'Night', startAt: '2027-01-02T20:00:00+08:00', endAt: '2027-01-03T08:00:00+08:00' };
  return { db, service, call, admin, exec, plan };
}
test('executive overview and employee labels are scoped to division and site', async t => {
  const f = fixture(t), result = await f.call('list');
  assert.equal(result.code, 200);
  assert.deepEqual(result.body.groups.map(g => g.id), [pk]);
  assert.deepEqual(result.body.lines.map(l => l.line), ['ABB2']);
  assert.deepEqual(result.body.employees.map(e => e.id), ['1']);
  assert.equal(result.body.employees[0].productionGroup.label, 'Conversion · Port Klang');
  const roll = await f.call('list', {}, { ...f.exec, executiveGroup: rm });
  assert.deepEqual(roll.body.employees.map(e => e.id), ['3']);
  const syResult = await f.call('list', {}, { ...f.exec, executiveGroup: sy });
  assert.deepEqual(syResult.body.employees.map(e => e.id), ['2']);
  assert.equal((await f.call('list', {}, f.admin)).body.employees.length, 3);
  assert.deepEqual(executiveUser(f.db, { ...f.exec, executiveGroup: null }).lines, []);
});
test('normal users cannot read or mutate the executive workspace', async t => {
  const f = fixture(t);
  for (const role of ['operator', 'display']) for (const action of ['list', 'save', 'remove', 'configure']) assert.equal((await f.call(action, {}, { ...f.exec, role })).code, 403);
  assert.equal((await f.call('list', {}, null)).code, 401);
  assert.equal((await f.call('configure', { lineGroups: { ABB2: sy } })).code, 403);
});
test('assignments persist, handle overnight dates, update and delete with stale edit protection', async t => {
  const f = fixture(t), created = await f.call('save', f.plan);
  assert.equal(created.code, 200);
  const item = (await f.call('list')).body.assignments[0];
  assert.equal(item.employeeName, 'PK Operator');
  assert.equal(item.startAt, '2027-01-02T12:00:00.000Z');
  assert.equal((await f.call('list', {}, f.exec, { date: '2027-01-03' })).body.assignments.length, 1);
  assert.equal((await f.call('save', { ...f.plan, ...item, shiftName: 'Night B' })).code, 200);
  assert.equal((await f.call('save', { ...f.plan, ...item })).code, 409);
  assert.equal((await f.call('remove', { updatedAt: item.updatedAt }, f.exec, {}, { id: item.id })).code, 409);
  const updated = (await f.call('list')).body.assignments[0];
  assert.equal(updated.shiftName, 'Night B');
  assert.equal((await f.call('remove', { updatedAt: updated.updatedAt }, f.exec, {}, { id: item.id })).code, 200);
  assert.equal((await f.call('list')).body.assignments.length, 0);
});
test('overlapping assignments are rejected while adjacent shifts are allowed', async t => {
  const f = fixture(t); assert.equal((await f.call('save', f.plan)).code, 200);
  assert.equal((await f.call('save', f.plan)).code, 409);
  assert.equal((await f.call('save', { ...f.plan, startAt: f.plan.endAt, endAt: '2027-01-03T16:00:00+08:00' })).code, 200);
});
test('cross-site employee, target line and assignment tampering are denied', async t => {
  const f = fixture(t);
  assert.equal((await f.call('save', { ...f.plan, employeeId: '2' })).code, 400);
  assert.equal((await f.call('save', { ...f.plan, employeeId: '4' })).code, 400);
  assert.equal((await f.call('save', { ...f.plan, line: 'ABB3', employeeId: '2' })).code, 403);
  const created = await f.call('save', { ...f.plan, line: 'ABB3', employeeId: '2' }, f.admin);
  assert.equal(created.code, 200);
  assert.equal((await f.call('list')).body.assignments.length, 0);
  assert.equal((await f.call('save', { ...f.plan, id: created.body.id })).code, 403);
  assert.equal((await f.call('remove', {}, f.exec, {}, { id: created.body.id })).code, 403);
});
test('mapping separates divisions, validates shared groups, and preserves future plans', async t => {
  const f = fixture(t);
  assert.equal((await f.call('configure', { lineGroups: { RM1: pk } }, f.admin)).code, 400);
  assert.equal((await f.call('configure', { lineGroups: { ABB2: rm } }, f.admin)).code, 400);
  assert.equal((await f.call('configure', { lineGroups: { UNKNOWN: pk } }, f.admin)).code, 400);
  assert.equal((await f.call('configure', { lineGroups: { ABB2: sy } }, f.admin)).code, 200);
  assert.deepEqual(executiveUser(f.db, f.exec).lines, []);
  await f.call('configure', { lineGroups: { ABB2: pk } }, f.admin);
  await f.call('save', f.plan);
  assert.equal((await f.call('configure', { lineGroups: { ABB2: sy } }, f.admin)).code, 409);
});
test('Attendance failure preserves saved plans without fabricating employee counts or leaking secrets', async t => {
  const options = {}, f = fixture(t, options); await f.call('save', f.plan); options.down = true;
  // A new service bypasses the short successful-read cache.
  const service = createExecutiveWorkspace({ db: f.db, lines: () => f.admin.lines, snapshot: () => ({}), attendance: { url: 'http://attendance', token: 'private-token', groups }, fetcher: async () => { throw new Error('private-token'); } });
  const res = { json(body) { this.body = body; }, status() { return this; } };
  await service.list({ user: f.exec, query: { date: '2027-01-02' } }, res);
  assert.equal(res.body.assignments.length, 1);
  assert.ok(res.body.attendanceError);
  assert.equal(res.body.updatedAt, null);
  assert.equal(JSON.stringify(res.body).includes('private-token'), false);
  await service.save({ user: f.exec, body: f.plan }, { status(code) { this.code = code; return this; }, json() { assert.equal(this.code, 502); } });
});
test('invalid dates, shift intervals and privileged upstream credentials are rejected', async t => {
  const f = fixture(t);
  for (const date of ['2027-02-30', 'invalid', '2027-99-99']) assert.equal((await f.call('list', {}, f.exec, { date })).code, 400);
  for (const patch of [{ endAt: f.plan.startAt }, { endAt: 'invalid' }, { endAt: '2027-01-05T20:00:00Z' }, { startAt: '2027-01-02T20:00' }, { shiftName: '' }]) assert.equal((await f.call('save', { ...f.plan, ...patch })).code, 400);
  const bad = fixture(t, { scope: 'admin' });
  assert.equal((await bad.call('save', bad.plan)).code, 502);
});
