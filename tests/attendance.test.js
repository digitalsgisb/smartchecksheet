import test from 'node:test';
import assert from 'node:assert/strict';
import { attendanceConfig, createAttendanceBridge, summarizeAttendance } from '../server/attendance.js';

const fc1 = { id: 'fc1', label: 'FC Line 1', lines: ['FC'], assignment: 'fc1' };
const employees = [
  { id: '1', name: 'One', department: 'PRODUCTION', line: 'FC', checksheet_group: 'fc1', active: 1, status: 'IN', session: { time_in: '2026-10-16T08:00:00+08:00' }, photo_url: 'private-photo' },
  { id: '2', name: 'Two', department: 'PRODUCTION', line: 'FC', checksheet_group: 'fc1', active: 1, status: 'OUT' },
  { id: '3', name: 'Three', department: 'PRODUCTION', line: 'FC', checksheet_group: 'fc1', active: 1, status: 'IN', stale_session: true },
  { id: '4', name: 'Other line', department: 'PRODUCTION', line: 'FC', checksheet_group: 'fc2', active: 1, status: 'IN' },
  { id: '5', name: 'Unassigned FC', department: 'PRODUCTION', line: 'FC', active: 1, status: 'IN' },
  { id: '6', name: 'Archived', department: 'PRODUCTION', line: 'FC', checksheet_group: 'fc1', active: 0, status: 'IN' },
  { id: '7', name: 'Office', department: 'OFFICE', line: 'FC', checksheet_group: 'fc1', active: 1, status: 'IN' },
];
test('FC assignment is independent of combined TV line; stale sessions are not counted as confirmed IN', () => {
  const result = summarizeAttendance(employees, fc1, 'now');
  assert.deepEqual([result.total, result.in, result.out, result.review], [3, 1, 1, 1]);
  assert.equal(JSON.stringify(result).includes('photo_url'), false);
  assert.equal(employees.every(e => e.line === 'FC'), true);
});
test('MF and whole Roll Making filter existing production lines', () => {
  const staff = ['MF','ROLL MAKING','FC'].map((line, i) => ({ id: String(i), name: line, line, department: 'PRODUCTION', status: 'OUT', active: 1 }));
  for (const line of ['MF','ROLL MAKING']) assert.equal(summarizeAttendance(staff, { lines: [line] }, 'now').total, 1);
  staff.push({ id:'subline', name:'Roll subline', line:'RM 2', production_section:'ROLL MAKING', department:'PRODUCTION', active:1, status:'IN' });
  assert.equal(summarizeAttendance(staff, { section:'ROLL MAKING' }, 'now').total, 2);
});
test('configuration rejects credential URLs and ambiguous groups', () => {
  assert.throws(() => attendanceConfig({ ATTENDANCE_API_URL: 'https://secret@example.com' }));
  assert.throws(() => attendanceConfig({ ATTENDANCE_GROUPS: '[{"id":"fc1"}]' }));
});
function response() { return { code: 200, status(n) { this.code = n; return this; }, json(body) { this.body = body; return this; } }; }
test('bridge fixes destination, keeps token private, coalesces reads and forbids unmapped groups', async () => {
  let calls = 0;
  const bridge = createAttendanceBridge({ url: 'http://127.0.0.1:8765', token: 'private-token', groups: [fc1] }, async (url, options) => {
    calls++; assert.equal(url, 'http://127.0.0.1:8765/api/employees'); assert.equal(options.headers.Authorization, 'Bearer private-token'); assert.equal(options.redirect, 'error');
    return { ok: true, json: async () => ({ connection_scope: 'integration', employees }) };
  });
  const replies = [response(), response()];
  await Promise.all(replies.map(res => bridge({ query: {} }, res)));
  assert.equal(calls, 1); assert.equal(replies[0].body.total, 3);
  assert.equal(JSON.stringify(replies).includes('private-token'), false);
  const denied = response(); await bridge({ query: { group: 'fc2' } }, denied); assert.equal(denied.code, 403);
});
test('failures never become zero counts or leak upstream secrets; recovery is retried', async () => {
  let down = true;
  const bridge = createAttendanceBridge({ url: 'http://local', token: 'secret', groups: [fc1] }, async () => {
    if (down) throw new Error('secret upstream failure');
    return { ok: true, json: async () => ({ connection_scope: 'integration', employees }) };
  });
  const failed = response(); await bridge({ query: {} }, failed);
  assert.equal(failed.code, 502); assert.equal(failed.body.total, undefined); assert.equal(JSON.stringify(failed).includes('secret'), false);
  down = false; const restored = response(); await bridge({ query: {} }, restored); assert.equal(restored.body.total, 3);
});
test('bridge requires read-only integration scope and explicit setup', async () => {
  const unset = response(); await createAttendanceBridge({ groups: [] })({ query: {} }, unset); assert.equal(unset.code, 503);
  const bad = response(); await createAttendanceBridge({ url: 'http://local', token: 'kiosk', groups: [fc1] }, async () => ({ ok: true, json: async () => ({ connection_scope: 'kiosk', employees }) }))({ query: {} }, bad); assert.equal(bad.code, 502);
});
