import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../server/store.js';
import { createExecutiveWorkspace } from '../server/executive.js';

const staff = ['1', '2', '3'].map(id => ({ id, name: `Person ${id}`, department: 'PRODUCTION', line: 'FC', base: 'Port Klang', checksheet_group: id === '3' ? 'fc3' : 'fc1', active: 1, status: 'IN' }));
const attendance = { url: 'http://local', token: 'private', groups: [{ id: 'fc1', label: 'FC Line 1', lines: ['FC'], assignment: 'fc1', accountLines: ['ABB2'] }, { id: 'fc3', label: 'FC Line 3', lines: ['FC'], assignment: 'fc3', accountLines: ['ABB3'] }] };
function response() { return { code: 200, status(n) { this.code = n; return this; }, json(body) { this.body = body; return this; } }; }

test('only an executive or developer sets shift A/B in bulk; executives only inside their production group', async () => {
  const db = openStore(':memory:');
  db.prepare("INSERT INTO production_line_groups VALUES('ABB2','conversion-port-klang')").run();
  db.prepare("INSERT INTO production_line_groups VALUES('ABB3','roll-making-port-klang')").run();
  const workspace = createExecutiveWorkspace({ db, lines: () => ['ABB2', 'ABB3'], attendance, snapshot: () => ({}), fetcher: async () => ({ ok: true, json: async () => ({ connection_scope: 'integration', employees: staff }) }) });
  const exec = { role: 'executive', name: 'Exec', lines: ['ABB2'], executiveGroup: 'conversion-port-klang' };
  const call = async (user, body) => { const res = response(); await workspace.shiftTeams({ user, body }, res); return res; };

  for (const role of ['operator', 'management', 'display']) assert.equal((await call({ ...exec, role }, { changes: [{ employeeId: '1', team: 'A' }] })).code, 403);
  assert.equal((await call(exec, { changes: [{ employeeId: '1', team: 'C' }] })).code, 400);
  assert.equal((await call(exec, { changes: [] })).code, 400);
  // Person 3 is in Roll Making, outside this executive's group: the whole batch is refused.
  assert.equal((await call(exec, { changes: [{ employeeId: '1', team: 'A' }, { employeeId: '3', team: 'A' }] })).code, 403);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM employee_shift_teams').get().n, 0);

  assert.equal((await call(exec, { changes: [{ employeeId: '1', team: 'A' }, { employeeId: '2', team: 'B' }] })).code, 200);
  assert.equal((await call(exec, { changes: [{ employeeId: '2', team: '' }] })).code, 200);
  const developer = { role: 'developer', name: 'Dev', lines: ['ABB2', 'ABB3'] };
  assert.equal((await call(developer, { changes: [{ employeeId: '2', team: 'B' }] })).code, 200);
  const list = response(); await workspace.list({ user: exec, query: {} }, list);
  assert.equal(list.body.canSetShiftTeam, true);
  assert.deepEqual(list.body.employees.map(p => [p.id, p.shiftTeam, p.attendanceGroup]), [['1', 'A', 'FC Line 1'], ['2', 'B', 'FC Line 1']]);
  const devList = response(); await workspace.list({ user: developer, query: {} }, devList); assert.equal(devList.body.canSetShiftTeam, true);
  const managerList = response(); await workspace.list({ user: { ...developer, role: 'management' }, query: {} }, managerList); assert.equal(managerList.body.canSetShiftTeam, false);
});
