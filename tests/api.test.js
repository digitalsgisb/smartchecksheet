import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

test('workspace API protects access and syncs real saved records', { timeout: 30000 }, async t => {
  const port = 39000 + Math.floor(Math.random() * 1000);
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['server/index.js'], { cwd: process.cwd(), env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATABASE_PATH: ':memory:', APP_MODE: 'demo', ADMIN_PASSWORD: 'Test-password-123456', ADMIN_USERNAME: 'developer', ATTENDANCE_GROUPS: JSON.stringify([{ id: 'fc1', label: 'FC Line 1', lines: ['FC'], assignment: 'fc1', accountLines: ['ABB2'] }, { id: 'fc3', label: 'FC Line 3', lines: ['FC'], assignment: 'fc3', accountLines: ['ABB3'] }, { id: 'mf', label: 'Mini Forming', lines: ['MF'], accountLines: ['ABB7'] }]), ATTENDANCE_API_URL: '', ATTENDANCE_TOKEN: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let startupErrors = ''; child.stderr.on('data', data => { startupErrors += String(data); });
  await new Promise((resolve, reject) => { const timeout = setTimeout(() => reject(new Error('Server startup timeout')), 8000); child.stdout.on('data', data => { if (String(data).includes('Production Digital (demo)')) { clearTimeout(timeout); resolve(); } }); child.on('error', reject); child.on('exit', code => { if (code) { clearTimeout(timeout); reject(new Error(`Server exited ${code}: ${startupErrors}`)); } }); });
  t.after(() => child.kill());
  let cookie = '';
  async function call(path, body, session = cookie, method = 'POST') { const r = await fetch(`${base}/api${path}`, { method: body === undefined ? 'GET' : method, headers: { ...(session ? { Cookie: session } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: r.status, data: await r.json(), cookie: r.headers.get('set-cookie')?.split(';')[0] }; }
  await t.test('anonymous access is denied with a recognizable missing-cookie reason', async () => { const response = await call('/state'); assert.equal(response.status, 401); assert.equal(response.data.code, 'SESSION_MISSING'); });
  await t.test('the recovery page bypasses old app shells without requiring a login or clearing cookies', async () => {
    const response = await fetch(`${base}/api/app-update`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/html/);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const html = await response.text();
    assert.match(html, /Reload latest app/);
    assert.match(html, /registration.unregister/);
    assert.doesNotMatch(html, /document.cookie|caches.delete|localStorage.clear/);
  });
  await t.test('attendance also requires a signed-in session', async () => { assert.equal((await call('/attendance')).status, 401); });
  await t.test('employee photos also require a signed-in session', async () => { assert.equal((await call('/attendance/photos/1?group=fc1')).status, 401); });
  await t.test('CMMS list, detail, photos and submission require Checksheet authentication', async () => {
    for (const path of ['/cmms/work-orders', '/cmms/work-orders/other', '/cmms/work-orders/other/photos/photo']) assert.equal((await call(path)).status, 401);
    assert.equal((await call('/cmms/work-orders', { requestId: 'invalid' })).status, 401);
    assert.equal((await call('/cmms/work-orders/job/verification', { status: 'closed' }, '', 'PATCH')).status, 401);
  });
  await t.test('login issues an HTTP-only session and returns a scoped account', async () => { const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'developer', password: 'Test-password-123456' }) }); assert.match(r.headers.get('set-cookie'), /HttpOnly/); cookie = r.headers.get('set-cookie').split(';')[0]; assert.equal((await r.json()).user.role, 'developer'); });
  await t.test('bootstrap administrator has every configured account line', async () => {
    const { data } = await call('/auth/me');
    assert.deepEqual(data.user.lines, ['ABB2', 'ABB3', 'ABB7']);
    assert.deepEqual(data.user.lines, (await call('/account-lines')).data.lines);
    assert.equal((await call('/users')).status, 200);
  });
  await t.test('unconfigured CMMS shows setup required and rejects unauthorized lines', async () => {
    assert.equal((await call('/cmms/work-orders')).status, 503);
    assert.equal((await call('/cmms/work-orders?line=unassigned')).status, 403);
  });
  await t.test('one account can remain signed in on a PC and tablet independently', async () => {
    const tablet = await call('/auth/login', { username: 'developer', password: 'Test-password-123456' }, '');
    assert.equal(tablet.status, 200);
    assert.notEqual(tablet.cookie, cookie);
    assert.equal((await call('/auth/me', undefined, cookie)).status, 200);
    assert.equal((await call('/auth/me', undefined, tablet.cookie)).status, 200);
    await call('/auth/logout', {}, tablet.cookie);
    assert.equal((await call('/auth/me', undefined, tablet.cookie)).status, 401);
    assert.equal((await call('/auth/me', undefined, cookie)).status, 200);
  });
  await t.test('browser navigation cookies remain HTTP-only and invalid sessions are identifiable', async () => {
    const response = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'developer', password: 'Test-password-123456' }) });
    assert.match(response.headers.get('set-cookie'), /HttpOnly; SameSite=Lax; Path=\//);
    const invalid = await call('/auth/me', undefined, 'pd_session=revoked');
    assert.equal(invalid.status, 401);
    assert.equal(invalid.data.code, 'SESSION_INVALID');
  });
  await t.test('new developers receive every configured line even when submitted with none', async () => {
    assert.equal((await call('/users', { name: 'All lines admin', username: 'all-lines-admin', password: 'Developer-test-12345', role: 'developer', lines: [] })).status, 201);
    const login = await call('/auth/login', { username: 'all-lines-admin', password: 'Developer-test-12345' }, '');
    assert.deepEqual(login.data.user.lines, ['ABB2', 'ABB3', 'ABB7']);
    assert.equal((await call('/state', undefined, login.cookie)).status, 200);
    const accounts = (await call('/users')).data;
    assert.deepEqual(accounts.find(user => user.username === 'all-lines-admin').lines, login.data.user.lines);
  });
  await t.test('negative rejects and missing OHT are rejected', async () => { assert.equal((await call('/actions/reject', { ng: -1, code: 'Test' })).status, 400); assert.equal((await call('/actions/reject', { returnRoll: 3, code: 'Test' })).status, 400); });
  await t.test('executive and unassigned accounts cannot write or cross line access', async () => {
    assert.equal((await call('/users', { name: 'Executive Test', username: 'executive', password: 'Executive-test-12345', role: 'executive', lines: ['ABB2'] })).status, 201);
    const executive = (await call('/auth/login', { username: 'executive', password: 'Executive-test-12345' }, '')).cookie;
    assert.equal((await call('/state', undefined, executive)).status, 200);
    assert.equal((await call('/actions/reject', { ng: 1, code: 'Test' }, executive)).status, 403);
    assert.equal((await call('/users', undefined, executive)).status, 403);
    await call('/users', { name: 'No line', username: 'unassigned', password: 'Unassigned-test-12345', role: 'operator', lines: [] });
    const unassigned = (await call('/auth/login', { username: 'unassigned', password: 'Unassigned-test-12345' }, '')).cookie;
    assert.equal((await call('/state', undefined, unassigned)).status, 403);
    assert.equal((await call('/attendance', undefined, unassigned)).status, 403);
  });
  await t.test('other configured line accounts can sign in without gaining ABB2 machine access', async () => {
    for (const line of ['ABB3', 'ABB7']) {
      const username = line.toLowerCase();
      assert.equal((await call('/users', { name: line, username, password: 'Line-account-test-12345', role: 'operator', lines: [line] })).status, 201);
      const accountCookie = (await call('/auth/login', { username, password: 'Line-account-test-12345' }, '')).cookie;
      const ownState = await call('/state', undefined, accountCookie);
      assert.equal(ownState.status, 200); assert.equal(ownState.data.line, line);
      assert.equal((await call('/state?line=ABB2', undefined, accountCookie)).status, 403);
      assert.equal((await call('/attendance', undefined, accountCookie)).status, 503); // Connection unset, rather than rejected as an ABB2-only account.
      assert.ok((await call('/account-lines', undefined, accountCookie)).data.lines.includes(line));
    }
    assert.equal((await call('/users', { name: 'Retired', username: 'retired', password: 'Line-account-test-12345', role: 'operator', lines: ['ABB4'] })).status, 400);
  });
  await t.test('two clients receive the same Henkaten change over SSE', async () => {
    const controllers = [new AbortController(), new AbortController()];
    const streams = await Promise.all(controllers.map(async controller => { const response = await fetch(`${base}/api/events`, { headers: { Cookie: cookie }, signal: controller.signal }); const reader = response.body.getReader(); await reader.read(); return reader; }));
    const next = streams.map(async reader => { for (let i = 0; i < 5; i++) { const chunk = new TextDecoder().decode((await reader.read()).value); if (chunk.includes('Two-device test issue')) return true; } return false; });
    assert.equal((await call('/actions/henkaten', { category: 'machine', status: 'NG', issue: 'Two-device test issue', action: 'Inspect equipment' })).status, 200);
    assert.deepEqual(await Promise.all(next), [true, true]); controllers.forEach(c => c.abort());
  });
  await t.test('verification is persisted and attributed to the signed-in account', async () => {
    assert.equal((await call('/actions/verify', { status: 'verified', remarks: 'Checked during API test' })).status, 200);
    const r = await call('/state'); assert.equal(r.data.verification.at(-1).remarks, 'Checked during API test'); assert.equal(r.data.verification.at(-1).actor, 'Developer');
  });
  await t.test('stale timer revisions are rejected; stopping and logging creates one record', async () => {
    const before = (await call('/state')).data; const p = { category: 'Machine', reason: 'Timer integration test', targetMinutes: 0, actionTaken: 'Equipment inspected', duration: 1 };
    assert.equal((await call('/actions/timer', { ...p, action: 'start', revision: before.timer.revision })).status, 200);
    assert.equal((await call('/actions/timer', { ...p, action: 'stop', revision: before.timer.revision })).status, 400);
    const running = (await call('/state')).data;
    assert.equal(running.timer.status, 'running'); assert.equal((await call('/actions/mode', { mode: 'REST' })).status, 400);
    await call('/actions/timer', { action: 'stop', revision: running.timer.revision });
    const stopped = (await call('/state')).data;
    assert.equal(stopped.live.mode, 'NORMAL');
    await call('/actions/timer', { ...p, action: 'log', revision: stopped.timer.revision });
    assert.equal((await call('/actions/timer', { ...p, action: 'log', revision: stopped.timer.revision })).status, 400);
    const after = (await call('/state')).data; assert.equal(after.timer.status, 'idle'); assert.equal(after.downtime.length, before.downtime.length + 1);
  });
  await t.test('PDF generation produces a versioned PDF served only to authenticated users', async () => {
    const r = await call('/actions/report', {}); assert.equal(r.status, 200); const id = r.data.reportId;
    const pdf = await fetch(`${base}/api/reports/${id}/pdf`, { headers: { Cookie: cookie } }); assert.equal(pdf.headers.get('content-type'), 'application/pdf');
    const bytes = Buffer.from(await pdf.arrayBuffer()); assert.equal(bytes.subarray(0, 5).toString(), '%PDF-'); assert.ok(bytes.length > 2000);
    assert.equal((await fetch(`${base}/api/reports/${id}/pdf`)).status, 401); assert.equal((await call('/state')).data.reports[0].id, id);
  });
  await t.test('disabling an account invalidates its existing session', async () => {
    const users = (await call('/users')).data; const executive = users.find(u => u.username === 'executive');
    const session = (await call('/auth/login', { username: 'executive', password: 'Executive-test-12345' }, '')).cookie;
    await call(`/users/${executive.id}`, { active: false }, cookie, 'PATCH'); assert.equal((await call('/state', undefined, session)).status, 401);
  });
  await t.test('cross-origin writes and logout-session reuse are rejected', async () => {
    const r = await fetch(`${base}/api/actions/henkaten`, { method: 'POST', headers: { Cookie: cookie, Origin: 'https://another-site.example', 'Content-Type': 'application/json' }, body: '{}' }); assert.equal(r.status, 403);
    await call('/auth/logout', {}); assert.equal((await call('/state')).status, 401);
  });
});
