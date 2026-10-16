import test from 'node:test';
import assert from 'node:assert/strict';
import { attendanceConfig, createAttendanceBridge as rawBridge, summarizeAttendance } from '../server/attendance.js';

// Unit requests represent an authenticated ABB2 account unless explicitly overridden.
function createAttendanceBridge(...args) { const bridge = rawBridge(...args); return (req, res) => bridge({ user: { lines: ['ABB2'] }, ...req }, res); }

const fc1 = { id: 'fc1', label: 'FC Line 1', lines: ['FC'], assignment: 'fc1', accountLines: ['ABB2'] };
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

test('one server enforces each account line on attendance and portrait requests', async () => {
  const fc3 = { ...fc1, id: 'fc3', label: 'FC Line 3', assignment: 'fc3', accountLines: ['ABB3'] };
  const mf = { id: 'mf', label: 'Mini Forming', lines: ['MF'], accountLines: ['ABB7'] };
  const bridge = createAttendanceBridge({ url: 'http://local', token: 'private', groups: [fc1, fc3, mf] }, async () => ({ ok: true, json: async () => ({ connection_scope: 'integration', employees: [...employees, { ...employees[0], id: 'mf-person', line: 'MF' }] }) }));
  for (const [line, groupId] of [['ABB2', 'fc1'], ['ABB3', 'fc3'], ['ABB7', 'mf']]) {
    const own = response(); await bridge({ user: { lines: [line] }, query: {} }, own);
    assert.equal(own.code, 200); assert.equal(own.body.group.id, groupId); assert.deepEqual(own.body.groups.map(g => g.id), [groupId]);
    const other = groupId === 'fc1' ? 'fc3' : 'fc1';
    for (const params of [undefined, { employeeId: '1' }]) {
      const denied = response(); await bridge({ user: { lines: [line] }, query: { group: other }, params }, denied); assert.equal(denied.code, 403);
    }
  }
  const retired = response(); await bridge({ user: { lines: ['ABB4'] }, query: {} }, retired); assert.equal(retired.code, 403);
  const admin = response(); await bridge({ user: { role: 'developer', lines: ['ABB2'] }, query: {} }, admin); assert.equal(admin.body.groups.length, 3);
  const anonymous = response(); await rawBridge({ groups: [] })({ query: {} }, anonymous); assert.equal(anonymous.code, 401);
});

test('group configuration requires explicit account mapping', () => {
  assert.throws(() => attendanceConfig({ ATTENDANCE_GROUPS: JSON.stringify([{ id: 'fc1', label: 'FC Line 1', lines: ['FC'], assignment: 'fc1' }]) }), /accountLines/);
  assert.equal(attendanceConfig({ ATTENDANCE_GROUPS: JSON.stringify([fc1]) }).groups[0].accountLines[0], 'ABB2');
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

test('portraits use the authenticated proxy for uploads and accept only HTTPS external photos', () => {
  const staff = ['/uploads/abcdef.jpg', 'https://example.com/face.jpg', 'javascript:alert(1)', 'http://local/photo.jpg', 'https://user:secret@example.com/photo'].map((photo_url, i) => ({ ...employees[0], id: String(i), photo_url }));
  const result = summarizeAttendance(staff, fc1, 'now');
  assert.equal(result.employees[0].photoUrl, '/api/attendance/photos/0?group=fc1');
  assert.equal(result.employees[1].photoUrl, 'https://example.com/face.jpg');
  assert.deepEqual(result.employees.slice(2).map(e => e.photoUrl), [null, null, null]);
});

test('photo proxy checks group membership, fixes upstream path and sends credentials only upstream', async () => {
  let photoCalls = 0;
  const staff = employees.map(e => ({ ...e, photo_url: '/uploads/abcdef.jpg' }));
  const bridge = createAttendanceBridge({ url: 'http://local', token: 'private-token', groups: [fc1] }, async (url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer private-token');
    if (url.endsWith('/api/employees')) return { ok: true, json: async () => ({ connection_scope: 'integration', employees: staff }) };
    photoCalls++; assert.equal(url, 'http://local/uploads/abcdef.jpg'); assert.equal(options.redirect, 'error');
    return new Response(new Uint8Array([255, 216, 255, 217]), { headers: { 'Content-Type': 'image/jpeg' } });
  });
  for (const employeeId of ['4', '5', '6', '../secret']) {
    const denied = response(); await bridge({ query: { group: 'fc1' }, params: { employeeId } }, denied);
    assert.equal(denied.code, 404);
  }
  assert.equal(photoCalls, 0);
  const wrongGroup = response(); await bridge({ query: { group: 'fc2' }, params: { employeeId: '1' } }, wrongGroup); assert.equal(wrongGroup.code, 403);
  const photo = { ...response(), type(value) { this.contentType = value; return this; }, send(value) { this.bytes = value; return this; } };
  await bridge({ query: { group: 'fc1' }, params: { employeeId: '1' } }, photo);
  assert.equal(photo.contentType, 'image/jpeg'); assert.equal(photo.bytes.length, 4); assert.equal(photoCalls, 1);
});

test('photo failures and non-image responses never expose the upstream response', async () => {
  const bridge = createAttendanceBridge({ url: 'http://local', token: 'secret', groups: [fc1] }, async url => url.endsWith('/api/employees')
    ? { ok: true, json: async () => ({ connection_scope: 'integration', employees: [{ ...employees[0], photo_url: '/uploads/abcdef.jpg' }] }) }
    : new Response('secret upstream login', { headers: { 'Content-Type': 'text/html' } }));
  const failed = response(); await bridge({ query: {}, params: { employeeId: '1' } }, failed);
  assert.equal(failed.code, 502); assert.equal(JSON.stringify(failed).includes('secret'), false);
});
