import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { malaysiaDate, malaysiaHour } from '../server/domain.js';

test('each account line owns its checksheet, timers, 4M, streams and PDFs across a restart', { timeout: 30000 }, async t => {
  const folder = mkdtempSync(join(tmpdir(), 'checksheet-lines-'));
  const port = 43000 + Math.floor(Math.random() * 1000);
  const base = `http://127.0.0.1:${port}/api`;
  const lines = ['ABB2', 'ABB3', 'ABB7', 'ROLL MAKING'];
  const groups = lines.map((line, index) => ({ id: `group${index}`, label: line, lines: ['FC'], accountLines: [line] }));
  let child;
  const controllers = [];
  async function start() {
    child = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, APP_MODE: 'attendance', DATABASE_PATH: join(folder, 'test.sqlite'), HOST: '127.0.0.1', PORT: String(port), ADMIN_USERNAME: 'developer', ADMIN_PASSWORD: 'Multiline-test-12345', ATTENDANCE_GROUPS: JSON.stringify(groups), ATTENDANCE_API_URL: '', ATTENDANCE_TOKEN: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Startup timed out')), 8000);
      child.stdout.on('data', chunk => { if (String(chunk).includes('Production Digital (attendance)')) { clearTimeout(timer); resolve(); } });
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`Server exited ${code}`)); });
    });
  }
  async function stop() { if (child?.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; } }
  t.after(async () => { for (const controller of controllers) controller.abort(); await stop(); rmSync(folder, { recursive: true, force: true }); });
  await start();
  async function call(path, cookie, line, body) {
    const response = await fetch(`${base}${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...(cookie ? { Cookie: cookie } : {}), ...(line ? { 'X-Checksheet-Line': line } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  const admin = (await call('/auth/login', '', '', { username: 'developer', password: 'Multiline-test-12345' })).cookie;
  const accounts = new Map();
  for (const [index, line] of lines.entries()) {
    assert.equal((await call('/users', admin, '', { username: `line${index}`, name: line, role: 'operator', lines: [line], password: 'Line-test-password-12345' })).status, 201);
    const login = await call('/auth/login', '', '', { username: `line${index}`, password: 'Line-test-password-12345' });
    accounts.set(line, login.cookie);
    const initial = await call('/state', login.cookie);
    assert.equal(initial.status, 200); assert.equal(initial.data.line, line); assert.equal(initial.data.shift, null); assert.deepEqual(initial.data.models, []);
    for (const other of lines.filter(value => value !== line)) {
      assert.equal((await call(`/state?line=${encodeURIComponent(other)}`, login.cookie)).status, 403);
      assert.equal((await call('/actions/henkaten', login.cookie, other, { category: 'man', status: 'NG', issue: 'Forbidden', action: 'Forbidden' })).status, 403);
    }
  }
  assert.equal((await call('/state?line=ABB3', admin, 'ABB2')).status, 400);
  assert.equal((await call('/state?line=ABB4', admin)).status, 403);
  let date = malaysiaDate();
  const hour = malaysiaHour();
  const shift = hour >= 8 && hour < 20 ? 'Day' : 'Night';
  if (hour < 8) date = malaysiaDate(new Date(Date.now() - 86400000));
  await Promise.all(lines.map(async line => {
    const cookie = accounts.get(line);
    const result = await call('/actions/shift', cookie, line, { date, shift, overtime: true, supervisor: `Supervisor ${line}`, leader: `Leader ${line}`, forming: [`Forming ${line}`], waterjet: [`Waterjet ${line}`], assembly: [`Assembly ${line}`], quality: `Quality ${line}` });
    assert.equal(result.status, 200, JSON.stringify(result.data));
    assert.equal((await call('/actions/setup', cookie, line, { model: `Model ${line}`, lot: `Lot ${line}`, plan: 60, cycle: 1 })).status, 200);
    assert.equal((await call('/actions/adjust', cookie, line, { adjust: 1, reason: `Actual count ${line}` })).status, 200);
    assert.equal((await call('/actions/reject', cookie, line, { ng: 2, code: `Reject ${line}` })).status, 200);
    assert.equal((await call('/actions/henkaten', cookie, line, { category: 'machine', status: 'NG', issue: `Issue ${line}`, action: `Action ${line}` })).status, 200);
  }));
  const beforeEdit = (await call('/state', accounts.get('ABB3'), 'ABB3')).data;
  const payload = { ...beforeEdit.shift, supervisor: 'Edited supervisor', expectedShiftId: beforeEdit.shift.id, expectedVersion: 0 };
  assert.equal((await call('/actions/shift-edit', accounts.get('ABB2'), 'ABB3', payload)).status, 403);
  assert.equal((await call('/actions/shift-edit', accounts.get('ABB3'), 'ABB3', payload)).status, 200);
  assert.equal((await call('/actions/shift-edit', accounts.get('ABB3'), 'ABB3', payload)).status, 400);
  const edited = (await call('/state', accounts.get('ABB3'), 'ABB3')).data;
  assert.equal(edited.shift.supervisor, 'Edited supervisor');
  assert.equal(edited.shift.id, beforeEdit.shift.id);
  assert.deepEqual(edited.rejects, beforeEdit.rejects);
  assert.deepEqual(edited.setup, beforeEdit.setup);
  assert.equal(edited.live.shiftActual, beforeEdit.live.shiftActual);
  assert.equal((await call('/admin/machine-connections', accounts.get('ABB3'))).status, 403);
  assert.equal((await call('/admin/machine-connections', admin)).data.lines.length, lines.length);
  const timerIds = new Set();
  for (const line of ['ABB2', 'ABB3']) {
    const cookie = accounts.get(line);
    const revision = (await call('/state', cookie, line)).data.timer.revision;
    assert.equal((await call('/actions/timer', cookie, line, { action: 'start', revision, category: 'Machine', reason: `Stop ${line}`, targetMinutes: 0 })).status, 200);
    const state = (await call('/state', cookie, line)).data;
    timerIds.add(state.timer.id); assert.equal(state.timer.status, 'running');
    assert.equal((await call('/actions/timer', cookie, line, { action: 'stop', revision })).status, 400);
    assert.equal((await call('/actions/timer', cookie, line, { action: 'stop', revision: revision + 1 })).status, 200);
    assert.equal((await call('/actions/timer', cookie, line, { action: 'log', revision: revision + 2, category: 'Machine', reason: `Stop ${line}`, actionTaken: `Repair ${line}` })).status, 200);
  }
  assert.equal(timerIds.size, 2);
  for (const line of lines) {
    const state = (await call('/state', admin, line)).data;
    assert.equal(state.line, line); assert.equal(state.setup.lot, `Lot ${line}`); assert.equal(state.live.shiftActual, 1);
    assert.ok(state.shift.id.endsWith(`-${line}`)); assert.equal(state.rejects[0].code, `Reject ${line}`);
    assert.equal(state.issues.find(issue => issue.category === 'machine').issue, ['ABB2', 'ABB3'].includes(line) ? `Stop ${line}` : `Issue ${line}`);
    assert.equal(state.downtime.length, ['ABB2', 'ABB3'].includes(line) ? 1 : 0);
    const controller = new AbortController(); controllers.push(controller);
    const stream = await fetch(`${base}/events?line=${encodeURIComponent(line)}`, { headers: { Cookie: admin }, signal: controller.signal });
    const reader = stream.body.getReader();
    const chunk = new TextDecoder().decode((await reader.read()).value);
    const event = JSON.parse(chunk.split('data: ')[1].split('\n\n')[0]);
    assert.equal(event.line, line); assert.equal(event.setup.lot, `Lot ${line}`);
    controller.abort();
  }
  const created = await call('/actions/report', admin, 'ABB2', {});
  assert.equal(created.status, 200);
  const id = created.data.reportId;
  const pdf = await fetch(`${base}/reports/${id}/pdf?line=ABB2`, { headers: { Cookie: admin } });
  assert.equal(pdf.status, 200); assert.equal((await pdf.text()).slice(0, 4), '%PDF');
  assert.equal((await fetch(`${base}/reports/${id}/pdf?line=ABB3`, { headers: { Cookie: admin } })).status, 404);
  assert.equal((await fetch(`${base}/reports/${id}/pdf?line=ABB2`, { headers: { Cookie: accounts.get('ABB3') } })).status, 403);
  assert.equal((await call('/state', admin, 'ABB3')).data.reports.length, 0);
  await stop(); await start();
  for (const line of lines) {
    const restored = await call('/state', accounts.get(line), line);
    assert.equal(restored.status, 200); assert.equal(restored.data.setup.lot, `Lot ${line}`); assert.equal(restored.data.live.shiftActual, 1);
  }
});
