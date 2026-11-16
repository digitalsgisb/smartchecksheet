import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { liveConfigs, lineCodePattern } from '../server/machineConfig.js';

const catalog = { models: [{ name: 'Model', cycle: 1, pcsHr: 60, slabWidth: 1, slabLength: 1 }], people: { supervisors: ['S'], leaders: ['L'], operators: ['A'], quality: ['Q'] } };

function configs(entries, env = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'line-config-'));
  try {
    writeFileSync(join(dir, 'catalog.json'), JSON.stringify(catalog));
    writeFileSync(join(dir, 'machines.json'), JSON.stringify(entries.map(entry => ({ catalogPath: 'catalog.json', ...entry }))));
    return liveConfigs({ MACHINE_CONNECTIONS_PATH: join(dir, 'machines.json'), ...env });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('a site can define any lines: ABB and Sendayan lines, with their own broker settings', () => {
  const result = configs([{ line: 'SDY1', mqttUrl: 'mqtt://10.0.0.1:1883' }, { line: 'SDY2', mqttUrl: 'mqtt://10.0.0.2:1883', productionLine: 'Sendayan Line 2' }], { SDY1_MQTT_PASSWORD: 'secret-1', SDY2_INGEST_TOKEN: 'token-2' });
  assert.deepEqual([...result.keys()], ['SDY1', 'SDY2']);
  assert.equal(result.get('SDY1').productionLine, 'SDY1');
  assert.equal(result.get('SDY2').productionLine, 'Sendayan Line 2');
  assert.equal(result.get('SDY1').password, 'secret-1');
  assert.equal(result.get('SDY2').ingestToken, 'token-2');
});

test('line codes are validated and every line needs its own broker', () => {
  for (const line of ['sdy1', 'S', 'SDY-1', 'TOOLONGLINE', '1ABB', 'SDY 1']) assert.equal(lineCodePattern.test(line), false, line);
  assert.throws(() => configs([{ line: 'sdy1', mqttUrl: 'mqtt://10.0.0.1:1883' }]), /line code/);
  assert.throws(() => configs([{ line: 'SDY1', mqttUrl: 'mqtt://10.0.0.1:1883' }, { line: 'SDY2', mqttUrl: 'mqtt://10.0.0.1:1883' }]), /separate broker/);
  assert.throws(() => configs([{ line: 'SDY1', mqttUrl: 'mqtt://10.0.0.1:1883' }, { line: 'SDY1', mqttUrl: 'mqtt://10.0.0.2:1883' }]), /twice/);
});

async function server(env) {
  const port = 39000 + Math.floor(Math.random() * 1000);
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['server/index.js'], { cwd: process.cwd(), env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATABASE_PATH: ':memory:', APP_MODE: 'attendance', ADMIN_USERNAME: 'developer', ADMIN_PASSWORD: 'Test-password-123456', ATTENDANCE_GROUPS: '[]', ...env } });
  let output = '';
  child.stderr.on('data', data => { output += data; });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Server startup timeout. ' + output)), 8000);
    child.stdout.on('data', data => { if (String(data).includes('Production Digital')) { clearTimeout(timer); resolve(); } });
    child.on('exit', () => { clearTimeout(timer); reject(new Error('Server exited. ' + output)); });
  });
  const login = async (username, password) => {
    const response = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
    return { status: response.status, data: await response.json(), cookie: (response.headers.get('set-cookie') || '').split(';')[0] };
  };
  return { child, base, login };
}

test('PRODUCTION_LINES defines the site lines and the developer account receives exactly those', { timeout: 30000 }, async t => {
  const { child, base, login } = await server({ PRODUCTION_LINES: 'SDY1,SDY2' });
  t.after(() => child.kill());
  const session = await login('developer', 'Test-password-123456');
  assert.equal(session.status, 200);
  assert.deepEqual(session.data.user.lines, ['SDY1', 'SDY2']);
  const state = await fetch(base + '/api/state?line=SDY2', { headers: { Cookie: session.cookie } });
  assert.equal(state.status, 200);
  assert.equal((await fetch(base + '/api/state?line=ABB2', { headers: { Cookie: session.cookie } })).status, 403);
});

test('an invalid PRODUCTION_LINES value stops the server with a clear message', { timeout: 30000 }, async () => {
  await assert.rejects(server({ PRODUCTION_LINES: 'SDY 1' }), /PRODUCTION_LINES must be/);
});

test('wrong passwords lock only that account name, not every tablet behind one address', { timeout: 60000 }, async t => {
  const { child, login } = await server({});
  t.after(() => child.kill());
  for (let attempt = 0; attempt < 10; attempt++) assert.equal((await login('tablet-a', 'wrong-password')).status, 401);
  const locked = await login('tablet-a', 'wrong-password');
  assert.equal(locked.status, 429);
  assert.match(locked.data.error, /15 minutes/);
  assert.equal((await login('developer', 'Test-password-123456')).status, 200);
});
