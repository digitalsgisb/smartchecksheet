import test from 'node:test';
import assert from 'node:assert/strict';
import { shiftGateMode } from '../src/shiftGate.js';

const request = { id: 'c1', at: 0 };
test('no request shows the plain popup', () => {
  assert.equal(shiftGateMode({ request: null, active: false }), 'idle');
});
test('a sent request waits for the line, not the plain popup', () => {
  assert.equal(shiftGateMode({ request, active: false, command: { id: 'c1', status: 'pending' } }), 'waiting');
  assert.equal(shiftGateMode({ request, active: false }), 'waiting');
});
test('the shift becoming active is success', () => {
  assert.equal(shiftGateMode({ request, active: true, command: { id: 'c1', status: 'confirmed' } }), 'success');
});
test('a rejected, failed or unconfirmed command, or a timeout, is a failure', () => {
  for (const status of ['rejected', 'failed', 'unconfirmed']) assert.equal(shiftGateMode({ request, active: false, command: { id: 'c1', status } }), 'failed');
  assert.equal(shiftGateMode({ request, active: false, timedOut: true }), 'failed');
});
test('a shift scheduled for later ends the wait instead of failing', () => {
  assert.equal(shiftGateMode({ request, active: false, pendingShift: { shift: 'Night' }, timedOut: true }), 'idle');
});
test('success wins over a stale timeout', () => {
  assert.equal(shiftGateMode({ request, active: true, timedOut: true }), 'success');
});
