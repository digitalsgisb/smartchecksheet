import test from 'node:test';
import assert from 'node:assert/strict';
import { createManpowerBridge, mapManpower, namesUrl } from '../server/manpower.js';
const rows = [{ supervisors: ' Supervisor ', lineLeaders: 'Leader', formingOperators: 'Former', waterjetOperators: 'Waterjet', assemblyOperators: 'Assembler', qualityOperators: 'Inspector' }];
const res = () => ({ code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
test('Apps Script roles stay separate and names are trimmed and deduplicated', () => {
  assert.deepEqual(mapManpower([...rows, { formingOperators: 'Former' }, { formingOperators: 'Other' }]), { supervisors: ['Supervisor'], leaders: ['Leader'], forming: ['Former', 'Other'], waterjet: ['Waterjet'], assembly: ['Assembler'], quality: ['Inspector'] });
  assert.throws(() => mapManpower({}));
  assert.throws(() => mapManpower([{ supervisors: 'Only supervisor' }]));
});
test('parallel requests share a load; each line can override its Apps Script source', async () => {
  const calls = [];
  const custom = namesUrl + '?tab=ABB7';
  const bridge = createManpowerBridge({ env: { ABB7_MANPOWER_URL: custom }, fetchImpl: async url => { calls.push(url); return Response.json(rows); } });
  const a = res(), b = res(), c = res();
  await Promise.all([bridge({ line: 'ABB3' }, a), bridge({ line: 'ABB3' }, b)]);
  await bridge({ line: 'ABB7' }, c);
  assert.deepEqual(calls, [namesUrl, custom]);
  assert.equal(a.code, 200); assert.deepEqual(a.body, b.body); assert.deepEqual(c.body.people, a.body.people);
});
test('bad source or failed feed reports an error instead of empty dropdown data', async () => {
  for (const opts of [{env: {MANPOWER_URL:'http://private.test/exec'}}, {env:{}, fetchImpl:async()=>Response.json({error:'failed'})}]) {
    const reply = res(); await createManpowerBridge(opts)({line:'ABB3'},reply);
    assert.equal(reply.code,502); assert.equal(reply.body.people,undefined);
  }
});
