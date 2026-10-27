import test from 'node:test';
import assert from 'node:assert/strict';
import { modeRequestStatus } from '../src/modeRequest.js';

test('mode feedback is immediate and stale telemetry does not clear the requested selection', () => {
  assert.equal(modeRequestStatus({ mode: 'REST' }, 'NORMAL'), 'sending');
  assert.equal(modeRequestStatus({ mode: 'REST', id: 'current' }, 'NORMAL', [{ id: 'old', status: 'failed' }]), 'pending');
  assert.equal(modeRequestStatus({ mode: 'REST', id: 'current' }, 'REST'), 'confirmed');
});
test('failed or timed-out mode requests roll back and confirmations follow only their command', () => {
  for (const status of ['rejected', 'failed', 'unconfirmed', 'confirmed']) {
    assert.equal(modeRequestStatus({ mode: 'REST', id: 'current' }, 'NORMAL', [{ id: 'current', status }]), status);
  }
  assert.equal(modeRequestStatus(null, 'NORMAL'), 'idle');
});
