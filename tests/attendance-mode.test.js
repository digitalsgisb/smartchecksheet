import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore, hashPassword } from '../server/store.js';
import { seedState } from '../server/seed.js';

test('attendance mode hides persisted samples, disables simulation and keeps accounts and stored records', { timeout: 20000 }, async t => {
  const folder = mkdtempSync(join(tmpdir(), 'checksheet-attendance-test-'));
  const path = join(folder, 'test.sqlite');
  const db = openStore(path);
  const saved = JSON.stringify(seedState(true));
  db.prepare('INSERT INTO state VALUES(?,?)').run('ABB2', saved);
  db.prepare('INSERT INTO users(id,username,name,role,lines,password) VALUES(?,?,?,?,?,?)').run('dev', 'developer', 'Developer', 'developer', '["ABB2"]', hashPassword('Attendance-test-12345'));
  db.close();
  const port = 41000 + Math.floor(Math.random() * 1000);
  const child = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, APP_MODE: 'attendance', DATABASE_PATH: path, HOST: '127.0.0.1', PORT: String(port), ADMIN_USERNAME: 'developer', ATTENDANCE_GROUPS: '[]', ATTENDANCE_TOKEN: '', ATTENDANCE_API_URL: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(async () => {
    if (child.exitCode === null) { const closed = once(child, 'exit'); child.kill(); await closed; }
    rmSync(folder, { recursive: true, force: true });
  });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Startup timed out')), 8000);
    child.stdout.on('data', chunk => { if (String(chunk).includes('Production Digital (attendance)')) { clearTimeout(timeout); resolve(); } });
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('exit', code => { clearTimeout(timeout); reject(new Error(`Server exited: ${code}`)); });
  });
  const base = `http://127.0.0.1:${port}/api`;
  assert.equal((await fetch(`${base}/auth/demo`, { method: 'POST' })).status, 404);
  assert.deepEqual(await (await fetch(`${base}/config`)).json(), { mode: 'attendance', demo: false });
  const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'developer', password: 'Attendance-test-12345' }) });
  assert.equal(login.status, 200);
  const headers = { Cookie: login.headers.get('set-cookie').split(';')[0], 'Content-Type': 'application/json' };
  const state = await (await fetch(`${base}/state`, { headers })).json();
  assert.equal(state.shift, null); assert.equal(state.setup, null); assert.equal(state.live.shiftActual, 0); assert.equal(state.connected, true); assert.equal(state.machineConnected, false);
  assert.deepEqual(state.models, []); assert.deepEqual(state.people.operators, []);
  for (const key of ['hourly', 'rejects', 'parameters', 'downtime', 'issues', 'reports', 'commands']) assert.deepEqual(state[key], []);
  assert.equal(state.timer.status, 'idle');
  assert.equal((await fetch(`${base}/actions/henkaten`, { method: 'POST', headers, body: '{}' })).status, 400);
  assert.equal((await fetch(`${base}/actions/henkaten`, { method: 'POST', headers, body: JSON.stringify({ category: 'machine', status: 'NG', issue: 'Actual inspection', action: 'Inspect machine' }) })).status, 200);
  assert.equal((await fetch(`${base}/users`, { headers })).status, 200);
  assert.equal((await fetch(`${base}/users`, { method: 'POST', headers, body: JSON.stringify({ username: 'abb3', name: 'Test', password: 'Operator-test-12345', role: 'operator', lines: ['ABB2'] }) })).status, 201);
  const stored = openStore(path);
  try { assert.equal(stored.prepare('SELECT value FROM state WHERE line=?').get('ABB2').value, saved); }
  finally { stored.close(); }
});
