import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { cmmsConfig, createCmmsBridge } from '../server/cmms.js';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
function response() { return { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; }, type(type) { this.mime = type; return this; }, send(body) { this.body = body; return this; } }; }
function fixture(t, overrides = {}) {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  const state = { creates: 0, uploads: 0, logins: 0, calls: [], orders: [], failCreate: false, failUpload: false, role: 'requester', tokenExpired: false, ...overrides };
  const config = { url: 'http://cmms.test', username: 'checksheet', password: 'server-secret', lines: { ABB2: { plant: 'port-klang', machineIds: ['machine-2'] }, ABB3: { plant: 'port-klang', machineIds: ['machine-3'] }, ABB7: { plant: 'sendayan', machineIds: ['machine-7'] } } };
  const master = { machines: ['2', '3', '7'].map(n => ({ id: `machine-${n}`, name: `ABB${n}`, active: true, department: 'Production', sectionId: 'forming', area: 'Forming' })), sections: [{ id: 'forming', department: 'Production', active: true }], issueCategories: [{ id: 'breakdown', active: true, department: 'Production', name: 'Breakdown' }, { id: 'she', active: true, department: 'SHE', name: 'Safety' }] };
  const foreign = (id, machineId, plantId = 'port-klang') => ({ id, machineId, plantId, responsibleDepartment: 'Production', number: `WO-${id}`, status: 'open', activities: [], attachments: [] });
  state.orders.push(foreign('other-line', 'machine-3'), foreign('other-plant', 'machine-2', 'sendayan'));
  const fetchImpl = async (url, options) => {
    state.calls.push({ url, options }); assert.equal(options.redirect, 'error');
    const path = new URL(url).pathname;
    if (path === '/api/auth/login') { state.logins++; return Response.json({ token: 'private-session', user: { id: 'requester-account', role: state.role, department: 'Production', password: 'must-not-leak' } }); }
    assert.equal(options.headers.Authorization, 'Bearer private-session');
    if (state.tokenExpired) { state.tokenExpired = false; return Response.json({}, { status: 401 }); }
    if (path === '/api/master-data') return Response.json(master);
    if (path === '/api/work-orders' && options.method === 'POST') {
      state.creates++; const input = JSON.parse(options.body);
      assert.equal(input.requesterId, 'requester-account'); assert.equal(input.responsibleDepartment, 'Production');
      const order = { ...foreign(`created-${state.creates}`, input.machineId, options.headers['X-CMMS-Plant']), ...input, number: `WO-${state.creates}`, requester: { password: 'secret' }, assignedTo: { name: 'Technician', username: 'private' }, completionNote: 'Bearing replaced' };
      state.orders.push(order); if (state.failCreate) { state.failCreate = false; throw new Error('connection lost after commit'); }
      return Response.json(order);
    }
    if (path === '/api/work-orders') return Response.json(state.orders);
    const match = path.match(/^\/api\/work-orders\/([^/]+)(\/attachments)?$/);
    if (match) {
      const order = state.orders.find(o => o.id === match[1]);
      if (!order) return Response.json({}, { status: 404 });
      if (match[2]) {
        state.uploads++; const file = options.body.get('attachments'); assert.equal(options.body.get('kind'), 'issue');
        order.attachments.push({ id: 'photo-1', originalName: file.name, mimeType: file.type, kind: 'issue', url: `/uploads/work-orders/${order.id}/image.png` });
        if (state.failUpload) { state.failUpload = false; throw new Error('upload reply lost'); }
        return Response.json(order.attachments);
      }
      return Response.json(order);
    }
    if (path.startsWith('/uploads/work-orders/')) return new Response(Buffer.from(png, 'base64'), { headers: { 'Content-Type': 'image/png' } });
    throw new Error(`Unexpected path ${path}`);
  };
  const bridge = createCmmsBridge({ db, config, fetchImpl });
  const body = () => ({ requestId: randomUUID(), machineId: 'machine-2', issueCategoryId: 'breakdown', issueDescription: 'Hydraulic leak', shiftGroup: 'B', priority: 'high', photo: { type: 'image/png', data: png } });
  const call = async (request = {}, handler = bridge) => {
    const res = response(); await handler({ method: 'GET', line: 'ABB2', params: {}, user: { id: 'operator-1', name: 'Line operator', role: 'operator', lines: ['ABB2'] }, ...request }, res); return res;
  };
  return { state, config, db, fetchImpl, bridge, body, call, foreign };
}

test('CMMS config requires an origin and explicit plant/machine mappings', () => {
  assert.throws(() => cmmsConfig({ CMMS_API_URL: 'https://secret@host' }));
  assert.throws(() => cmmsConfig({ CMMS_API_URL: 'https://host/api' }));
  assert.throws(() => cmmsConfig({ CMMS_LINES: '{"ABB2":{"plant":"all","machineIds":["a"]}}' }));
  assert.throws(() => cmmsConfig({ CMMS_LINES: '{"ABB2":{"plant":"port-klang","machineIds":[]}}' }));
  assert.deepEqual(cmmsConfig({}).lines, {});
});
test('unconfigured and unauthorized lines fail without contacting CMMS', async t => {
  const f = fixture(t);
  assert.equal((await f.call({ user: null })).code, 403);
  assert.equal((await f.call({ line: 'ABB3' })).code, 403);
  const bridge = createCmmsBridge({ db: f.db, config: { lines: {} }, fetchImpl: f.fetchImpl });
  assert.equal((await f.call({}, bridge)).code, 503);
  assert.equal(f.state.calls.length, 0);
});
test('list and details enforce plant and machine access and redact account data', async t => {
  const f = fixture(t); f.state.orders.push(f.foreign('own', 'machine-2'));
  const result = await f.call(); assert.equal(result.code, 200);
  assert.deepEqual(result.body.orders.map(o => o.id), ['own']);
  assert.deepEqual(result.body.machines.map(m => m.id), ['machine-2']);
  assert.deepEqual(result.body.issueCategories.map(c => c.id), ['breakdown']);
  assert.equal((await f.call({ params: { id: 'other-line' } })).code, 403);
  assert.equal((await f.call({ params: { id: 'other-plant' } })).code, 403);
  assert.doesNotMatch(JSON.stringify(result.body), /server-secret|private-session|password/);
});
test('read-only accounts and invalid input cannot create work orders', async t => {
  const f = fixture(t);
  for (const role of ['executive', 'display']) assert.equal((await f.call({ method: 'POST', body: f.body(), user: { id: role, role, lines: ['ABB2'] } })).code, 403);
  for (const change of [{ machineId: 'machine-3' }, { issueCategoryId: 'she' }, { shiftGroup: 'C' }, { priority: 'urgent' }, { photo: null }, { photo: { type: 'image/png', data: 'ZmFrZQ==' } }, { issueDescription: '' }]) assert.equal((await f.call({ method: 'POST', body: { ...f.body(), ...change } })).code, 400);
  assert.equal(f.state.creates, 0);
});
test('create records real operator and uploads photo; repeated request reuses the work order', async t => {
  const f = fixture(t), body = f.body();
  const created = await f.call({ method: 'POST', body }); assert.equal(created.code, 201);
  assert.equal(created.body.order.reportedByName, 'Line operator');
  assert.equal((await f.call({ method: 'POST', body })).code, 201);
  assert.equal(f.state.creates, 1); assert.equal(f.state.uploads, 1);
  assert.equal(created.body.order.assignedTo, 'Technician'); assert.equal(created.body.order.completionNote, 'Bearing replaced');
  assert.doesNotMatch(JSON.stringify(created.body), /private|password|requester-account/);
  const changed = await f.call({ method: 'POST', body: { ...body, issueDescription: 'Changed' } }); assert.equal(changed.code, 409);
});
test('lost creation reply is reconciled after server restart without issuing twice', async t => {
  const f = fixture(t, { failCreate: true }), body = f.body();
  assert.equal((await f.call({ method: 'POST', body })).code, 502);
  const restarted = createCmmsBridge({ db: f.db, config: f.config, fetchImpl: f.fetchImpl });
  assert.equal((await f.call({ method: 'POST', body }, restarted)).code, 201);
  assert.equal(f.state.creates, 1); assert.equal(f.state.uploads, 1);
});
test('unconfirmed submission without a matching CMMS record is never resent', async t => {
  const f = fixture(t, { failCreate: true }), body = f.body();
  await f.call({ method: 'POST', body }); f.state.orders = [];
  assert.equal((await f.call({ method: 'POST', body })).code, 409);
  assert.equal(f.state.creates, 1);
});
test('lost photo reply can be retried without duplicate photo or work order', async t => {
  const f = fixture(t, { failUpload: true }), body = f.body();
  const failed = await f.call({ method: 'POST', body }); assert.equal(failed.code, 502); assert.match(failed.body.error, /created/);
  assert.equal((await f.call({ method: 'POST', body })).code, 201);
  assert.equal(f.state.creates, 1); assert.equal(f.state.uploads, 1);
});
test('CMMS connection rejects privileged accounts and refreshes an expired session', async t => {
  const f = fixture(t, { role: 'admin' }); assert.equal((await f.call()).code, 503);
  f.state.role = 'requester'; assert.equal((await f.call()).code, 200);
  f.state.tokenExpired = true; assert.equal((await f.call()).code, 200);
  assert.equal(f.state.logins, 3);
});
test('photos require authorized line details and cannot redirect to an external host', async t => {
  const f = fixture(t), body = f.body(); const created = await f.call({ method: 'POST', body }); const id = created.body.order.id;
  const image = await f.call({ params: { id, photoId: 'photo-1' } }); assert.equal(image.code, 200); assert.equal(image.mime, 'image/png'); assert.ok(Buffer.isBuffer(image.body));
  const order = f.state.orders.find(o => o.id === id); order.attachments[0].url = 'https://outside.test/photo.png';
  assert.equal((await f.call({ params: { id, photoId: 'photo-1' } })).code, 404);
  assert.equal((await f.call({ params: { id: 'other-line', photoId: 'photo-1' } })).code, 403);
});
