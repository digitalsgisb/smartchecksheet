import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../server/store.js';
import { createHenkatenLog, applyHenkatenEdit, overlayIssues } from '../server/henkatenLog.js';
import { createManualWorkspace } from '../server/manualWorkspace.js';

const malaysia = ms => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(new Date(ms));
function shiftNow() {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kuala_Lumpur', hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
  return { date: malaysia(hour < 8 ? Date.now() - 86400000 : Date.now()), shift: hour >= 8 && hour < 20 ? 'Day' : 'Night', overtime: true, supervisor: 'S', leader: 'L', forming: ['A'], waterjet: ['B'], assembly: ['C'], quality: 'Q' };
}
function setup() {
  const db = openStore(':memory:'), log = createHenkatenLog({ db });
  const workspace = createManualWorkspace({ db, line: 'LM', henkaten: log });
  workspace.action('shift', shiftNow(), 'Leader A');
  workspace.action('henkaten', { category: 'machine', status: 'NG', issue: 'Belt slipping', action: 'Called maintenance' }, 'Leader A');
  const today = malaysia(Date.now());
  return { db, log, workspace, range: [malaysia(Date.now() - 2 * 86400000), today] };
}

test('every 4M entry is kept with its line and shift, and stays after the next shift clears the board', () => {
  const { log, workspace, range } = setup();
  const { entries } = log.list('LM', ...range);
  assert.deepEqual(entries.map(e => [e.category, e.issue, e.status, e.shiftId]).sort(), [['machine', 'Belt slipping', 'pending', workspace.snapshot().shift.id], ['man', `Confirm manpower for ${shiftNow().shift} shift`, 'pending', workspace.snapshot().shift.id]].sort());
  assert.equal(log.list('SDY1', ...range).entries.length, 0, 'each line sees only its own entries');
  assert.throws(() => log.list('LM', range[1], range[0]), /valid date range/);
});

test('an edit keeps what it said before, and moving a problem to another category moves it on the live board', () => {
  const { log, workspace, range } = setup();
  const belt = log.list('LM', ...range).entries.find(e => e.issue === 'Belt slipping');
  const edited = log.edit('LM', belt.id, { category: 'method', issue: 'Wrong belt fitted', action: 'Refit correct belt' }, 'Exec B');
  workspace.henkatenEdited(edited, 'Exec B');
  const state = workspace.snapshot();
  assert.equal(state.henkaten.machine.status, 'WAITING'); assert.equal(state.henkaten.method.status, 'NG'); assert.equal(state.henkaten.method.issue, 'Wrong belt fitted');
  const issue = state.issues.find(i => i.id === belt.id);
  assert.equal(issue.editedBy, 'Exec B'); assert.equal(issue.category, 'method');
  const saved = log.list('LM', ...range).entries.find(e => e.id === belt.id);
  assert.deepEqual([saved.issue, saved.editedBy, saved.edits.length], ['Wrong belt fitted', 'Exec B', 1]);
  assert.deepEqual([saved.edits[0].before.issue, saved.edits[0].before.category, saved.edits[0].after.issue], ['Belt slipping', 'machine', 'Wrong belt fitted']);
  assert.match(state.audit[0].label, /Henkaten edited: method/);
  // Fixing it later on the board still works and keeps the correction.
  workspace.action('henkaten', { category: 'method', status: 'OK', action: 'Belt replaced' }, 'Leader A');
  assert.deepEqual((({ issue, status }) => [issue, status])(log.get(belt.id)), ['Wrong belt fitted', 'resolved']);
});

test('void needs a reason, keeps the entry visible, clears it from the board and cannot be edited after', () => {
  const { log, workspace, range } = setup();
  const belt = log.list('LM', ...range).entries.find(e => e.issue === 'Belt slipping');
  assert.throws(() => log.void('LM', belt.id, ' ', 'Exec B'), /Reason is required/);
  const voided = log.void('LM', belt.id, 'Keyed on the wrong line', 'Exec B'); workspace.henkatenEdited(voided, 'Exec B');
  assert.equal(workspace.snapshot().henkaten.machine.status, 'WAITING');
  assert.equal(workspace.snapshot().issues.filter(i => i.status === 'pending').length, 1);
  assert.deepEqual([log.get(belt.id).status, log.get(belt.id).voidReason], ['void', 'Keyed on the wrong line']);
  assert.throws(() => log.edit('LM', belt.id, { category: 'man', issue: 'x' }, 'Exec B'), /void/);
  assert.throws(() => log.edit('SDY1', belt.id, { category: 'man', issue: 'x' }, 'Exec B'), /not found for this line/);
  assert.throws(() => log.edit('LM', belt.id === 'x' ? '' : 'missing', { category: 'man', issue: 'x' }, 'Exec B'), /not found/);
});

test('an edit is checked: category must be one of the 4M and the problem cannot be empty', () => {
  const { log, range } = setup();
  const belt = log.list('LM', ...range).entries.find(e => e.issue === 'Belt slipping');
  assert.throws(() => log.edit('LM', belt.id, { category: 'people', issue: 'x' }, 'E'), /Man, Machine, Material or Method/);
  assert.throws(() => log.edit('LM', belt.id, { category: 'man', issue: '' }, 'E'), /Problem is required/);
});

test('history already in saved reports is imported on first start', () => {
  const db = openStore(':memory:');
  const snapshot = { shift: { id: '20261120-Day-ABB7' }, issues: [{ id: 'old-1', category: 'material', issue: 'Short roll', action: 'Changed roll', status: 'resolved', actor: 'Leader', createdAt: '2026-11-20T01:00:00.000Z' }] };
  db.prepare('INSERT INTO reports VALUES(?,?,?,?,?)').run('r1', '20261120-Day-ABB7', 'ABB7', '2026-11-20T09:00:00.000Z', JSON.stringify(snapshot));
  db.prepare('INSERT INTO reports VALUES(?,?,?,?,?)').run('r0', '20261120-Day-ABB7', 'ABB7', '2026-11-20T05:00:00.000Z', JSON.stringify({ ...snapshot, issues: [{ ...snapshot.issues[0], status: 'pending' }] }));
  db.prepare('INSERT INTO reports VALUES(?,?,?,?,?)').run('r2', '20261120-Day-LM', 'manual:LM', '2026-11-20T09:00:00.000Z', JSON.stringify({ shift: { id: '20261120-Day-LM' }, issues: [{ id: 'old-2', category: 'man', issue: 'Short of 1', status: 'pending', createdAt: '2026-11-20T02:00:00.000Z' }] }));
  const log = createHenkatenLog({ db });
  assert.deepEqual(log.list('ABB7', '2026-11-20', '2026-11-20').entries.map(e => [e.issue, e.status, e.shiftId]), [['Short roll', 'resolved', '20261120-Day-ABB7']], 'the newest report copy wins');
  assert.equal(log.list('LM', '2026-11-20', '2026-11-20').entries.length, 1, 'manual report keys map to their line');
});

test('a report download shows the corrected Henkaten, marked edited', () => {
  const snapshot = { issues: [{ id: 'a', category: 'man', issue: 'Typo', status: 'pending' }, { id: 'b', category: 'machine', issue: 'Fine', status: 'pending' }] };
  const result = overlayIssues(snapshot, [{ id: 'a', category: 'method', issue: 'Corrected', action: '', status: 'void', editedAt: '2026-11-25T01:00:00Z', editedBy: 'E', voidReason: 'dup' }, { id: 'b', issue: 'Fine' }]);
  assert.deepEqual(result.issues.map(i => [i.issue, i.status, !!i.editedAt]), [['Corrected', 'void', true], ['Fine', 'pending', false]]);
  assert.equal(snapshot.issues[0].issue, 'Typo', 'the saved snapshot itself is not changed');
});

test('an edit for an entry that is not on this shift leaves the board alone', () => {
  const state = { issues: [], henkaten: { man: { status: 'OK' } } };
  assert.equal(applyHenkatenEdit(state, { id: 'x', category: 'man' }), false);
});
