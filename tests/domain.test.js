import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateHourly, rejectTotals, shiftSchedule, finiteNumber } from '../server/domain.js';
import { hashPassword, verifyPassword, openStore, syncDeveloperLines } from '../server/store.js';

test('hourly model and lot segments are preserved in the same hour', () => {
  const common = { shiftId: 'S1', slot: '10.00-11.00', restMinutes: 0 };
  const result = aggregateHourly([{ ...common, model: 'A', lot: 'L1', plan: 20, actual: 18 }, { ...common, model: 'B', lot: 'L2', plan: 30, actual: 29 }, { ...common, model: 'A', lot: 'L1', plan: 5, actual: 4 }]);
  assert.equal(result.length, 2); assert.equal(result[0].actual, 22); assert.equal(result[1].actual, 29);
});
test('reject lengths never inflate after-forming piece counts', () => {
  assert.deepEqual(rejectTotals([{ ng: 2, loft: 3, slab: 15.5, returnRoll: 8 }]), { pieces: 5, slab: 15.5, returnRoll: 8 });
});
test('Malaysia night shifts cross midnight with correct OT boundaries', () => {
  const regular = shiftSchedule('2026-10-09', 'Night', false); const ot = shiftSchedule('2026-10-09', 'Night', true);
  assert.equal(regular.startAt, '2026-10-09T08:15:00.000Z'); assert.equal(regular.endAt, '2026-10-09T16:30:00.000Z');
  assert.equal(ot.startAt, '2026-10-09T12:00:00.000Z'); assert.equal(ot.endAt, '2026-10-10T00:00:00.000Z');
});
test('invalid and negative numbers are rejected', () => {
  for (const value of [-1, 'not a number', '', null, Infinity]) assert.throws(() => finiteNumber(value, 'Quantity'));
});
test('passwords are salted and compared without storing plain text', () => {
  const hash = hashPassword('Example-password-123'); assert.notEqual(hash, hashPassword('Example-password-123'));
  assert.equal(verifyPassword('Example-password-123', hash), true); assert.equal(verifyPassword('wrong', hash), false);
});
test('SQLite state and report snapshots round-trip', () => {
  const db = openStore(':memory:'); const snapshot = { shift: { id: 'S1' }, actual: 42 };
  db.prepare('INSERT INTO state VALUES(?,?)').run('ABB2', JSON.stringify(snapshot));
  assert.deepEqual(JSON.parse(db.prepare('SELECT value FROM state').get().value), snapshot); db.close();
});

test('existing developers receive all configured lines without changing passwords, sessions or other roles', () => {
  const db = openStore(':memory:');
  try {
    const insert = db.prepare('INSERT INTO users(id,username,name,role,lines,password) VALUES(?,?,?,?,?,?)');
    insert.run('dev', 'developer', 'Developer', 'developer', '["ABB2"]', 'original-password-hash');
    insert.run('other-dev', 'admin', 'Admin', 'developer', '[]', 'another-password-hash');
    insert.run('operator', 'abb3', 'ABB3', 'operator', '["ABB3"]', 'operator-password-hash');
    db.prepare('INSERT INTO sessions VALUES(?,?,?)').run('existing-session', 'dev', Date.now() + 60000);
    const lines = ['ABB2', 'ABB3', 'ABB7', 'ROLL MAKING'];
    syncDeveloperLines(db, lines);
    syncDeveloperLines(db, lines);
    for (const user of db.prepare("SELECT * FROM users WHERE role='developer'").all()) assert.deepEqual(JSON.parse(user.lines), lines);
    assert.equal(db.prepare('SELECT password FROM users WHERE id=?').get('dev').password, 'original-password-hash');
    assert.equal(db.prepare('SELECT lines FROM users WHERE id=?').get('operator').lines, '["ABB3"]');
    assert.equal(db.prepare('SELECT user_id FROM sessions WHERE token=?').get('existing-session').user_id, 'dev');
    syncDeveloperLines(db, [...lines, 'FUTURE LINE']);
    assert.ok(JSON.parse(db.prepare('SELECT lines FROM users WHERE id=?').get('dev').lines).includes('FUTURE LINE'));
  } finally { db.close(); }
});
