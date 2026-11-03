import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../server/store.js';
import { createModelSettings, mapModels } from '../server/models.js';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const url = 'https://script.google.com/macros/s/test-deployment/exec';
const response = () => ({ code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
function fixture(t) {
  const db = openStore(':memory:'); t.after(() => db.close()); const calls = [];
  const service = createModelSettings({ db, lines: () => ['ABB2', 'ABB3'], env: {}, fetchImpl: async target => { calls.push(target); return Response.json({ models: [{ name: 'Real model', pcsHr: 60, cycle: 1 }] }); } });
  const req = { user: { name: 'Admin', role: 'developer', lines: ['ABB3'] }, params: { line: 'ABB3' }, body: { url } };
  return { db, service, req, calls };
}
test('model scripts are separate from names, line-scoped, persisted and tested without saving', async t => {
  const f = fixture(t), tested = response(); await f.service.test(f.req, tested);
  assert.equal(tested.code, 200); assert.equal(tested.body.counts.models, 1); assert.equal(f.service.urlFor('ABB3'), '');
  f.service.save(f.req, response()); assert.equal(f.service.urlFor('ABB3'), url); assert.equal(f.service.urlFor('ABB2'), '');
  const data = await f.service.catalog('ABB3'); assert.equal(data.models[0].cycle, 1);
  await f.service.catalog('ABB3'); assert.equal(f.calls.length, 2); assert.equal(new URL(f.calls[0]).searchParams.get('line'), 'ABB3');
});
test('unconfigured or invalid model data produces an error rather than sample or empty choices', async t => {
  const f = fixture(t), result = response(); await f.service.read({ line: 'ABB3' }, result); assert.equal(result.code, 503);
  for (const data of [[], { models: [{ name: 'X', pcsHr: 0, cycle: 1 }] }, [{ name: 'X', pcsHr: 60, cycle: -1 }], [{ name: 'X', pcsHr: 60, cycle: 1 }, { name: 'X', pcsHr: 61, cycle: 2 }], { error: 'Sign in' }]) assert.throws(() => mapModels(data));
  assert.deepEqual(mapModels([{ name: ' Trimmed ', pcsHr: '60', cycle: '1' }]), [{ name: 'Trimmed', pcsHr: 60, cycle: 1 }]);
});
test('operators and executives cannot edit model scripts or inspect another account line', async t => {
  const f = fixture(t);
  for (const role of ['operator', 'executive', 'display']) for (const action of ['list', 'save', 'test']) { const r = response(); await f.service[action]({ ...f.req, user: { ...f.req.user, role } }, r); assert.equal(r.code, 403); }
  const denied = response(); f.service.save({ ...f.req, params: { line: 'ABB2' } }, denied); assert.equal(denied.code, 403);
  const bad = response(); f.service.save({ ...f.req, body: { url: 'http://localhost/models' } }, bad); assert.equal(bad.code, 400); assert.equal(f.calls.length, 0);
});
test('the paste-ready Apps Script filters active rows by the requested line and returns model standards', () => {
  const source = readFileSync(new URL('../public/apps-script/Models.gs', import.meta.url), 'utf8');
  const context = vm.createContext({ SpreadsheetApp: { openById: () => ({ getSheetByName: () => ({ getDataRange: () => ({ getValues: () => [['line', 'model', 'targetPerHour', 'cycleMinutes', 'active'], ['ABB3', 'Model A', 60, 1, true], ['ABB2', 'Other line', 100, 2, true], ['ABB3', 'Inactive', 50, 1.2, false]] }) }) }) }, ContentService: { MimeType: { JSON: 'application/json' }, createTextOutput: text => ({ setMimeType: () => text }) } });
  vm.runInContext(source, context);
  const rows = JSON.parse(vm.runInContext("doGet({parameter:{line:'ABB3'}})", context));
  assert.deepEqual(rows, { models: [{ name: 'Model A', pcsHr: 60, cycle: 1 }] });
  assert.ok(JSON.parse(vm.runInContext('doGet({parameter:{}})', context)).error);
});
test('original Node-RED model scripts accept stdCycle and omit zero-valued state placeholders', () => {
  const warnings = [];
  const models = mapModels([
    { name: 'NO PROD', stdCycle: 0, pcsHr: 0 },
    { name: 'TRIAL', stdCycle: 0, pcsHr: 0 },
    { name: 'Production model', stdCycle: 3.5, pcsHr: 17, stdSlabWidth: 100 },
    { name: 'Missing target', stdCycle: 4, pcsHr: 0 }
  ], warnings);
  assert.deepEqual(models, [{ name: 'Production model', cycle: 3.5, pcsHr: 17 }]);
  assert.equal(warnings.length, 1); assert.match(warnings[0], /Missing target.*target\/hour is 0/);
  assert.throws(() => mapModels([{ name: 'Bad production cycle', stdCycle: 0, pcsHr: 20 }]));
  assert.throws(() => mapModels([{ name: 'NO PROD', stdCycle: 0, pcsHr: 0 }]));
});
test('legacy script testing and the line catalog report excluded models without losing valid models', async t => {
  const db = openStore(':memory:'); t.after(() => db.close());
  const service = createModelSettings({ db, lines: () => ['ABB2'], env: { ABB2_MODELS_URL: url }, fetchImpl: async () => Response.json([{ name: 'NO PROD', stdCycle: 0, pcsHr: 0 }, { name: 'Valid', stdCycle: 2, pcsHr: 30 }, { name: 'Needs target', stdCycle: 2, pcsHr: 0 }]) });
  const result = response();
  await service.test({ user: { name: 'Admin', role: 'developer', lines: ['ABB2'] }, params: { line: 'ABB2' }, body: { url: url + '?sheetName=Sheet1' } }, result);
  assert.equal(result.code, 200); assert.equal(result.body.counts.models, 1); assert.equal(result.body.warnings.length, 1);
  const read = response(); await service.read({ line: 'ABB2' }, read);
  assert.equal(read.body.models[0].cycle, 2); assert.equal(read.body.warnings.length, 1);
});
