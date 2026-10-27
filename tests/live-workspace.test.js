import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../server/store.js';
import { createLiveWorkspace } from '../server/liveWorkspace.js';
import { liveConfigs } from '../server/machineConfig.js';

const lines = ['ABB2', 'ABB3', 'ABB7'];
const catalog = { models: [{ name: 'Verified model', cycle: 1, pcsHr: 60, slabWidth: 100, slabLength: 200 }], people: { supervisors: ['Supervisor'], leaders: ['Leader'], operators: ['A', 'B', 'C'], quality: ['Inspector'] } };
class Broker extends EventEmitter {
  connected = true;
  sent = [];
  subscribe(topics) { this.topics = topics; }
  publish(topic, payload, options, callback) { this.sent.push({ topic, payload, options }); callback?.(); }
  end() {}
  message(topic, payload, packet) { this.emit('message', topic, Buffer.from(JSON.stringify(payload)), packet); }
}
function make(db, line) {
  const broker = new Broker();
  const workspace = createLiveWorkspace({ db, config: { line, ...catalog, mqttUrl: 'mqtt://' + line, requireLineCode: true, productionLine: line, ingestToken: 'test-token-' + line }, mqttConnect: () => broker });
  broker.emit('connect');
  return { broker, workspace };
}
function live(line, extras = {}) {
  return { line_code: line, server_ms: Date.now(), shift_id: 'test-shift-' + line, date: '2026-10-23', shift: 'Day', model: 'Verified model', lot_number: 'Lot-' + line, hourly_plan: 60, standard_cycle_time: 1, current_mode: 'NORMAL', machine_status: 0, hourly_output: 3, total_product_count: 30, product_count: 20, hour_slot: '8.00-9.00', ...extras };
}
function event(line, id, type = 'reject.recorded', payload = {}) {
  return { line_code: line, event_id: id, event_type: type, shift_id: 'test-shift-' + line, payload: { ng_quantity: 2, ng_code: 'NG', ...payload } };
}

test('all three Python connections isolate telemetry, commands, events, PDFs and restart state', () => {
  const db = openStore(':memory:');
  try {
    const machines = lines.map(line => ({ line, ...make(db, line) }));
    for (const [i, { line, broker, workspace }] of machines.entries()) {
      assert.equal(workspace.snapshot().connected, false);
      broker.message('smartchecksheet/live', live(line, { total_product_count: 100 + i }));
      assert.equal(workspace.snapshot().line, line);
      assert.equal(workspace.snapshot().connected, true);
      assert.equal(workspace.snapshot().live.shiftActual, 100 + i);
      const command = workspace.action('reject', { ng: 2, code: 'NG' }, 'Operator-' + line);
      assert.equal(command.pending, true);
      assert.equal(workspace.snapshot().rejects.length, 0, 'reject only appears after Python confirms');
      assert.equal(broker.sent.length, 1);
      assert.deepEqual(broker.sent[0].options, { qos: 0, retain: false });
      workspace.ingest(event(line, command.commandId));
      assert.equal(workspace.snapshot().rejects[0].actor, 'Operator-' + line);
      assert.equal(workspace.snapshot().commands[0].status, 'confirmed');
      assert.equal(workspace.ingest(event(line, command.commandId)).duplicate, true);
      workspace.ingest(event(line, 'same-id-on-different-lines'));
      assert.equal(workspace.snapshot().rejects.length, 2);
      assert.equal(workspace.snapshot().commands.length, 1);
      assert.throws(() => workspace.ingest(event(lines[(i + 1) % 3], 'wrong-line')), /valid event envelope/);
      const report = workspace.action('report', {}, 'Manager').reportId;
      assert.ok(workspace.report(report));
      for (const other of machines.filter(machine => machine.line !== line)) assert.equal(other.workspace.report(report), undefined);
      broker.message('smartchecksheet/live', live(lines[(i + 1) % 3], { total_product_count: 999 }));
      assert.equal(workspace.snapshot().live.shiftActual, 100 + i);
      const restarted = make(db, line);
      assert.equal(restarted.workspace.snapshot().connected, false);
      assert.equal(restarted.workspace.snapshot().live.shiftActual, 100 + i);
      assert.equal(restarted.workspace.snapshot().rejects.length, 2);
      assert.equal(restarted.broker.sent.length, 0, 'restart must not replay commands');
    }
  } finally { db.close(); }
});

test('retained, stale and wrong-line telemetry cannot enable machine commands', () => {
  const db = openStore(':memory:');
  try {
    const { broker, workspace } = make(db, 'ABB3');
    for (const [payload, packet] of [[live('ABB3'), { retain: true }], [live('ABB3', { server_ms: Date.now() - 60000 })], [live('ABB2')], [live('ABB3', { line_code: undefined })]]) {
      broker.message('smartchecksheet/live', payload, packet);
      assert.equal(workspace.snapshot().connected, false);
      assert.throws(() => workspace.action('mode', { mode: 'REST' }, 'Operator'), /disconnected/);
    }
    broker.message('smartchecksheet/live', live('ABB3'));
    const command = workspace.action('mode', { mode: 'REST' }, 'Operator');
    assert.equal(workspace.snapshot().commands[0].status, 'pending');
    broker.message('smartchecksheet/live', live('ABB3', { current_mode: 'REST' }));
    assert.equal(workspace.snapshot().commands[0].status, 'confirmed');
    assert.equal(command.pending, true);
    broker.message('abb3/status', { line_code: 'ABB3', status: 'OFFLINE' });
    assert.equal(workspace.snapshot().connected, false);
    broker.message('smartchecksheet/live', live('ABB3'));
    broker.emit('close'); broker.emit('connect');
    assert.equal(workspace.snapshot().connected, false, 'reconnect needs a new Python heartbeat');
    assert.equal(broker.sent.length, 1);
  } finally { db.close(); }
});

test('durable hourly events deduplicate MQTT delivery and late records update the correct report', () => {
  const db = openStore(':memory:');
  try {
    const { broker, workspace } = make(db, 'ABB7');
    const early = event('ABB7', 'early-parameter', 'parameter.recorded', { heating: 2, glue_standard: 3, glue_actual: 4 });
    workspace.ingest(early);
    broker.message('smartchecksheet/live', live('ABB7'));
    assert.equal(workspace.snapshot().parameters.length, 1);
    const hourly = { shift_id: 'test-shift-ABB7', line_code: 'ABB7', hour_slot: '8.00-9.00', model: 'Verified model', lot_number: 'Lot-ABB7', plan: 60, actual: 50, rest_time: 0 };
    broker.message('smartchecksheet/hourly', hourly);
    workspace.ingest(event('ABB7', 'hourly-1', 'hourly.finalized', hourly));
    assert.equal(workspace.snapshot().hourly.length, 1);
    const reportId = workspace.action('report', {}, 'Manager').reportId;
    broker.message('smartchecksheet/live', live('ABB7', { shift_id: 'next-shift-ABB7' }));
    workspace.ingest(event('ABB7', 'late-reject'));
    assert.equal(workspace.snapshot().rejects.length, 0);
    const saved = JSON.parse(workspace.report(reportId).snapshot);
    assert.equal(saved.rejects.length, 1);
    assert.equal(saved.rejects[0].id, 'late-reject');
    assert.equal(db.prepare('SELECT COUNT(*) AS total FROM machine_events WHERE line=?').get('ABB7').total, 3);
  } finally { db.close(); }
});

test('machine configuration rejects shared brokers and invalid catalogs while preserving legacy ABB2 settings', () => {
  const folder = mkdtempSync(join(tmpdir(), 'machine-config-'));
  try {
    writeFileSync(join(folder, 'catalog.json'), JSON.stringify(catalog));
    const file = join(folder, 'machines.json');
    const entries = lines.map((line, i) => ({ line, mqttUrl: `mqtt://pi${i}:1883`, catalogPath: 'catalog.json' }));
    writeFileSync(file, JSON.stringify(entries));
    const configured = liveConfigs({ MACHINE_CONNECTIONS_PATH: file, ABB3_INGEST_TOKEN: 'ABB3-secret' });
    assert.deepEqual([...configured.keys()], lines);
    assert.equal(configured.get('ABB3').ingestToken, 'ABB3-secret');
    assert.equal(configured.get('ABB7').ingestToken, '');
    entries[1].mqttUrl = entries[0].mqttUrl;
    writeFileSync(file, JSON.stringify(entries));
    assert.throws(() => liveConfigs({ MACHINE_CONNECTIONS_PATH: file }), /separate broker/);
    assert.throws(() => liveConfigs({}), /requires/);
    assert.equal(liveConfigs({ MQTT_URL: 'mqtt://legacy-pi:1883', CATALOG_PATH: join(folder, 'catalog.json'), INGEST_TOKEN: 'old-token' }).get('ABB2').ingestToken, 'old-token');
    writeFileSync(join(folder, 'catalog.json'), JSON.stringify({ models: [], people: {} }));
    assert.throws(() => liveConfigs({ MQTT_URL: 'mqtt://legacy-pi:1883', CATALOG_PATH: join(folder, 'catalog.json') }), /verified models/);
  } finally { rmSync(folder, { recursive: true, force: true }); }
});

test('durable downtime deduplicates MQTT and a Python shift ending archives final counts once', () => {
  const db = openStore(':memory:');
  try {
    const { broker, workspace } = make(db, 'ABB3');
    broker.message('smartchecksheet/live', live('ABB3'));
    const log = { event_id: 'downtime-session1', shift_id: 'test-shift-ABB3', category: 'Machine', description: 'Sensor blocked', durationMinutes: 2, actionTaken: 'Cleaned sensor' };
    broker.message('abb3/downtime_result', { log });
    workspace.ingest(event('ABB3', log.event_id, 'downtime.recorded', { category: log.category, description: log.description, duration_minutes: 2, action_taken: log.actionTaken }));
    assert.equal(workspace.snapshot().downtime.length, 1);
    assert.equal(workspace.snapshot().downtime[0].action, 'Cleaned sensor');
    workspace.ingest(event('ABB3', 'end-1', 'shift.ended', { shift_total_output: 123, model_total_output: 23 }));
    assert.equal(workspace.snapshot().reports.length, 1);
    const reportId = workspace.snapshot().reports[0].id;
    broker.message('smartchecksheet/live', live('ABB3', { shift_id: 'NO PROD', total_product_count: 0 }));
    broker.message('abb3/shift_form_result', { status: 'ended' });
    assert.equal(workspace.snapshot().reports.length, 1);
    assert.equal(workspace.snapshot().live.shiftActual, 123);
    assert.equal(JSON.parse(workspace.report(reportId).snapshot).live.shiftActual, 123);
    assert.equal(workspace.snapshot().hourly.length, 0, 'only Python finalizes hourly rows');
  } finally { db.close(); }
});
