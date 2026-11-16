import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

// End to end through the real server: sign-in, line access, the developer-only save and the line snapshot TVs read.
test('TV timers are saved per line by developers only and reach the line state', { timeout: 30000 }, async t => {
  const port = 41000 + Math.floor(Math.random() * 1000), base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['server/index.js'], { cwd: process.cwd(), env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATABASE_PATH: ':memory:', APP_MODE: 'demo', ADMIN_PASSWORD: 'Test-password-123456', ADMIN_USERNAME: 'developer', ATTENDANCE_GROUPS: JSON.stringify([{ id: 'fc1', label: 'FC Line 1', lines: ['FC'], assignment: 'fc1', accountLines: ['ABB2'] }, { id: 'fc3', label: 'FC Line 3', lines: ['FC'], assignment: 'fc3', accountLines: ['ABB3'] }]), ATTENDANCE_API_URL: '', ATTENDANCE_TOKEN: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let errors = ''; child.stderr.on('data', data => { errors += String(data); });
  await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Server startup timeout')), 8000); child.stdout.on('data', data => { if (String(data).includes('Production Digital (demo)')) { clearTimeout(timer); resolve(); } }); child.on('exit', code => { if (code) { clearTimeout(timer); reject(new Error(`Server exited ${code}: ${errors}`)); } }); });
  t.after(() => child.kill());
  async function call(path, body, cookie, method = 'POST') { const r = await fetch(`${base}/api${path}`, { method: body === undefined ? 'GET' : method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: r.status, data: await r.json(), cookie: r.headers.get('set-cookie')?.split(';')[0] }; }
  const developer = (await call('/auth/login', { username: 'developer', password: 'Test-password-123456' })).cookie;
  assert.deepEqual([(await call('/state?line=ABB3', undefined, developer)).data.tvTimers.henkaten, (await call('/state?line=ABB3', undefined, developer)).data.tvTimers.oee], [30, 60], 'defaults before any save');
  const saved = await call('/tv-timers?line=ABB3', { timers: { henkaten: 20, live: 45, oee: 90 } }, developer, 'PUT');
  assert.equal(saved.status, 200);
  const state = (await call('/state?line=ABB3', undefined, developer)).data.tvTimers;
  assert.deepEqual([state.henkaten, state.live, state.oee, state.updatedBy], [20, 45, 90, saved.data.updatedBy]);
  assert.equal((await call('/state?line=ABB2', undefined, developer)).data.tvTimers.henkaten, 30, 'other lines unchanged');
  assert.equal((await call('/tv-timers?line=ABB3', { timers: { henkaten: 2, live: 45, oee: 90 } }, developer, 'PUT')).status, 400);
  assert.equal((await call('/users', { name: 'Line manager', username: 'line-manager', password: 'Manager-test-123456', role: 'management', lines: ['ABB3'] }, developer)).status < 300, true);
  const manager = (await call('/auth/login', { username: 'line-manager', password: 'Manager-test-123456' })).cookie;
  assert.equal((await call('/tv-timers?line=ABB3', { timers: { henkaten: 10, live: 10, oee: 10 } }, manager, 'PUT')).status, 403);
  assert.equal((await call('/tv-timers?line=ABB3', { timers: { henkaten: 10, live: 10, oee: 10 } }, undefined, 'PUT')).status, 401);
});
