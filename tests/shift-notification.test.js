import test from 'node:test';
import assert from 'node:assert/strict';
import { finishedShift } from '../src/shiftNotification.js';

test('Shift finished notification follows confirmed endings and automatic rollover', () => {
  const day = { id: 'day', status: 'active', shift: 'Day' };
  const ended = { ...day, status: 'ended' };
  const night = { id: 'night', status: 'active', shift: 'Night' };
  assert.equal(finishedShift(null, day), null);
  assert.equal(finishedShift(day, { ...day }), null);
  assert.deepEqual(finishedShift(day, ended), ended);
  assert.deepEqual(finishedShift(null, ended), ended);
  assert.deepEqual(finishedShift(day, night), day);
  assert.equal(finishedShift(day, null), null);
  assert.equal(finishedShift(ended, night), null);
});
