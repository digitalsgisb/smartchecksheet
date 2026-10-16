import test from 'node:test';
import assert from 'node:assert/strict';
import { machineStatus } from '../src/machineStatus.js';

test('Python machine states have distinct operator labels and colours', () => {
  for (const [status, key, label] of [
    ['Running', 'running', 'Running'], ['Loading', 'loading', 'Loading'],
    ['Delay', 'waiting', 'Waiting'], ['Waiting for setup', 'waiting', 'Waiting'],
    ['Model change', 'change', 'Model change'], ['Downtime', 'down', 'Down'],
    ['Rest', 'rest', 'Rest']
  ]) assert.deepEqual(machineStatus({ status, mode: 'NORMAL' }, true, { status: 'idle' }), { key, label });
});
test('Disconnected telemetry never shows running and shared downtime takes priority', () => {
  assert.equal(machineStatus({ status: 'Running', mode: 'NORMAL' }, false).key, 'disconnected');
  assert.equal(machineStatus({ status: 'Running', mode: 'NORMAL' }, true, { status: 'running' }).key, 'down');
  assert.equal(machineStatus({ status: 'Running', mode: 'REST' }, true).key, 'rest');
});
