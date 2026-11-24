import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createStaffLists, linePeople, matchLine } from '../server/staffLists.js';

const pk = 'conversion-port-klang';
const person = (id, name, more = {}) => ({ id, name, nickname: '', groupId: pk, line: 'ABB2', team: 'A', role: '', coversLines: [], active: true, status: 'OUT', updatedAt: 't-' + id, ...more });
const staff = () => [
  person('1', 'Ahmad Faiz', { nickname: 'Faiz', role: 'SUPERVISOR', coversLines: ['ABB2', 'ABB7'] }),
  person('2', 'Nur Aina', { nickname: 'Aina', role: 'OPERATOR' }),
  person('3', 'Lim Wei', { nickname: 'Wei', line: 'ABB7', role: 'FORMING' }),
  person('4', 'Old Hand', { role: 'QUALITY', active: false }),
  person('5', 'Siti', { role: '' }),
  person('6', 'Raju', { line: 'ABB7' }),
  person('7', 'Ali Abu', { nickname: 'Ali' }), person('8', 'Ali Bakar', { nickname: 'Ali' }),
  person('9', 'Siva', { groupId: 'conversion-sendayan', line: 'SDY1', role: 'LEADER' })
];

test('a line gets supervisors and leaders who cover it, and active operators whose home line it is', () => {
  const abb7 = linePeople(staff(), 'ABB7', 'conversion-port-klang');
  assert.deepEqual(abb7.supervisors, ['Faiz']);
  assert.deepEqual([abb7.forming, abb7.waterjet, abb7.assembly], [['Wei'], ['Wei'], ['Wei']], 'operators fill all three operator lists; an old Forming role reads as Operator');
  const abb2 = linePeople(staff(), 'ABB2', 'conversion-port-klang');
  assert.deepEqual([abb2.supervisors, abb2.forming, abb2.quality], [['Faiz'], ['Aina'], []], 'inactive people are left out');
  assert.deepEqual(linePeople(staff(), 'LM', 'conversion-port-klang').supervisors, ['Faiz'], 'a supervisor covers every line in the plant without picking lines');
  assert.deepEqual(linePeople(staff(), 'SDY1', 'conversion-sendayan').supervisors, [], 'but not another plant');
  assert.deepEqual(linePeople(staff(), 'ROLL MAKING', 'roll-making-port-klang').supervisors, [], 'nor Roll Making at the same site');
  assert.deepEqual(linePeople(staff(), 'NEW', '').supervisors, [], 'a line without a plant gets no supervisors');
});

test('matching names old lists to people in the same plant', () => {
  const old = { supervisors: ['Faiz'], leaders: ['siti '], forming: ['Aina', 'Nobody', 'Ali', 'Raju'], waterjet: ['Faiz', 'Aina', 'nobody'], assembly: ['Siva'], quality: ['Old Hand'] };
  const { rows, unlisted } = matchLine(old, staff(), 'ABB2', 'Port Klang', [], 'conversion-port-klang');
  const by = name => rows.filter(row => row.name.trim() === name).map(row => [row.list, row.status, row.patch, row.apply]);
  assert.deepEqual(by('Faiz'), [['supervisors', 'ok', undefined, undefined], ['waterjet', 'conflict', undefined, undefined]]);
  assert.deepEqual(by('siti'), [['leaders', 'change', { role: 'LEADER', coversLines: ['ABB2'] }, true]], 'names match regardless of case and spaces');
  assert.deepEqual(by('Aina'), [['forming', 'ok', undefined, undefined]]);
  assert.deepEqual(by('nobody'), [], 'a name in two operator lists is one row');
  assert.deepEqual(by('Nobody'), [['forming', 'missing', undefined, undefined]]);
  assert.deepEqual(by('Ali').map(([, status]) => status), ['ambiguous']);
  assert.deepEqual(by('Raju'), [['forming', 'change', { role: 'OPERATOR', line: 'ABB2' }, false]], 'moving an operator to another line is not ticked for you');
  assert.deepEqual(by('Siva').map(([, status]) => status), ['missing'], 'people in another plant are not matched');
  assert.deepEqual(by('Old Hand').map(([, status]) => status), ['inactive']);
  assert.deepEqual(unlisted.map(p => p.id), ['7', '8'], 'the two Alis could not be matched, so they are shown as not yet listed');
  assert.deepEqual(matchLine({}, staff(), 'ABB7', 'Port Klang').unlisted.map(p => p.id), ['3', '6']);
});

function setup({ people = staff(), refuse = null } = {}) {
  const db = new DatabaseSync(':memory:'), edits = [];
  let current = people.map(p => ({ ...p }));
  const fail = (status, message) => Object.assign(new Error(message), { status });
  const directory = {
    fail, groupsFor: user => { if (user.role !== 'executive') throw fail(403, 'No'); return [{ id: pk, site: 'Port Klang', division: 'Conversion' }]; },
    everyone: async () => current.map(p => ({ ...p })),
    async edit(user, groups, id, patch, updatedAt) { if (refuse === id) throw fail(409, 'Changed elsewhere.'); edits.push({ id, patch, updatedAt, by: user.name }); current = current.map(p => p.id === id ? { ...p, ...patch, updatedAt: 'new' } : p); }
  };
  const lists = createStaffLists({ db, directory, lines: () => ['ABB2', 'ABB7', 'SDY1'], lineGroups: () => ({ ABB2: pk, ABB7: pk, SDY1: 'conversion-sendayan' }), oldPeople: async () => ({ data: { supervisors: ['Faiz'], leaders: ['Siti'], forming: ['Aina'] }, source: 'checksheet' }) });
  const user = { role: 'executive', name: 'Exec', lines: ['ABB2', 'ABB7', 'SDY1'] };
  const call = async (name, line, body) => { const res = { code: 200, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } }; await lists[name]({ user, params: { line }, body }, res); return res; };
  return { db, lists, edits, call, setPeople: next => { current = next; } };
}

test('a line keeps its old list until the switch, then reads the master, even with Attendance offline', async () => {
  const { lists, edits, call } = setup();
  assert.equal(lists.people('ABB2'), null, 'not switched yet: the old list stays in use');
  const preview = await call('status', 'ABB2');
  assert.equal(preview.body.oldSource, 'checksheet');
  assert.deepEqual(preview.body.rows.map(row => row.status), ['ok', 'change', 'ok']);
  assert.equal((await call('status', 'SDY1')).code, 403, 'an executive only switches lines in their own group');
  const done = await call('switchOver', 'ABB2', { changes: [{ id: '5', role: 'LEADER', coversLines: ['ABB2'] }] });
  assert.equal(done.code, 200, done.body.error);
  assert.deepEqual(edits, [{ id: '5', patch: { role: 'LEADER', coversLines: ['ABB2'] }, updatedAt: 't-5', by: 'Exec' }]);
  assert.deepEqual(done.body.lists.leaders, ['Siti']);
  assert.deepEqual(lists.people('ABB2').data.leaders, ['Siti']);
  assert.equal(lists.people('ABB2').source, 'employees');
  assert.equal(lists.people('ABB7'), null, 'other lines are untouched');
  assert.equal((await call('switchBack', 'ABB2')).code, 200);
  assert.equal(lists.people('ABB2'), null);
});

test('the last good staff list survives a restart while Attendance is offline', async () => {
  const { db, lists, call } = setup();
  await call('switchOver', 'ABB2', { changes: [] });
  const offline = { fail: () => new Error(), groupsFor: () => [], everyone: async () => { throw new Error('offline'); }, edit: async () => {} };
  const restarted = createStaffLists({ db, directory: offline, lines: () => ['ABB2'], lineGroups: () => ({ ABB2: pk }) });
  assert.equal(await restarted.refresh(), false);
  assert.deepEqual(restarted.people('ABB2').data.supervisors, ['Faiz']);
  assert.ok(lists.people('ABB2').updatedAt);
});

test('a refused change stops the switch and says how many were saved', async () => {
  const { lists, call } = setup({ refuse: '6' });
  const res = await call('switchOver', 'ABB2', { changes: [{ id: '5', role: 'LEADER' }, { id: '6', role: 'OPERATOR', line: 'ABB2' }] });
  assert.equal(res.code, 409);
  assert.match(res.body.error, /^1 saved, then Raju: Changed elsewhere\. The line was not switched\.$/);
  assert.equal(lists.people('ABB2'), null);
  assert.equal((await call('switchOver', 'ABB2', { changes: [{ id: '5', role: 'LEADER' }, { id: '5', role: 'LEADER' }] })).code, 400);
});

test('Attendance lines on paper map to tablet lines: FC Line 1 is ABB2, FC Line 3 is ABB3, MF is ABB7', async () => {
  const { lineMap, homeLines } = await import('../server/staffDirectory.js');
  const map = lineMap([{ id: 'fc1', label: 'FC Line 1', lines: ['FC'], assignment: 'fc1', accountLines: ['ABB2'] }, { id: 'fc3', label: 'FC Line 3', lines: ['FC'], assignment: 'fc3', accountLines: ['ABB3'] }, { id: 'mf', label: 'Mini Forming', lines: ['MF'], accountLines: ['ABB7'] }, { id: 'rm', label: 'Roll Making', section: 'ROLL MAKING', accountLines: ['ROLL MAKING'] }]);
  assert.deepEqual(homeLines({ line: 'FC', checksheet_group: 'fc1' }, map), ['ABB2']);
  assert.deepEqual(homeLines({ line: 'FC', checksheet_group: 'fc3' }, map), ['ABB3']);
  assert.deepEqual(homeLines({ line: 'FC', checksheet_group: 'fc2' }, map), ['FC'], 'FC Line 2 has no tablet line yet');
  assert.deepEqual(homeLines({ line: 'mf' }, map), ['ABB7']);
  assert.deepEqual(homeLines({ line: 'ROLLER', production_section: 'ROLL MAKING' }, map), ['ROLL MAKING']);
  assert.deepEqual(homeLines({ line: 'LM' }, map), ['LM'], 'a line that is already a tablet line stays as it is');
  const people = [
    person('a', 'Op FC1', { line: 'FC', fcGroup: 'fc1', homeLines: ['ABB2'], role: 'OPERATOR' }),
    person('b', 'Op FC3', { line: 'FC', fcGroup: 'fc3', homeLines: ['ABB3'], role: 'OPERATOR' }),
    person('c', 'Op MF', { line: 'MF', homeLines: ['ABB7'], role: 'OPERATOR' })
  ];
  assert.deepEqual(linePeople(people, 'ABB2', 'conversion-port-klang').forming, ['Op FC1']);
  assert.deepEqual(linePeople(people, 'ABB7', 'conversion-port-klang').assembly, ['Op MF']);
  const { rows, unlisted } = matchLine({ forming: ['Op FC1', 'Op FC3'] }, people, 'ABB2', 'Port Klang', map);
  assert.deepEqual(rows.map(row => [row.name, row.status, row.patch, row.apply]), [['Op FC1', 'ok', undefined, undefined], ['Op FC3', 'change', { role: 'OPERATOR', line: 'FC', fcGroup: 'fc1' }, false]], 'moving someone to ABB2 saves FC + FC Line 1 in Attendance');
  assert.deepEqual(unlisted, []);
});
