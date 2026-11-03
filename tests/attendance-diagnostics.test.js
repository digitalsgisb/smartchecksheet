import test from 'node:test';
import assert from 'node:assert/strict';
import { diagnoseAttendance } from '../server/attendance-diagnostics.js';
import { readApiResponse } from '../src/api.js';

const env = { ATTENDANCE_API_URL: 'http://attendance:8765', ATTENDANCE_TOKEN: 'private-test-token', ATTENDANCE_GROUPS: JSON.stringify([{ id: 'fc1', label: 'FC 1', lines: ['FC'], accountLines: ['ABB2'] }]) };

test('HTML gateway failures retain HTTP status and never display HTML or parser errors', async () => {
  for (const status of [200, 502, 503, 504]) {
    await assert.rejects(readApiResponse(new Response('<!DOCTYPE html><title>Private gateway detail</title>', { status })), error => {
      assert.equal(error.status, status);
      assert.equal(error.code, 'BAD_SERVER_RESPONSE');
      assert.match(error.message, new RegExp(`HTTP ${status}`));
      assert.doesNotMatch(error.message, /DOCTYPE|Private gateway|Unexpected token/);
      return true;
    });
  }
});

test('API errors preserve access status and group choices; success returns real counts', async () => {
  for (const status of [401, 403, 502]) {
    const data = { error: 'Unavailable', code: 'TEST', groups: [{ id: 'fc1', label: 'FC 1' }] };
    await assert.rejects(readApiResponse(Response.json(data, { status })), error => {
      assert.equal(error.status, status); assert.deepEqual(error.data, data); return true;
    });
  }
  assert.deepEqual(await readApiResponse(Response.json({ total: 0, employees: [] })), { total: 0, employees: [] });
});

test('aborted JSON reads keep timeout semantics', async () => {
  const aborted = new DOMException('aborted', 'AbortError');
  await assert.rejects(readApiResponse({ status: 200, json: async () => { throw aborted; } }), error => error === aborted);
});

test('container diagnostics separate token, address, scope and transport failures without leaking data', async () => {
  const cases = [
    [() => new Response('private error', { status: 401 }), 'ATTENDANCE_AUTH_FAILED'],
    [() => new Response('private error', { status: 500 }), 'ATTENDANCE_HTTP_ERROR'],
    [() => new Response('<!DOCTYPE html>private page'), 'ATTENDANCE_NOT_JSON'],
    [() => Response.json({ connection_scope: 'admin', employees: [] }), 'ATTENDANCE_SCOPE_INVALID'],
    [() => { throw new TypeError('fetch failed'); }, 'ATTENDANCE_CONNECTION_FAILED'],
    [() => { throw new DOMException('private details', 'TimeoutError'); }, 'ATTENDANCE_TIMEOUT'],
    [() => Response.json({ connection_scope: 'integration', employees: [{ name: 'Private employee' }] }), 'ATTENDANCE_SOURCE_OK'],
  ];
  for (const [fetcher, code] of cases) {
    const result = await diagnoseAttendance(env, fetcher);
    assert.equal(result.code, code);
    assert.equal(result.ok, code === 'ATTENDANCE_SOURCE_OK');
    assert.doesNotMatch(JSON.stringify(result), /private-test-token|Private employee|private page|private details|http:\/\/attendance/);
  }
  assert.equal((await diagnoseAttendance({})).code, 'ATTENDANCE_NOT_CONFIGURED');
  assert.equal((await diagnoseAttendance({ ...env, ATTENDANCE_GROUPS: 'bad' })).code, 'ATTENDANCE_CONFIG_INVALID');
});
