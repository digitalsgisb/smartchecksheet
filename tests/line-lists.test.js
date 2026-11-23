import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../server/store.js';
import { createLineLists } from '../server/lineLists.js';
import { createModelSettings } from '../server/models.js';
import { parsePeopleTable, parseModelsTable, diffPeople, diffModels, mergePeople, mergeModels } from '../shared/lineLists.js';
const res = () => ({ code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
const people = { supervisors: ['Spv'], leaders: ['Lead'], forming: ['Form'], waterjet: ['Jet'], assembly: ['Assy'], quality: ['QC'] };
function fixture(t, extra = {}) {
  const db = openStore(':memory:'); t.after(() => db.close());
  const lists = createLineLists({ db, lines: () => ['ABB2', 'ABB3'], ...extra });
  const req = (body, kind = 'people', role = 'management') => ({ user: { name: 'Admin', role, lines: ['ABB2'] }, params: { line: 'ABB2', kind }, body });
  return { db, lists, req };
}

test('a names table pasted from the Google Sheet keeps each role, skips picture columns and blank cells', () => {
  const text = 'supervisors\tspvPic\tlineLeaders\tleaderPic\tformingOperators\twaterjetOperators\tassemblyOperators\tqualityOperators\r\nAli\thttps://pic/1\tAbu\thttps://pic/2\tSiti\tMei\tRaj\tLim\r\nAli 2\t\t\t\tSiti\tKumar\t\t\n';
  const { people: parsed, ignored } = parsePeopleTable(text);
  assert.deepEqual(parsed, { supervisors: ['Ali', 'Ali 2'], leaders: ['Abu'], forming: ['Siti'], waterjet: ['Mei', 'Kumar'], assembly: ['Raj'], quality: ['Lim'] });
  assert.deepEqual(ignored, ['spvPic', 'leaderPic']);
  assert.throws(() => parsePeopleTable('Ali\tAbu'), /header row/);
});

test('a models table accepts the new columns or the old Models sheet, filtered by line and active', () => {
  assert.deepEqual(parseModelsTable('Model\tCycle time (min/pc)\tPcs/hr\tSlab width\tSlab length\nD46H\t1.5\t40\t1200\t\n', 'ABB2').models, [{ name: 'D46H', cycle: '1.5', pcsHr: '40', slabWidth: '1200', slabLength: '' }]);
  const old = parseModelsTable('line\tmodel\ttargetPerHour\tcycleMinutes\tactive\nABB2\tA\t60\t1\tTRUE\nABB3\tB\t60\t1\tTRUE\nABB2\tC\t60\t1\tFALSE', 'ABB2');
  assert.deepEqual(old.models.map(m => m.name), ['A']);
  assert.throws(() => parseModelsTable('Model\tPcs/hr\nA\t1', 'ABB2'), /Cycle time column/);
});

test('the preview lists added and missing entries, and a save keeps missing ones unless ticked', () => {
  const next = { ...people, forming: ['Form 2'] };
  assert.deepEqual(diffPeople(people, next).forming, { added: ['Form 2'], missing: ['Form'] });
  assert.deepEqual(mergePeople(people, next).forming, ['Form 2', 'Form']);
  assert.deepEqual(mergePeople(people, next, ['forming:Form']).forming, ['Form 2']);
  const was = [{ name: 'A', cycle: 1, pcsHr: 60 }, { name: 'B', cycle: 2, pcsHr: 30 }], now = [{ name: 'A', cycle: 1.2, pcsHr: 60 }, { name: 'C', cycle: 3, pcsHr: 0 }];
  const d = diffModels(was, now);
  assert.deepEqual([d.added.map(m => m.name), d.changed.map(c => c.after.name), d.missing.map(m => m.name)], [['C'], ['A'], ['B']]);
  assert.deepEqual(mergeModels(was, now).map(m => m.name), ['A', 'C', 'B']);
  assert.deepEqual(mergeModels(was, now, ['B']).map(m => m.name), ['A', 'C']);
});

test('admins save names and models per line; the saved list is validated and persisted', t => {
  const f = fixture(t);
  const saved = res(); f.lists.save(f.req({ people: { ...people, quality: [' QC ', 'QC'] } }), saved);
  assert.equal(saved.code, 200); assert.deepEqual(f.lists.people('ABB2').data.quality, ['QC']); assert.equal(f.lists.people('ABB3'), null);
  const empty = res(); f.lists.save(f.req({ people: { ...people, waterjet: [] } }), empty);
  assert.equal(empty.code, 400); assert.match(empty.body.error, /Waterjet/);
  const models = res(); f.lists.save(f.req({ models: [{ name: 'D46H', cycle: 1.5, pcsHr: 40, slabWidth: 1200 }] }, 'models'), models);
  assert.equal(models.code, 200); assert.deepEqual(f.lists.models('ABB2').data, [{ name: 'D46H', pcsHr: 40, cycle: 1.5, slabWidth: 1200 }]);
  const bad = res(); f.lists.save(f.req({ models: [{ name: 'X', cycle: -1 }] }, 'models'), bad); assert.equal(bad.code, 400);
  const read = res(); f.lists.read(f.req(), read); assert.equal(read.body.models.updatedBy, 'Admin');
});

test('only management and developers on that line can read, save or import lists', async t => {
  let imported = 0; const f = fixture(t, { importPeople: async () => { imported++; return people; } });
  for (const role of ['operator', 'executive', 'display']) { const r = res(); f.lists.save(f.req({ people }, 'people', role), r); assert.equal(r.code, 403); }
  const other = res(); f.lists.read({ ...f.req(), params: { line: 'ABB3' } }, other); assert.equal(other.code, 403);
  const unknown = res(); f.lists.save(f.req({}, 'secrets'), unknown); assert.equal(unknown.code, 404);
  const denied = res(); await f.lists.import(f.req({}, 'people', 'operator'), denied); assert.equal(denied.code, 403); assert.equal(imported, 0);
  const ok = res(); await f.lists.import(f.req({}, 'people', 'developer'), ok); assert.deepEqual(ok.body.people, people); assert.equal(f.lists.people('ABB2'), null);
});

test('a saved model list replaces the Models Apps Script link for that line only', async t => {
  const f = fixture(t); const calls = [];
  const settings = createModelSettings({ db: f.db, lines: () => ['ABB2', 'ABB3'], env: { MODELS_URL: 'https://script.google.com/macros/s/x/exec' }, stored: f.lists.models, fetchImpl: async url => { calls.push(url); return Response.json({ models: [{ name: 'Sheet', pcsHr: 1, cycle: 1 }] }); } });
  f.lists.save(f.req({ models: [{ name: 'Own', cycle: 2, pcsHr: 0 }] }, 'models'), res());
  assert.deepEqual((await settings.catalog('ABB2')).models.map(m => m.name), ['Own']);
  assert.deepEqual((await settings.catalog('ABB3')).models.map(m => m.name), ['Sheet']);
  assert.equal(calls.length, 1); assert.ok(settings.hasSource('ABB2'));
  const none = createModelSettings({ db: openStore(':memory:'), lines: () => ['ABB2'], env: {} });
  assert.equal(none.hasSource('ABB2'), false);
});
