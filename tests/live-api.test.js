import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('live API routes line-scoped ingestion, accounts and offline actions without exposing credentials', { timeout: 30000 }, async t => {
  const folder = mkdtempSync(join(tmpdir(), 'live-api-'));
  const lines = ['ABB2', 'ABB3', 'ABB7'];
  const catalog = { models: [{ name: 'Test model', cycle: 1, pcsHr: 60, slabWidth: 100, slabLength: 200 }], people: { supervisors: ['S'], leaders: ['L'], operators: ['A', 'B', 'C'], quality: ['Q'] } };
  writeFileSync(join(folder, 'catalog.json'), JSON.stringify(catalog));
  const configs = lines.map((line, i) => ({ line, mqttUrl: `mqtt://127.0.0.1:${19001 + i}`, catalogPath: 'catalog.json' }));
  const configFile = join(folder, 'machines.json');
  writeFileSync(configFile, JSON.stringify(configs));
  const port = 45000 + Math.floor(Math.random() * 1000);
  const base = `http://127.0.0.1:${port}/api`;
  const child = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, APP_MODE: 'live', MACHINE_CONNECTIONS_PATH: configFile, DATABASE_PATH: join(folder, 'production.sqlite'), HOST: '127.0.0.1', PORT: String(port), ADMIN_USERNAME: 'developer', ADMIN_PASSWORD: 'Live-test-password-12345', ABB2_INGEST_TOKEN: 'private-ABB2-token', ABB3_INGEST_TOKEN: 'private-ABB3-token', ABB7_INGEST_TOKEN: 'private-ABB7-token', ATTENDANCE_GROUPS: '[]', ATTENDANCE_TOKEN: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let errors = '';
  child.stderr.on('data', chunk => { errors += String(chunk); });
  t.after(async () => {
    if (child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; }
    rmSync(folder, { recursive: true, force: true });
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Startup timed out: ' + errors)), 8000);
    child.stdout.on('data', chunk => { if (String(chunk).includes('Production Digital (live)')) { clearTimeout(timer); resolve(); } });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Exited ${code}: ${errors}`)); });
    child.once('error', reject);
  });
  const login = await fetch(base + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'developer', password: 'Live-test-password-12345' }) });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  assert.deepEqual((await login.json()).user.lines, lines);
  for (const line of lines) {
    const response = await fetch(`${base}/state?line=${line}`, { headers: { Cookie: cookie } });
    const state = await response.json();
    assert.equal(state.mode, 'live'); assert.equal(state.line, line); assert.equal(state.connected, false);
    assert.ok(!JSON.stringify(state).includes('private-'));
    const offline = await fetch(`${base}/actions/mode?line=${line}`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'REST' }) });
    assert.match((await offline.json()).error, new RegExp(line + ' Python is disconnected'));
    const envelope = { line_code: line, event_id: 'common-event-id', event_type: 'reject.recorded', shift_id: 'old-shift', payload: { ng_quantity: 1 } };
    async function send(token, body = envelope) {
      return fetch(base + '/integrations/events', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    }
    assert.equal((await send('wrong')).status, 401);
    const other = lines.find(value => value !== line);
    assert.equal((await send('private-' + other + '-token')).status, 401);
    assert.equal((await send('private-' + line + '-token')).status, 200);
    assert.equal((await (await send('private-' + line + '-token')).json()).duplicate, true);
    assert.equal((await send('private-' + line + '-token', { ...envelope, event_id: 'bad', payload: [] })).status, 400);
  }
  const health = await (await fetch(base + '/health')).json();
  assert.deepEqual(Object.keys(health.machines), lines);
});
