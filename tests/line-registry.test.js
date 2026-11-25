import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { createLineRegistry } from '../server/lineRegistry.js';

const key = 'k'.repeat(40);
const reply = () => ({ code: 200, headers: {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; }, setHeader(name, value) { this.headers[name] = value; }, send(body) { this.body = body; return this; } });
const developer = { role: 'developer', name: 'Dev' };
function setup(env = { CHECKSHEET_SECRET_KEY: key }, extra = {}) {
  const db = new DatabaseSync(':memory:'), changes = [];
  const registry = createLineRegistry({ db, env, fileLines: () => ['ABB2'], onMachineChange: line => changes.push(line), ...extra });
  const call = (name, req) => { const res = reply(); registry[name]({ user: developer, params: {}, query: {}, body: {}, protocol: 'http', headers: { host: '192.168.1.10:3700' }, ...req }, res); return res; };
  return { db, registry, call, changes };
}
const pi = { host: '192.168.1.50', username: 'checksheet', password: 'broker-secret-1', productionLine: 'L4' };

test('only developers add lines, codes are validated and duplicates refused', () => {
  const { registry, call } = setup();
  const res = reply(); registry.addLine({ user: { role: 'admin', name: 'A' }, body: { line: 'ABB4', groupId: 'conversion-port-klang' } }, res); assert.equal(res.code, 403);
  assert.equal(call('addLine', { body: { line: 'line 4', groupId: 'conversion-port-klang' } }).code, 400);
  assert.equal(call('addLine', { body: { line: 'abb4', groupId: 'conversion-port-klang' } }).body.line, 'ABB4');
  assert.equal(call('addLine', { body: { line: 'ABB4', groupId: 'conversion-port-klang' } }).code, 409);
  assert.equal(call('addLine', { body: { line: 'ABB2', groupId: 'conversion-port-klang' } }).code, 409);
  assert.deepEqual(registry.lines(), ['ABB4']);
});

test('a new line must name its plant, which is saved with the line', () => {
  const { db, registry, call } = setup();
  assert.equal(call('addLine', { body: { line: 'LM' } }).code, 400);
  assert.equal(call('addLine', { body: { line: 'LM', groupId: 'nowhere' } }).code, 400);
  assert.deepEqual(registry.lines(), [], 'a refused line is not half-added');
  const added = call('addLine', { body: { line: 'LM', groupId: 'conversion-port-klang' } });
  assert.equal(added.code, 200); assert.equal(added.body.group.site, 'Port Klang');
  assert.deepEqual(db.prepare('SELECT * FROM production_line_groups').all().map(row => ({ ...row })), [{ line: 'LM', group_id: 'conversion-port-klang' }]);
  assert.equal(registry.groupOf('LM').label, 'Conversion · Port Klang'); assert.equal(registry.groupOf('ABB2'), null);
});

test('a connected Pi becomes a live machine config with encrypted secrets that are never returned', () => {
  const { db, registry, call, changes } = setup();
  call('addLine', { body: { line: 'ABB4', groupId: 'conversion-port-klang' } });
  const saved = call('saveMachine', { params: { line: 'ABB4' }, body: pi });
  assert.equal(saved.code, 200); assert.deepEqual(changes, ['ABB4']);
  assert.doesNotMatch(JSON.stringify(saved.body), /broker-secret-1/);
  const stored = JSON.stringify(db.prepare('SELECT * FROM line_machines').all());
  assert.doesNotMatch(stored, /broker-secret-1/);
  const config = registry.machines().get('ABB4');
  assert.equal(config.mqttUrl, 'mqtt://192.168.1.50:1883'); assert.equal(config.password, 'broker-secret-1'); assert.equal(config.productionLine, 'L4');
  assert.match(config.ingestToken, /^[0-9a-f]{48}$/); assert.equal(config.requireLineCode, true); assert.equal(config.people, null);
  // Editing without a password keeps the old password and the relay token, so the installed Pi keeps working.
  call('saveMachine', { params: { line: 'ABB4' }, body: { ...pi, password: '', host: '192.168.1.51' } });
  const edited = registry.machines().get('ABB4');
  assert.equal(edited.password, 'broker-secret-1'); assert.equal(edited.ingestToken, config.ingestToken); assert.equal(edited.mqttUrl, 'mqtt://192.168.1.51:1883');
});

test('connection input is validated and each line needs its own Pi broker', () => {
  const { call } = setup(undefined, { fileMachines: new Map([['ABB2', { line: 'ABB2', mqttUrl: 'mqtt://192.168.1.60:1883', productionLine: 'Line 1' }]]) });
  call('addLine', { body: { line: 'ABB4', groupId: 'conversion-port-klang' } }); call('addLine', { body: { line: 'ABB5', groupId: 'conversion-port-klang' } });
  assert.equal(call('saveMachine', { params: { line: 'ABB4' }, body: { ...pi, host: 'http://x' } }).code, 400);
  assert.equal(call('saveMachine', { params: { line: 'ABB4' }, body: { ...pi, password: '' } }).code, 400);
  assert.equal(call('saveMachine', { params: { line: 'ABB4' }, body: { ...pi, productionLine: '' } }).code, 400);
  assert.equal(call('saveMachine', { params: { line: 'ABB4' }, body: { ...pi, port: 70000 } }).code, 400);
  assert.equal(call('saveMachine', { params: { line: 'ABB9' }, body: pi }).code, 404);
  assert.match(call('saveMachine', { params: { line: 'ABB4' }, body: { ...pi, host: '192.168.1.60' } }).body.error, /ABB2 already uses/);
  assert.equal(call('saveMachine', { params: { line: 'ABB2' }, body: pi }).code, 409);
  assert.equal(call('saveMachine', { params: { line: 'ABB4' }, body: pi }).code, 200);
  assert.match(call('saveMachine', { params: { line: 'ABB5' }, body: pi }).body.error, /ABB4 already uses/);
});

test('without CHECKSHEET_SECRET_KEY nothing is saved and saved lines stay manual', () => {
  const { db, call } = setup();
  call('addLine', { body: { line: 'ABB4', groupId: 'conversion-port-klang' } }); call('saveMachine', { params: { line: 'ABB4' }, body: pi });
  const keyless = createLineRegistry({ db, env: {} });
  assert.equal(keyless.machines().size, 0);
  assert.equal(keyless.settings('ABB4').readable, false);
  const res = reply(); keyless.saveMachine({ user: developer, params: { line: 'ABB4' }, body: pi }, res); assert.equal(res.code, 503);
});

test('the Pi installer is one script carrying the relay files and this line\'s token', () => {
  const { registry, call } = setup();
  call('addLine', { body: { line: 'ABB4', groupId: 'conversion-port-klang' } });
  assert.equal(call('downloadInstaller', { params: { line: 'ABB4' } }).code, 409);
  call('saveMachine', { params: { line: 'ABB4' }, body: pi });
  assert.equal(call('downloadInstaller', { params: { line: 'ABB4' }, query: { server: 'ftp://x' } }).code, 400);
  const res = call('downloadInstaller', { params: { line: 'ABB4' } });
  assert.equal(res.code, 200); assert.match(res.headers['Content-Disposition'], /install-pi-ABB4\.sh/);
  const blocks = Object.fromEntries([...res.body.matchAll(/base64 -d > "\$dir\/([^"]+)" <<'SMARTCHECKSHEET_FILE'\n([\s\S]*?)\nSMARTCHECKSHEET_FILE/g)].map(([, name, data]) => [name, Buffer.from(data.replaceAll('\n', ''), 'base64').toString()]));
  assert.deepEqual(Object.keys(blocks).sort(), ['checksheet-relay@.service', 'checksheet_event_relay.py', 'install.sh', 'relay.env']);
  assert.match(blocks['relay.env'], new RegExp(`CHECKSHEET_LINE=ABB4\\nCHECKSHEET_SQLITE_PATH=\\nCHECKSHEET_EVENTS_URL=http://192.168.1.10:3700/api/integrations/events\\nCHECKSHEET_TOKEN=${registry.machines().get('ABB4').ingestToken}\\n`));
  assert.match(blocks['install.sh'], /Connect one line's Raspberry Pi/);
});

test('lines are removed only when added in the app and no Pi is connected', () => {
  const { registry, call } = setup();
  call('addLine', { body: { line: 'ABB4', groupId: 'conversion-port-klang' } }); call('saveMachine', { params: { line: 'ABB4' }, body: pi });
  assert.equal(call('removeLine', { params: { line: 'ABB2' } }).code, 409);
  assert.equal(call('removeLine', { params: { line: 'ABB4' } }).code, 409);
  assert.equal(call('removeMachine', { params: { line: 'ABB4' } }).code, 200);
  assert.equal(registry.machines().size, 0);
  assert.equal(call('removeLine', { params: { line: 'ABB4' } }).code, 200);
  assert.deepEqual(registry.lines(), []);
});

test('a line added and connected in the app works without a restart', { timeout: 30000 }, async t => {
  const port = 41000 + Math.floor(Math.random() * 1000), base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['server/index.js'], { cwd: process.cwd(), env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATABASE_PATH: ':memory:', APP_MODE: 'attendance', ADMIN_PASSWORD: 'Test-password-123456', ADMIN_USERNAME: 'developer', CHECKSHEET_SECRET_KEY: key, PRODUCTION_LINES: 'ABB2', MACHINE_CONNECTIONS_PATH: '', MQTT_URL: '' } });
  await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Server startup timeout')), 8000); child.stdout.on('data', data => { if (String(data).includes('Production Digital (attendance)')) { clearTimeout(timer); resolve(); } }); child.on('exit', code => reject(new Error('Server exited ' + code))); });
  t.after(() => child.kill());
  const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'developer', password: 'Test-password-123456' }) });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const call = async (path, body, method = 'POST') => { const r = await fetch(`${base}/api${path}`, { method: body === undefined ? 'GET' : method, headers: { Cookie: cookie, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: r.status, data: r.headers.get('content-type')?.includes('json') ? await r.json() : await r.text() }; };
  assert.equal((await call('/admin/lines', { line: 'ABB4', groupId: 'conversion-port-klang' })).status, 200);
  assert.ok((await call('/account-lines')).data.lines.includes('ABB4'));
  assert.ok((await call('/auth/me')).data.user.lines.includes('ABB4'), 'the developer account gets the new line at once');
  let card = (await call('/admin/machine-connections')).data.lines.find(item => item.line === 'ABB4');
  assert.equal(card.status, 'manual');
  assert.equal(card.plant, 'Conversion · Port Klang', 'the line card shows the plant chosen when the line was added');
  assert.equal((await call('/admin/lines/ABB4/machine', { ...pi, host: '127.0.0.1', port: 1 }, 'PUT')).status, 200);
  card = (await call('/admin/machine-connections')).data.lines.find(item => item.line === 'ABB4');
  assert.equal(card.configured, true); assert.equal(card.settings.productionLine, 'L4'); assert.doesNotMatch(JSON.stringify(card), /broker-secret-1/);
  const script = (await call('/admin/lines/ABB4/pi-installer?server=' + encodeURIComponent(base))).data;
  const env = Buffer.from(script.match(/relay\.env" <<'SMARTCHECKSHEET_FILE'\n([\s\S]*?)\nSMARTCHECKSHEET_FILE/)[1].replaceAll('\n', ''), 'base64').toString();
  const token = env.match(/CHECKSHEET_TOKEN=(\w+)/)[1];
  const post = auth => fetch(`${base}/api/integrations/events`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: auth }, body: JSON.stringify({ line_code: 'ABB4' }) });
  assert.equal((await post('Bearer wrong')).status, 401);
  assert.notEqual((await post('Bearer ' + token)).status, 401, 'the relay token from the installer is accepted');
  const beat = await fetch(`${base}/api/integrations/events`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ line_code: 'ABB4', event_type: 'relay.heartbeat', payload: { waiting: 12, refused: 0, last_error: '' } }) });
  assert.deepEqual(await beat.json(), { ok: true });
  card = (await call('/admin/machine-connections')).data.lines.find(item => item.line === 'ABB4');
  assert.equal(card.relay.waiting, 12); assert.equal(card.relay.healthy, true); assert.equal(card.relay.lastEventAt, null, 'a heartbeat is not a delivered event');
  assert.equal((await call('/admin/lines/ABB4/machine', {}, 'DELETE')).status, 200);
  assert.equal((await post('Bearer ' + token)).status, 401, 'a disconnected line no longer accepts relay events');
  assert.equal((await call('/admin/machine-connections')).data.lines.find(item => item.line === 'ABB4').status, 'manual');
});

test('the Google Sheets link is validated, saved per line, and sent to a live Pi', async () => {
  const published = [];
  const { registry } = setup(undefined, { publishSettings: async (line, settings) => { published.push([line, settings.googleWebAppUrl]); return line === 'ABB2'; } });
  const save = async (line, googleWebAppUrl, user = developer) => { const res = reply(); await registry.saveSheetsUrl({ user, params: { line }, body: { googleWebAppUrl } }, res); return res; };
  const url = 'https://script.google.com/macros/s/AKfycbTESTDEPLOYMENT123/exec';
  assert.equal((await save('ABB2', url, { role: 'admin', name: 'A' })).code, 403);
  assert.equal((await save('ABB2', 'http://example.com/exec')).code, 400);
  assert.equal((await save('ABB2', 'https://script.google.com/macros/s/AKfycbTESTDEPLOYMENT123/dev')).code, 400);
  assert.equal((await save('NOPE', url)).code, 404);
  const saved = await save('ABB2', url);
  assert.equal(saved.code, 200); assert.equal(saved.body.sent, true); assert.equal(saved.body.piSettings.googleWebAppUrl, url);
  assert.equal(registry.piSettings('ABB2').updatedBy, 'Dev');
  assert.equal((await save('ABB2', 'https://script.google.com/a/macros/example.com/s/AKfycbTESTDEPLOYMENT123/exec')).code, 200);
  const cleared = await save('ABB2', '');
  assert.equal(cleared.code, 200); assert.equal(registry.piSettings('ABB2').googleWebAppUrl, '');
  assert.deepEqual(published.map(([line]) => line), ['ABB2', 'ABB2', 'ABB2']);
});
