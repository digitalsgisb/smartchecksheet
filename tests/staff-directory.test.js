import test from 'node:test';
import assert from 'node:assert/strict';
import { createStaffDirectory } from '../server/staffDirectory.js';

const reply = () => ({ code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
const people = [
  { id: 'PK1', name: 'Ali', department: 'PRODUCTION', base: 'PORT KLANG', line: 'ABB2', team: 'A', active: 1, status: 'OUT', checksheet_role: 'LEADER', covers_lines: '["ABB2","ABB7"]', updated_at: 't1' },
  { id: 'PK2', name: 'Busy', department: 'PRODUCTION', base: 'PORT KLANG', line: 'LM', team: 'B', active: 1, status: 'IN', updated_at: 't2' },
  { id: 'RM1', name: 'Roller', department: 'PRODUCTION', base: 'PORT KLANG', line: 'ROLL MAKING', team: 'A', active: 1, status: 'OUT', updated_at: 't3' },
  { id: 'SD1', name: 'Sendayan', department: 'PRODUCTION', base: 'SENDAYAN', line: 'SDY1', team: 'C', active: 1, status: 'OUT', updated_at: 't4' },
  { id: 'OF1', name: 'Office', department: 'OFFICE', base: 'PORT KLANG', line: '', active: 1, status: 'OUT', updated_at: 't5' }
];
const lineGroups = { ABB2: 'conversion-port-klang', ABB7: 'conversion-port-klang', LM: 'conversion-port-klang', SDY1: 'conversion-sendayan', SDY2: 'conversion-sendayan' };
function setup({ answer = 200, offline = false } = {}) {
  const sent = [];
  const fetcher = async (url, options = {}) => {
    if (offline) throw new TypeError('fetch failed');
    assert.equal(options.headers.Authorization, 'Bearer secret-token');
    if (!options.method) return { ok: true, status: 200, json: async () => ({ connection_scope: 'integration', employees: people }) };
    const body = JSON.parse(options.body); sent.push({ url, method: options.method, body });
    return { ok: answer === 200, status: answer, json: async () => ({ employee: { ...body.employee, id: body.employee.id || url.split('/').pop(), department: 'PRODUCTION', updated_at: 'new' }, secret: 'never shown' }) };
  };
  const directory = createStaffDirectory({ attendance: { url: 'http://attendance', token: 'secret-token' }, lines: () => Object.keys(lineGroups), lineGroups: () => lineGroups, fetcher });
  const call = async (name, user, req = {}) => { const res = reply(); await directory[name]({ user, params: {}, body: {}, ...req }, res); return res; };
  return { call, sent };
}
const exec = { role: 'executive', executiveGroup: 'conversion-port-klang', name: 'Exec PK' };
const manager = { role: 'management', name: 'Manager' };

test('an executive sees only Production staff in their own division and site', async () => {
  const { call } = setup();
  const res = await call('list', exec);
  assert.deepEqual(res.body.employees.map(p => p.id), ['PK1', 'PK2']);
  assert.deepEqual(res.body.employees[0].coversLines, ['ABB2', 'ABB7']);
  assert.deepEqual(res.body.groups.map(g => g.id), ['conversion-port-klang']);
  assert.deepEqual(res.body.groups[0].lines, ['ABB2', 'ABB7', 'LM']);
  assert.deepEqual(res.body.groups[0].teams, ['A', 'B', 'N']);
  assert.deepEqual((await call('list', manager)).body.employees.map(p => p.id).sort(), ['PK1', 'PK2', 'RM1', 'SD1']);
  assert.equal((await call('list', { role: 'operator' })).code, 403);
});

test('adding a person sends plant and section from the chosen group and a named user', async () => {
  const { call, sent } = setup();
  const res = await call('create', exec, { body: { employee: { id: '5001', name: 'Siti', groupId: 'conversion-port-klang', line: 'lm', team: 'A', role: 'SUPERVISOR', coversLines: ['ABB7'] } } });
  assert.equal(res.code, 200, res.body?.error);
  assert.deepEqual(sent[0].body.employee, { id: '5001', name: 'Siti', nickname: '', position: '', base: 'PORT KLANG', production_section: 'CONVERSION', line: 'LM', team: 'A', checksheet_group: '', checksheet_role: 'SUPERVISOR', covers_lines: ['ABB7', 'LM'], active: true });
  assert.equal(sent[0].body.changed_by, 'Exec PK');
  assert.doesNotMatch(JSON.stringify(res.body), /never shown|secret-token/);
  // Outside the executive's group, other plants' lines, bad teams and roles are refused before Attendance is called.
  assert.equal((await call('create', exec, { body: { employee: { id: '5002', name: 'X', groupId: 'conversion-sendayan', line: 'SDY1' } } })).code, 403);
  assert.equal((await call('create', exec, { body: { employee: { id: '5002', name: 'X', groupId: 'conversion-port-klang', line: 'LM', role: 'LEADER', coversLines: ['SDY1'] } } })).code, 400);
  assert.equal((await call('create', exec, { body: { employee: { id: '5002', name: 'X', groupId: 'conversion-port-klang', line: 'LM', team: 'C' } } })).code, 400);
  assert.equal((await call('create', exec, { body: { employee: { id: '5002', name: 'X', groupId: 'conversion-port-klang', line: 'LM', role: 'BOSS' } } })).code, 400);
  assert.equal((await call('create', exec, { body: { employee: { id: 'bad id', name: 'X', groupId: 'conversion-port-klang', line: 'LM' } } })).code, 400);
  assert.equal(sent.length, 1);
});

test('operators keep one line, and editing keeps fields that were not changed', async () => {
  const { call, sent } = setup();
  const res = await call('update', exec, { params: { id: 'PK1' }, body: { employee: { role: 'FORMING' }, updatedAt: 't1' } });
  assert.equal(res.code, 200, res.body?.error);
  assert.match(sent[0].url, /\/api\/integrations\/production-employees\/PK1$/);
  assert.deepEqual({ ...sent[0].body.employee }, { name: 'Ali', nickname: '', position: '', base: 'PORT KLANG', production_section: 'CONVERSION', line: 'ABB2', team: 'A', checksheet_group: '', checksheet_role: 'FORMING', covers_lines: [] });
  assert.equal(sent[0].body.updated_at, 't1');
});

test('deactivating, staff outside the group, offline and refused saves give plain messages', async () => {
  const { call } = setup();
  assert.match((await call('update', exec, { params: { id: 'PK2' }, body: { employee: { active: false }, updatedAt: 't2' } })).body.error, /still clocked in/);
  assert.equal((await call('update', exec, { params: { id: 'SD1' }, body: { employee: { name: 'X' } } })).code, 404);
  assert.equal((await call('update', exec, { params: { id: 'OF1' }, body: { employee: { name: 'X' } } })).code, 404);
  const stale = await setup({ answer: 409 }).call('update', exec, { params: { id: 'PK1' }, body: { employee: { name: 'X' }, updatedAt: 'old' } });
  assert.equal(stale.code, 409); assert.match(stale.body.error, /Reload/);
  const taken = await setup({ answer: 409 }).call('create', exec, { body: { employee: { id: 'PK1', name: 'X', groupId: 'conversion-port-klang', line: 'LM' } } });
  assert.match(taken.body.error, /already used/);
  const offline = await setup({ offline: true }).call('list', exec);
  assert.equal(offline.code, 503); assert.match(offline.body.error, /offline/);
});
