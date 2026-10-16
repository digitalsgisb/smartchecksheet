import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateHourly, rejectTotals, shiftSchedule, finiteNumber } from '../server/domain.js';
import { hashPassword, verifyPassword, openStore } from '../server/store.js';

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
