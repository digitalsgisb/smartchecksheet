import test from 'node:test';
import assert from 'node:assert/strict';
import { downtimeCodes, findCode, splitReason, codeReason, modelChangeCode } from '../shared/downtimeCodes.js';

test('PRS reference tables: 39 quality codes, X1-X3 and Y1-Y8 schedule codes, Z1-Z6 production codes', () => {
  const codes = category => downtimeCodes[category].flatMap(group => group.codes.map(([code]) => code));
  assert.equal(codes('Quality').length, 39);
  assert.deepEqual(codes('Schedule'), ['X1', 'X2', 'X3', 'Y1', 'Y2', 'Y3', 'Y4', 'Y5', 'Y6', 'Y7', 'Y8']);
  assert.deepEqual(codes('Production'), ['Z1', 'Z2', 'Z3', 'Z4', 'Z5', 'Z6']);
});
test('Model Change is Y1 with a 30 minute standard time and a reason the Pi maps to MODEL CHANGE', () => {
  assert.equal(modelChangeCode.stdMinutes, 30);
  const reason = codeReason(modelChangeCode.code, modelChangeCode.description);
  assert.equal(reason, 'Y1 - Model Change');
  assert.ok(reason.toLowerCase().includes('model change'));
  assert.equal(findCode('Schedule', reason).code, 'Y1');
  assert.equal(findCode('Production', reason), null);
});
test('saved rows give back code and description from live (split by the Pi) and manual (in the reason) records', () => {
  assert.deepEqual(splitReason({ code: 'Y1', reason: 'Model Change' }), { code: 'Y1', description: 'Model Change' });
  assert.deepEqual(splitReason({ reason: 'D5 - Short width' }), { code: 'D5', description: 'Short width' });
  assert.deepEqual(splitReason({ code: 'N/A', reason: 'Waterjet nozzle blocked' }), { code: '', description: 'Waterjet nozzle blocked' });
});
