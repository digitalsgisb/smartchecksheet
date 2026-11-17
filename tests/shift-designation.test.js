import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../server/store.js';
import { createExecutiveWorkspace } from '../server/executive.js';

const staff = ['1', '2', '3'].map(id => ({ id, name: `Person ${id}`, department: 'PRODUCTION', line: 'FC', base: 'Port Klang', checksheet_group: id === '3' ? 'fc3' : 'fc1', active: 1, status: 'IN', team: 'A' }));
const groups = [{ id: 'fc1', label: 'FC Line 1', lines: ['FC'], assignment: 'fc1', accountLines: ['ABB2'] }, { id: 'fc3', label: 'FC Line 3', lines: ['FC'], assignment: 'fc3', accountLines: ['ABB3'] }, { id: 'mf', label: 'Mini Forming', lines: ['MF'], accountLines: ['ABB7'] }, { id: 'rm', label: 'Roll Making', section: 'ROLL MAKING', accountLines: ['RM1'] }];
function response() { return { code: 200, status(n) { this.code = n; return this; }, json(body) { this.body = body; return this; } }; }

function fixture(answer = 200) {
  const db = openStore(':memory:'), sent = [];
  for (const [line, group] of [['ABB2', 'conversion-port-klang'], ['ABB3', 'conversion-port-klang'], ['ABB7', 'conversion-port-klang'], ['RM1', 'roll-making-port-klang']]) db.prepare('INSERT INTO production_line_groups VALUES(?,?)').run(line, group);
  const fetcher = async (url, options = {}) => {
    if (options.method === 'PUT') { sent.push({ url, auth: options.headers.Authorization, body: JSON.parse(options.body) }); return { ok: answer === 200, status: answer, json: async () => ({ error: 'secret upstream detail' }) }; }
    return { ok: true, json: async () => ({ connection_scope: 'integration', employees: staff }) };
  };
  const workspace = createExecutiveWorkspace({ db, lines: () => ['ABB2', 'ABB3', 'ABB7', 'RM1'], attendance: { url: 'http://local', token: 'private', groups }, snapshot: () => ({}), fetcher });
  const call = async (user, body) => { const res = response(); await workspace.shiftTeams({ user, body }, res); return res; };
  return { workspace, sent, call };
}
const exec = { role: 'executive', name: 'Exec', lines: ['ABB2'], executiveGroup: 'conversion-port-klang' };

test('shift A/B/N and line changes go to Smart Attendance, executive or developer only', async () => {
  const { sent, call, workspace } = fixture();
  for (const role of ['operator', 'management', 'display']) assert.equal((await call({ ...exec, role }, { changes: [{ employeeId: '1', team: 'A' }] })).code, 403);
  for (const change of [{ employeeId: '1', team: 'C' }, { employeeId: '1', group: 'nowhere' }, { employeeId: '1' }]) assert.equal((await call(exec, { changes: [change] })).code, 400);
  assert.equal((await call(exec, { changes: [] })).code, 400);
  // Person 3 is on FC Line 3 (ABB3), outside this executive's lines: the whole batch is refused before Attendance is called.
  assert.equal((await call(exec, { changes: [{ employeeId: '1', team: 'A' }, { employeeId: '3', team: 'A' }] })).code, 403);
  assert.equal(sent.length, 0);

  assert.equal((await call(exec, { changes: [{ employeeId: '1', team: 'N' }, { employeeId: '2', group: 'mf' }] })).code, 200);
  assert.deepEqual(sent[0], { url: 'http://local/api/integrations/employees', auth: 'Bearer private', body: { changed_by: 'Exec', changes: [
    { id: '1', team: 'N' },
    { id: '2', line: 'MF', checksheet_group: '', production_section: 'CONVERSION', base: 'PORT KLANG' }] } });
  // "Any line": a developer may move someone to Roll Making.
  assert.equal((await call({ role: 'developer', name: 'Dev', lines: ['ABB2', 'ABB3', 'ABB7', 'RM1'] }, { changes: [{ employeeId: '3', group: 'rm', team: 'B' }] })).code, 200);
  assert.deepEqual(sent[1].body.changes, [{ id: '3', team: 'B', line: 'ROLL MAKING', checksheet_group: '', production_section: 'ROLL MAKING', base: 'PORT KLANG' }]);

  const list = response(); await workspace.list({ user: exec, query: {} }, list);
  assert.equal(list.body.canSetShiftTeam, true);
  assert.deepEqual(list.body.lineOptions.map(o => o.id), ['fc1', 'fc3', 'mf', 'rm']);
  assert.deepEqual(list.body.employees.map(p => [p.id, p.team, p.attendanceGroupId]), [['1', 'A', 'fc1'], ['2', 'A', 'fc1']]);
});

test('an Attendance refusal is reported plainly without its response body', async () => {
  const { call } = fixture(403);
  const refused = await call(exec, { changes: [{ employeeId: '1', team: 'B' }] });
  assert.equal(refused.code, 502);
  assert.match(refused.body.error, /Smart Attendance refused/);
  assert.doesNotMatch(JSON.stringify(refused.body), /secret/);
});

test('supervisors are flagged and listed even without a configured line, only for a fully covered division', async () => {
  const db = openStore(':memory:');
  for (const [line, group] of [['ABB2', 'conversion-port-klang'], ['ABB3', 'conversion-port-klang']]) db.prepare('INSERT INTO production_line_groups VALUES(?,?)').run(line, group);
  const employees = [
    { id: '1', name: 'Crew', department: 'PRODUCTION', line: 'FC', base: 'Port Klang', checksheet_group: 'fc1', active: 1, status: 'IN', team: 'A', position: 'SR LEADER, PROD' },
    { id: '7', name: 'Lined Spv', department: 'PRODUCTION', line: 'FC', base: 'Port Klang', checksheet_group: 'fc1', active: 1, status: 'IN', team: 'B', position: 'SR. SPR, PROD' },
    { id: '8', name: 'Floating Spv', department: 'PRODUCTION', line: '', base: 'Port Klang', active: 1, status: 'OUT', team: '', position: 'SPR, PROD' },
    { id: '9', name: 'Sendayan Spv', department: 'PRODUCTION', line: '', base: 'Sendayan', active: 1, status: 'IN', team: 'A', position: 'SUPERVISOR' }];
  const fetcher = async () => ({ ok: true, json: async () => ({ connection_scope: 'integration', employees }) });
  const workspace = createExecutiveWorkspace({ db, lines: () => ['ABB2', 'ABB3'], attendance: { url: 'http://local', token: 'private', groups: groups.slice(0, 2) }, snapshot: () => ({}), fetcher });
  const list = async user => { const res = response(); await workspace.list({ user, query: {} }, res); return res.body.employees.map(p => [p.id, p.supervisor]); };
  assert.deepEqual(await list({ role: 'executive', name: 'Exec', lines: ['ABB2', 'ABB3'], executiveGroup: 'conversion-port-klang' }), [['1', false], ['7', true], ['8', true]]);
  // Covering only part of the division does not reveal people outside the user's lines.
  assert.deepEqual(await list(exec), [['1', false], ['7', true]]);
});
