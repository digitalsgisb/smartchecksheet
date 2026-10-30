import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore, hashPassword, digest } from '../server/store.js';
import { sessionCookieMaxAge } from '../server/sessionPolicy.js';

test('persistent sessions upgrade active logins, survive restarts and renew cookies for every role', { timeout: 25000 }, async t => {
  const folder = mkdtempSync(join(tmpdir(), 'checksheet-session-'));
  const path = join(folder, 'sessions.sqlite');
  const db = openStore(path);
  const password = 'Persistent-session-test-12345';
  for (const role of ['developer', 'operator', 'display']) db.prepare('INSERT INTO users(id,username,name,role,lines,password) VALUES(?,?,?,?,?,?)').run(role, role, role, role, '["ABB2"]', hashPassword(password));
  db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(digest('active-legacy-token'), 'operator', Date.now() + 60000);
  db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(digest('expired-legacy-token'), 'operator', Date.now() - 60000);
  db.close();
  const port = 48000 + Math.floor(Math.random() * 1000);
  const base = `http://127.0.0.1:${port}/api`;
  let child;
  async function stop() { if (child?.exitCode === null) { const done = once(child, 'exit'); child.kill(); await done; } }
  async function start() {
    child = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), DATABASE_PATH: path, APP_MODE: 'attendance', ADMIN_USERNAME: 'developer', ATTENDANCE_GROUPS: '[]', ATTENDANCE_TOKEN: '', ATTENDANCE_API_URL: '', COOKIE_SECURE: 'false' }, stdio: ['ignore', 'pipe', 'pipe'] });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Startup timed out')), 8000);
      child.stdout.on('data', data => { if (String(data).includes('Production Digital (attendance)')) { clearTimeout(timer); resolve(); } });
      child.once('error', e => { clearTimeout(timer); reject(e); });
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`Server exited ${code}`)); });
    });
  }
  t.after(async () => { await stop(); rmSync(folder, { recursive: true, force: true }); });
  await start();
  const me = cookie => fetch(`${base}/auth/me`, { headers: { Cookie: cookie } });
  assert.equal((await me('pd_session=active-legacy-token')).status, 200);
  assert.equal((await me('pd_session=expired-legacy-token')).status, 401);
  const cookies = [];
  for (const role of ['developer', 'operator', 'display']) {
    const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: role, password }) });
    assert.equal(login.status, 200);
    const header = login.headers.get('set-cookie');
    assert.match(header, /HttpOnly; SameSite=Lax; Path=\//);
    assert.ok(header.includes(`Max-Age=${sessionCookieMaxAge}`));
    const cookie = header.split(';')[0]; cookies.push(cookie);
    const renewed = await me(cookie);
    assert.equal(renewed.status, 200);
    assert.equal(renewed.headers.get('set-cookie'), header);
  }
  await stop();
  const saved = openStore(path);
  assert.equal(saved.prepare('SELECT expires FROM sessions WHERE token=?').get(digest('active-legacy-token')).expires, 0);
  for (const cookie of cookies) assert.equal(saved.prepare('SELECT expires FROM sessions WHERE token=?').get(digest(cookie.slice('pd_session='.length))).expires, 0);
  saved.close();
  await start();
  for (const cookie of cookies) assert.equal((await me(cookie)).status, 200);
  assert.equal((await me('pd_session=expired-legacy-token')).status, 401);
  const logout = await fetch(`${base}/auth/logout`, { method: 'POST', headers: { Cookie: cookies[1], 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(logout.status, 200); assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal((await me(cookies[1])).status, 401);
  assert.equal((await me(cookies[0])).status, 200);
});
