import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { cmmsConfig, createCmmsBridge } from '../server/cmms.js';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
function response() { return { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; }, type(type) { this.mime = type; return this; }, send(body) { this.body = body; return this; } }; }
function fixture(t, overrides = {}) {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  const state = { creates: 0, uploads: 0, verifications: 0, logins: 0, calls: [], orders: [], failCreate: false, failUpload: false, role: 'requester', plantAccess: 'port-klang', tokenExpired: false, ...overrides };
  const config = { url: 'http://cmms.test', username: 'checksheet', password: 'server-secret' };
  const master = { machines: ['2', '3', '7'].map(n => ({ id: `machine-${n}`, name: `ABB${n}`, active: true, department: 'Production', sectionId: 'forming', area: 'Forming' })), sections: [{ id: 'forming', department: 'Production', active: true }], issueCategories: [{ id: 'breakdown', active: true, department: 'Production', name: 'Breakdown' }, { id: 'she', active: true, department: 'SHE', name: 'Safety' }] };
  const foreign = (id, machineId, plantId = 'port-klang') => ({ id, machineId, plantId, responsibleDepartment: 'Production', requesterId: 'another-requester', number: `WO-${id}`, status: 'open', activities: [], attachments: [] });
  state.orders.push(foreign('other-line', 'machine-3'), foreign('other-plant', 'machine-2', 'sendayan'));
  const fetchImpl = async (url, options) => {
    state.calls.push({ url, options }); assert.equal(options.redirect, 'error');
    const path = new URL(url).pathname;
    if (path === '/api/auth/login') { state.logins++; return Response.json({ token: 'private-session', user: { id: 'requester-account', role: state.role, department: 'Production', plantAccess: state.plantAccess, password: 'must-not-leak' } }); }
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
    const match = path.match(/^\/api\/work-orders\/([^/]+)(\/attachments|\/status)?$/);
    if (match) {
      const order = state.orders.find(o => o.id === match[1]);
      if (!order) return Response.json({}, { status: 404 });
      if (match[2] === '/status') {
        assert.equal(options.method, 'PATCH'); assert.equal(options.headers['X-CMMS-Plant'], order.plantId);
        const input = JSON.parse(options.body); assert.equal(input.actorId, 'requester-account');
        state.verifications++; order.status = input.status; order.updatedAt = new Date().toISOString();
        if (input.productionDowntimeReason) order.productionDowntimeReason = input.productionDowntimeReason;
        order.activities.push({ id: `verify-${state.verifications}`, status: input.status, message: input.note, createdAt: order.updatedAt });
        return Response.json(order);
      }
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

test('CMMS config needs no machine mappings or manual plant configuration', () => {
  assert.throws(() => cmmsConfig({ CMMS_API_URL: 'https://secret@host' }));
  assert.throws(() => cmmsConfig({ CMMS_API_URL: 'https://host/api' }));
  assert.deepEqual(cmmsConfig({}), { url: '', username: '', password: '' });
  assert.doesNotThrow(() => cmmsConfig({ CMMS_LINES: 'old setting is ignored' }));
});
test('unconfigured and unauthorized lines fail without contacting CMMS', async t => {
  const f = fixture(t);
  assert.equal((await f.call({ user: null })).code, 403);
  assert.equal((await f.call({ line: 'ABB3' })).code, 403);
  const bridge = createCmmsBridge({ db: f.db, config: {}, fetchImpl: f.fetchImpl });
  assert.equal((await f.call({}, bridge)).code, 503);
  assert.equal(f.state.calls.length, 0);
});
test('list and details enforce requester ownership and plant access, regardless of machine', async t => {
  const f = fixture(t); f.state.orders.push(...['machine-2', 'machine-3', null].map((machine, i) => ({ ...f.foreign(`own-${i}`, machine), requesterId: 'requester-account' })));
  f.state.orders.push({ ...f.foreign('own-other-plant', 'machine-2', 'sendayan'), requesterId: 'requester-account' });
  const result = await f.call(); assert.equal(result.code, 200);
  assert.deepEqual(result.body.orders.map(o => o.id), ['own-0', 'own-1', 'own-2']);
  assert.deepEqual(result.body.machines.map(m => m.id), ['machine-2', 'machine-3', 'machine-7']);
  assert.deepEqual(result.body.issueCategories.map(c => c.id), ['breakdown']);
  assert.equal((await f.call({ params: { id: 'other-line' } })).code, 403);
  assert.equal((await f.call({ params: { id: 'own-other-plant' } })).code, 403);
  assert.equal((await f.call({ params: { id: 'own-1' } })).code, 200);
  const otherLine = await f.call({ line: 'ABB3', user: { id: 'operator-3', role: 'operator', lines: ['ABB3'] } });
  assert.deepEqual(otherLine.body.orders, result.body.orders);
  assert.doesNotMatch(JSON.stringify(result.body), /server-secret|private-session|password/);
});
test('read-only accounts and invalid input cannot create work orders', async t => {
  const f = fixture(t);
  for (const role of ['executive', 'display']) assert.equal((await f.call({ method: 'POST', body: f.body(), user: { id: role, role, lines: ['ABB2'] } })).code, 403);
  for (const change of [{ machineId: 'not-in-cmms' }, { issueCategoryId: 'she' }, { shiftGroup: 'C' }, { priority: 'urgent' }, { photo: null }, { photo: { type: 'image/png', data: 'ZmFrZQ==' } }, { issueDescription: '' }]) assert.equal((await f.call({ method: 'POST', body: { ...f.body(), ...change } })).code, 400);
  assert.equal(f.state.creates, 0);
});
test('equipment is selected from CMMS without any line mapping', async t => {
  const f = fixture(t);
  const result = await f.call({ method: 'POST', body: { ...f.body(), machineId: 'machine-3', requesterId: 'another-requester' } });
  assert.equal(result.code, 201);
  assert.equal(result.body.order.machineId, 'machine-3');
  assert.equal(f.state.orders.at(-1).requesterId, 'requester-account');
});
test('requester with both plants sees its jobs in both and chooses a plant when creating', async t => {
  const f = fixture(t, { plantAccess: 'both' });
  f.state.orders.push(...['port-klang', 'sendayan'].map(plant => ({ ...f.foreign(`own-${plant}`, null, plant), requesterId: 'requester-account' })));
  const result = await f.call();
  assert.equal(result.code, 200);
  assert.deepEqual(result.body.plants, ['port-klang', 'sendayan']);
  assert.equal(result.body.orders.length, 2);
  assert.deepEqual([...new Set(result.body.machines.map(m => m.plantId))], ['port-klang', 'sendayan']);
  assert.equal((await f.call({ params: { id: 'own-sendayan' } })).code, 200);
  assert.equal((await f.call({ method: 'POST', body: f.body() })).code, 400);
  const created = await f.call({ method: 'POST', body: { ...f.body(), plant: 'sendayan' } });
  assert.equal(created.code, 201); assert.equal(created.body.order.plantId, 'sendayan');
});
test('single-plant requester cannot submit to a different plant', async t => {
  const f = fixture(t);
  assert.equal((await f.call({ method: 'POST', body: { ...f.body(), plant: 'sendayan' } })).code, 400);
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

function verificationFixture(t, overrides = {}) {
  const f = fixture(t, overrides);
  const order = { ...f.foreign('ready', 'machine-2'), requesterId: 'requester-account', responsibleDepartment: 'Production', status: 'resolved', createdAt: new Date(Date.now() - 120 * 60000).toISOString(), updatedAt: '2026-10-26T09:00:00Z' };
  f.state.orders.push(order);
  const verify = (body = {}, request = {}) => f.call({ method: 'PATCH', params: { id: order.id }, body: { status: 'closed', expectedUpdatedAt: order.updatedAt, note: 'Inspected on site', checks: { location: true, repair: true, operation: true }, productionDowntimeReason: 'Waiting for spare bearing', ...body }, ...request });
  return { ...f, order, verify };
}

test('verified repair closes using the connected requester and records the real operator', async t => {
  const f = verificationFixture(t, { plantAccess: 'both' }); f.order.plantId = 'sendayan';
  const result = await f.verify({ actorId: 'forged-actor' });
  assert.equal(result.code, 200); assert.equal(result.body.order.status, 'closed');
  assert.match(result.body.order.activities.at(-1).message, /Line operator.*Smart Checksheet \(ABB2\)/);
  assert.match(result.body.order.activities.at(-1).message, /Equipment\/location/);
  assert.equal(result.body.order.productionDowntimeReason, 'Waiting for spare bearing');
  assert.equal(f.state.verifications, 1);
});
test('returning a repair requires a reason and writes it to CMMS history', async t => {
  const f = verificationFixture(t);
  assert.equal((await f.verify({ status: 'returned', note: ' ' })).code, 400);
  const result = await f.verify({ status: 'returned', note: 'Leak persists at the rear seal', checks: {} });
  assert.equal(result.code, 200); assert.equal(result.body.order.status, 'returned');
  assert.match(result.body.order.activities.at(-1).message, /Leak persists/);
});
test('verification denies read-only users, foreign jobs, changed jobs and non-resolved statuses', async t => {
  const f = verificationFixture(t);
  for (const role of ['executive', 'display']) assert.equal((await f.verify({}, { user: { id: role, role, lines: ['ABB2'] } })).code, 403);
  assert.equal((await f.verify({}, { params: { id: 'other-line' } })).code, 403);
  assert.equal((await f.verify({ expectedUpdatedAt: 'old' })).code, 409);
  for (const status of ['open', 'in_progress', 'closed', 'returned', 'cancelled']) { f.order.status = status; assert.equal((await f.verify()).code, 409); }
  assert.equal(f.state.verifications, 0);
});
test('closing requires inspection checks and the CMMS long-duration explanation', async t => {
  const f = verificationFixture(t);
  assert.equal((await f.verify({ checks: { location: true, repair: true, operation: false } })).code, 400);
  assert.equal((await f.verify({ productionDowntimeReason: '' })).code, 400);
  assert.equal((await f.verify({ status: 'in_progress' })).code, 400);
  assert.equal(f.state.verifications, 0);
  f.order.productionDowntimeReason = 'Reason already confirmed in CMMS';
  assert.equal((await f.verify({ productionDowntimeReason: '' })).code, 200);
  assert.equal((await f.verify()).code, 409);
  assert.equal(f.state.verifications, 1);
});
