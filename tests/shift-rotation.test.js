import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../server/store.js';
import { createExecutiveWorkspace } from '../server/executive.js';

function response() { return { code: 200, status(n) { this.code = n; return this; }, json(body) { this.body = body; return this; } }; }

test('executives set the Day/Night rotation and OT plan for their own division; operators read it for warnings', async () => {
  const db = openStore(':memory:');
  db.prepare("INSERT INTO production_line_groups VALUES('ABB2','conversion-port-klang')").run();
  const workspace = createExecutiveWorkspace({ db, lines: () => ['ABB2'], attendance: { groups: [] }, snapshot: () => ({}), teams: async () => [{ id: '1', team: 'A' }, { id: '2', team: 'B' }] });
  const exec = { role: 'executive', name: 'Exec', lines: ['ABB2'], executiveGroup: 'conversion-port-klang' };
  const call = async (user, body) => { const res = response(); await workspace.rotation({ user, body }, res); return res; };
  const plan = async () => { const res = response(); await workspace.plan({ line: 'ABB2' }, res); return res.body; };

  assert.deepEqual(await plan(), { rotation: null, group: 'Conversion · Port Klang', teams: {} });
  for (const role of ['operator', 'management', 'display']) assert.equal((await call({ ...exec, role }, { groupId: 'conversion-port-klang', dayTeam: 'A', dayOt: true, nightOt: false })).code, 403);
  assert.equal((await call(exec, { groupId: 'conversion-sendayan', dayTeam: 'A', dayOt: true, nightOt: false })).code, 403);
  assert.equal((await call(exec, { groupId: 'conversion-port-klang', dayTeam: 'C', dayOt: true, nightOt: false })).code, 400);
  assert.equal((await call(exec, { groupId: 'conversion-port-klang', dayTeam: 'A', dayOt: 'yes', nightOt: false })).code, 400);

  assert.equal((await call(exec, { groupId: 'conversion-port-klang', dayTeam: 'B', dayOt: true, nightOt: null })).code, 200);
  const current = await plan();
  assert.deepEqual([current.rotation.dayTeam, current.rotation.nightTeam, current.rotation.dayOt, current.rotation.nightOt, current.rotation.updatedBy], ['B', 'A', true, null, 'Exec']);
  assert.deepEqual(current.teams, { 1: 'A', 2: 'B' });
  // A developer may set any division.
  assert.equal((await call({ role: 'developer', name: 'Dev', lines: ['ABB2'] }, { groupId: 'conversion-sendayan', dayTeam: 'A', dayOt: false, nightOt: false })).code, 200);
  const list = response(); await workspace.list({ user: exec, query: {} }, list);
  assert.equal(list.body.rotations['conversion-port-klang'].dayTeam, 'B');
  assert.deepEqual(Object.keys(list.body.rotations), ['conversion-port-klang']);
});
