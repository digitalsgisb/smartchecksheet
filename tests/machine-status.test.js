import test from 'node:test';
import assert from 'node:assert/strict';
import { machineStatus } from '../src/machineStatus.js';

test('Python machine states have distinct operator labels and colours', () => {
  for (const [status, key, label] of [
    ['Running', 'running', 'Running'], ['Loading', 'loading', 'Loading'],
    ['Delay', 'waiting', 'Waiting'], ['Waiting for setup', 'waiting', 'Waiting'],
    ['Model change', 'change', 'Model change'], ['Downtime', 'down', 'Down'],
    ['Planned stop', 'planned', 'Planned stop'],
    ['Rest', 'rest', 'Rest']
  ]) assert.deepEqual(machineStatus({ status, mode: 'NORMAL' }, true, { status: 'idle' }), { key, label });
});

test('planned stops keep a distinct banner while the shared timer runs', () => {
  const planned = { key: 'planned', label: 'Planned stop' };
  assert.deepEqual(machineStatus({ status: 'Planned stop', mode: 'PLANNED STOP' }, true, { status: 'running', category: 'Planned Stop' }), planned);
  assert.deepEqual(machineStatus({ status: 'Running', mode: 'NORMAL' }, true, { status: 'running', category: 'Planned Stop' }), planned);
  assert.deepEqual(machineStatus({ mode: 'PLANNED_STOP' }, true), planned);
  assert.equal(machineStatus({ status: 'Running' }, true, { status: 'stopped', category: 'Planned Stop' }).key, 'running');
  assert.equal(machineStatus({ status: 'Downtime' }, true, { status: 'running', category: 'Machine' }).key, 'down');
  assert.equal(machineStatus({ status: 'Planned stop' }, true, { status: 'running', category: 'Machine' }).key, 'down');
  assert.equal(machineStatus({ status: 'Planned stop' }, false, { status: 'running', category: 'Planned Stop' }).key, 'disconnected');
});
test('Disconnected telemetry never shows running and shared downtime takes priority', () => {
  assert.equal(machineStatus({ status: 'Running', mode: 'NORMAL' }, false).key, 'disconnected');
  assert.equal(machineStatus({ status: 'Running', mode: 'NORMAL' }, true, { status: 'running' }).key, 'down');
  assert.equal(machineStatus({ status: 'Running', mode: 'REST' }, true).key, 'rest');
});
