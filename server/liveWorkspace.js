import { randomUUID } from 'node:crypto';
import mqtt from 'mqtt';
import { digest } from './store.js';
import { seedState } from './seed.js';
import { finiteNumber, requireText, requireOvertime, slotNow, emptyTimer, shiftSchedule } from './domain.js';

// Each machine owns its MQTT client, telemetry clock, records and command queue.
export function createLiveWorkspace({ db, config, onChange = () => {}, mqttConnect = mqtt.connect }) {
  const { line, models, people } = config;
  const mode = 'live';
  let state = JSON.parse(db.prepare('SELECT value FROM state WHERE line=?').get(line)?.value || JSON.stringify({ ...seedState(false), line }));
  let broker = null, mqttConnected = false, lastTelemetry = 0, lastReceivedTelemetry = 0;
  const broadcast = () => onChange(line);
  const telemetryFresh = () => mqttConnected && Date.now() - lastTelemetry < 8000;
  function persist() { db.prepare('INSERT INTO state(line,value) VALUES(?,?) ON CONFLICT(line) DO UPDATE SET value=excluded.value').run(line, JSON.stringify(state)); }
  function snapshot() {
    return { ...state, line, mode, connected: telemetryFresh(), machineConnected: telemetryFresh(), serverTime: Date.now(), oeeUrl: config.oeeUrl || '', models, people,
      reports: db.prepare('SELECT id, shift_id AS shiftId, created_at AS createdAt FROM reports WHERE line=? ORDER BY created_at DESC LIMIT 100').all(line),
      commands: db.prepare('SELECT id,kind,status,created_at AS createdAt FROM commands WHERE line=? ORDER BY created_at DESC LIMIT 8').all(line) };
  }
  function commit(label, actor = 'System') {
    state.revision++; state.updatedAt = new Date().toISOString();
    if (label) state.audit.unshift({ id: randomUUID(), label, actor, createdAt: state.updatedAt });
    state.audit = state.audit.slice(0, 250); persist(); broadcast();
  }
  function issue(category, text, actor = 'System', action = '') {
    state.henkaten[category] = { status: 'NG', issue: text, action, count: (state.henkaten[category]?.count || 0) + 1 };
    state.issues.unshift({ id: randomUUID(), category, issue: text, action, status: 'pending', actor, createdAt: new Date().toISOString() });
  }
  function resolveCategory(category, action, actor) {
    for (const item of state.issues) if (item.category === category && item.status === 'pending') { item.status = 'resolved'; item.action = action; item.resolvedAt = new Date().toISOString(); item.resolvedBy = actor; }
    state.henkaten[category] = { ...state.henkaten[category], status: 'OK', issue: '', action };
  }
  function createReport(actor) {
    if (!state.shift) throw new Error('A shift is required before generating a report.');
    const id = randomUUID();
    db.prepare('INSERT INTO reports VALUES(?,?,?,?,?)').run(id, state.shift.id, line, new Date().toISOString(), JSON.stringify(snapshot()));
    commit('PDF report generated', actor); return id;
  }
  function finalizeHour() {
    if (!state.shift || !state.setup || state.live.actual === 0 && state.live.plan === 0) return;
    state.hourly.push({ id: randomUUID(), shiftId: state.shift.id, slot: state.live.slot, model: state.setup.model, lot: state.setup.lot, plan: state.live.plan, actual: state.live.actual, restMinutes: 0 });
    state.live.actual = 0; state.live.plan = 0;
  }
  function activateShift(p, actor) {
    if (state.shift?.status === 'active' && state.shift.id !== p.id) { state.shift.status = 'ended'; createReport(actor); }
    state.shift = { ...p, status: 'active' }; state.pendingShift = null; state.setup = null;
    state.hourly = []; state.rejects = []; state.downtime = []; state.parameters = []; state.verification = [];
    state.live = { actual: 0, modelActual: 0, shiftActual: 0, plan: 0, cycle: 0, mode: 'NORMAL', status: 'Waiting for setup', slot: slotNow(), timestamp: new Date().toISOString() };
    state.timer = emptyTimer(state.timer.revision + 1);
    // Open issues persist across shifts until explicitly resolved.
    issue('man', `Confirm manpower for ${p.shift} shift`, actor);
    // HTTP delivery can precede MQTT recovery after a server restart.
    for (const row of db.prepare('SELECT envelope FROM machine_events WHERE line=? ORDER BY rowid').all(line)) {
      const event = JSON.parse(row.envelope);
      if (event.shift_id === p.id) applyEvent(state, event);
    }
  }
  function validateShift(p) {
    const schedule = shiftSchedule(p.date, p.shift, requireOvertime(p.overtime));
    const operators = ['forming', 'waterjet', 'assembly'].flatMap(key => {
      if (!Array.isArray(p[key]) || !p[key].length) throw new Error(`Select at least one ${key} operator.`);
      return p[key].map(v => requireText(v, 'Operator', 80));
    });
    const quality = requireText(p.quality, 'Quality inspector', 80);
    if (!people.supervisors.includes(p.supervisor) || !people.leaders.includes(p.leader) || !people.quality.includes(quality) || operators.some(name => !people.operators.includes(name))) throw new Error('Select manpower from the configured line catalog.');
    if (new Set([...operators, quality]).size !== operators.length + 1) throw new Error('An operator cannot occupy multiple roles in one shift.');
    return { id: `${p.date.replaceAll('-', '')}-${p.shift}-${line}`, date: p.date, shift: p.shift, overtime: p.overtime === true, supervisor: requireText(p.supervisor, 'Supervisor', 80), leader: requireText(p.leader, 'Leader', 80), forming: p.forming, waterjet: p.waterjet, assembly: p.assembly, quality, ...schedule };
  }
  function validate(kind, p) {
    if (kind === 'shift') return validateShift(p);
    if (kind === 'setup') {
      const model = models.find(m => m.name === p.model); if (!model) throw new Error('Choose a known model.');
      const plan = finiteNumber(p.plan, 'Hourly target', 1, 10000); if (!Number.isInteger(plan)) throw new Error('Hourly target must be a whole number.');
      return { model: model.name, lot: requireText(p.lot, 'Lot number', 80), plan, cycle: model.cycle };
    }
    if (kind === 'reject') {
      const result = { slab: finiteNumber(p.slab ?? 0, 'Slab length'), returnRoll: finiteNumber(p.returnRoll ?? 0, 'Return roll'), ng: finiteNumber(p.ng ?? 0, 'NG pieces'), loft: finiteNumber(p.loft ?? 0, 'Loft pieces'), code: requireText(p.code, 'Reject code', 120), oht: String(p.oht || '').slice(0, 80), slabCode: String(p.slabCode || p.code || '').slice(0, 120), ngCode: String(p.ngCode || p.code || '').slice(0, 120), loftCode: String(p.loftCode || p.code || '').slice(0, 120), remarks: String(p.remarks || '').slice(0, 500) };
      if (result.returnRoll > 0 && !result.oht.trim()) throw new Error('OHT number is required for return roll rejects.');
      if (result.slab + result.returnRoll + result.ng + result.loft <= 0) throw new Error('Enter at least one reject quantity.');
      if (!Number.isInteger(result.ng) || !Number.isInteger(result.loft)) throw new Error('Piece quantities must be whole numbers.');
      return result;
    }
    if (kind === 'condition') return { heating: finiteNumber(p.heating, 'Heating'), cooling: finiteNumber(p.cooling, 'Cooling'), shuttle: requireText(p.shuttle, 'Shuttle', 80), waterjet: requireText(p.waterjet, 'Waterjet', 80), rh: finiteNumber(p.rh, 'RH temperature', 0, 500), ctr: finiteNumber(p.ctr, 'CTR temperature', 0, 500), lh: finiteNumber(p.lh, 'LH temperature', 0, 500), glueStd: finiteNumber(p.glueStd, 'Standard glue'), glueActual: finiteNumber(p.glueActual, 'Actual glue') };
    if (kind === 'mode') { if (!['NORMAL', 'REST'].includes(p.mode)) throw new Error('Invalid mode.'); return { mode: p.mode }; }
    if (kind === 'adjust') { if (![1, -1].includes(p.adjust)) throw new Error('Adjustment must be +1 or -1.'); return { adjust: p.adjust, reason: requireText(p.reason, 'Adjustment reason') }; }
    if (kind === 'timer') {
      if (!['update', 'start', 'stop', 'log', 'cancel'].includes(p.action)) throw new Error('Invalid timer action.');
      if (p.revision !== state.timer.revision) throw new Error('The timer changed on another device. Refresh and try again.');
      if (['stop', 'cancel'].includes(p.action)) return p;
      if (!['Machine', 'Quality', 'Production', 'Schedule', 'Planned Stop'].includes(p.category)) throw new Error('Choose a downtime category.');
      return { ...p, reason: requireText(p.reason, 'Reason'), actionTaken: p.action === 'log' ? requireText(p.actionTaken, 'Action taken') : String(p.actionTaken || '').slice(0, 500), targetMinutes: finiteNumber(p.targetMinutes ?? 0, 'Timer target', 0, 1440), duration: finiteNumber(p.duration ?? 0, 'Duration', 0, 1440), remarks: String(p.remarks || '').slice(0, 500) };
    }
    if (kind === 'henkaten') { if (!['man', 'machine', 'material', 'method'].includes(p.category) || !['OK', 'NG'].includes(p.status)) throw new Error('Invalid Henkaten category or status.'); return { category: p.category, status: p.status, issue: p.status === 'NG' ? requireText(p.issue, 'Issue') : '', action: requireText(p.action, p.status === 'OK' ? 'Resolution action' : 'Action / next step') }; }
    if (kind === 'verify') { if (!['verified', 'issue'].includes(p.status)) throw new Error('Choose a verification result.'); return { status: p.status, remarks: p.status === 'issue' ? requireText(p.remarks, 'Issue details') : String(p.remarks || '').slice(0, 500) }; }
    if (['report', 'end'].includes(kind)) return {};
    throw new Error('Unknown action.');
  }
  function localAction(kind, p, actor) {
    if (kind === 'report') return { reportId: createReport(actor) };
    if (kind === 'henkaten') { if (p.status === 'NG') issue(p.category, p.issue, actor, p.action); else resolveCategory(p.category, p.action, actor); }
    if (kind === 'verify') state.verification.push({ id: randomUUID(), shiftId: state.shift.id, actor, createdAt: new Date().toISOString(), ...p });
    commit(kind + ' saved', actor); return { ok: true };
  }
  const liveOperators = value => Array.isArray(value) ? value : typeof value === 'string' && value !== '-' ? value.split(',').map(v => v.trim()).filter(Boolean) : [];
  const liveDateTime = value => value && !/(Z|[+-]\d\d:\d\d)$/.test(value) ? `${value}+08:00` : value;
  const hourId = p => digest(JSON.stringify([p.shift_id, p.hour_slot, p.model, p.lot_number, p.plan, p.actual, p.rest_time, p.finalized_at]));
  function mapShift(p) { return { id: p.shift_id || `${p.prodDate?.replaceAll('-', '')}-${p.shift}-${(p.productionLine || line).replaceAll(' ', '')}`, date: p.prodDate, shift: p.shift, overtime: p.overtime, workingTime: p.workingTime, supervisor: p.supervisor, leader: p.lineLeader, forming: liveOperators(p.formingOperator), waterjet: liveOperators(p.waterjetOperator), assembly: liveOperators(p.assemblyOperator), quality: p.qualityOperator }; }
  function applyTimer(p) {
    const t = p.state; if (!t) return;
    state.timer = { id: t.id, status: t.status, revision: t.revision, startedAt: t.started_ms, stoppedAt: t.stopped_ms, elapsedSeconds: (t.elapsed_ms || 0) / 1000, targetMinutes: Number(t.data?.presetTime || 0), category: t.data?.downtimeCategory || 'Machine', reason: t.data?.cleanReasonName || t.data?.machineIssue || '', action: t.data?.actionTaken || '', remarks: t.data?.remarks || '' };
  }
  function commandStatus(id, status) { if (id) db.prepare('UPDATE commands SET status=? WHERE id=? AND line=?').run(status, id, line); }
  function publishCommand(id, kind, p, actor) {
    let topic; let payload;
    if (kind === 'shift') { topic = 'nodered/newshift'; const hours = p.shift === 'Day' ? p.overtime ? '8:00 AM to 8:00 PM' : '8:00 AM to 4:15 PM' : p.overtime ? '8:00 PM to 8:00 AM' : '4:15 PM to 12:30 AM'; payload = { productionLine: config.productionLine, shift: p.shift, prodDate: p.date, overtime: p.overtime, supervisor: p.supervisor, lineLeader: p.leader, formingOperator: p.forming, waterjetOperator: p.waterjet, assemblyOperator: p.assembly, qualityOperator: p.quality, workingTime: hours, event_id: id, testMode: false }; }
    if (kind === 'setup') { topic = 'nodered/modeltarget'; const m = models.find(m => m.name === p.model); payload = { model: p.model, lot_number: p.lot, standard_cycle: p.cycle, hourly_plan: p.plan, pcs_hr: m.pcsHr, std_slab_width: m.slabWidth, std_slab_length: m.slabLength, model_changed: state.setup?.model !== p.model, change_type: state.setup?.model !== p.model ? 'model_change' : 'lot_update', event_id: id }; }
    if (kind === 'mode') { topic = 'nodered/mode'; payload = p.mode; }
    if (kind === 'adjust') { topic = 'nodered/adjust_count'; payload = { adjust: p.adjust, reason: p.reason, operator: actor, event_id: id }; }
    if (kind === 'reject') { topic = 'nodered/reject'; payload = { totalSlabReject: p.slab, slabRejectCode: p.slabCode, totalReturnRoll: p.returnRoll, ohtNumber: p.oht, totalRejectNG: p.ng, ngRejectCode: p.ngCode, totalLoftLayerReject: p.loft, loftLayerRejectCode: p.loftCode, remarks: p.remarks, event_id: id }; }
    if (kind === 'condition') { topic = 'noderedparam/condition'; payload = { paramData: [{ model: state.setup.model, heating: p.heating, cooling: p.cooling, shuttle: p.shuttle, waterjet: p.waterjet }], tempData: [{ rh: p.rh, ctr: p.ctr, lh: p.lh }], glueData: [{ std: p.glueStd, act: p.glueActual }], event_id: id }; }
    if (kind === 'timer') { topic = 'nodered/downtime_session'; payload = { action: p.action, command_id: id, session_id: state.timer.id, revision: p.revision, data: { downtimeCategory: p.category, cleanReasonName: p.reason, machineIssue: p.reason, presetTime: p.targetMinutes, durationMinutes: p.duration, actionTaken: p.actionTaken, remarks: p.remarks } }; }
    if (!topic || !broker?.connected) throw new Error('The MQTT bridge is disconnected.');
    const baseline = { ...p, actor, expectedCount: kind === 'adjust' ? Math.max(0, state.live.shiftActual + p.adjust) : undefined };
    db.prepare('INSERT INTO commands(id,kind,status,created_at,payload,line) VALUES(?,?,?,?,?,?)').run(id, kind, 'pending', new Date().toISOString(), JSON.stringify(baseline), line);
    // Never retain commands or automatically replay them. Existing Python rejects/counts are not idempotent.
    broker.publish(topic, typeof payload === 'string' ? payload : JSON.stringify(payload), { qos: 0, retain: false }, error => { if (error) { commandStatus(id, 'failed'); commit('MQTT command failed', actor); } });
    broadcast();
  }
  function connect() {
    broker = mqttConnect(config.mqttUrl, { username: config.username || undefined, password: config.password || undefined, reconnectPeriod: 3000, queueQoSZero: false, clean: true });
    broker.on('connect', () => { mqttConnected = true; broker.subscribe(['smartchecksheet/live', 'smartchecksheet/hourly', `${line.toLowerCase()}/shift_form_result`, `${line.toLowerCase()}/downtime_result`, `${line.toLowerCase()}/status`]); broadcast(); });
    broker.on('offline', () => { mqttConnected = false; lastTelemetry = 0; broadcast(); });
    broker.on('close', () => { mqttConnected = false; lastTelemetry = 0; broadcast(); });
    broker.on('error', error => console.error('MQTT:', error.message));
    broker.on('message', (topic, buffer, packet = {}) => {
      try {
        const p = JSON.parse(buffer.toString());
        if (!p || typeof p !== 'object' || Array.isArray(p)) return;
        if (p.line_code && p.line_code !== line) return;
        if (topic === 'smartchecksheet/live') {
          // Retained data must never make a stopped Python process appear online.
          if (packet.retain || !Number.isFinite(p.server_ms) || Math.abs(Date.now() - p.server_ms) > 8000) return;
          if (config.requireLineCode && p.line_code !== line) return;
        }
        if (topic === line.toLowerCase() + '/status' && p.status === 'OFFLINE') { lastTelemetry = 0; broadcast(); return; }
        if (topic === 'smartchecksheet/live') {
          lastTelemetry = Date.now(); lastReceivedTelemetry = lastTelemetry;
          if (p.shift_id && p.shift_id !== 'NO PROD') {
            if (state.shift?.id !== p.shift_id) {
              if (state.shift?.status === 'active') { state.shift.status = 'ended'; createReport('Python recovery'); }
              activateShift({ id: p.shift_id, date: p.date, shift: p.shift, overtime: p.overtime, supervisor: p.supervisor, leader: p.leader, forming: liveOperators(p.forming_operator), waterjet: liveOperators(p.waterjet_operator), assembly: liveOperators(p.assembly_operator), quality: p.quality_inspector, workingTime: p.working_time }, 'Python');
            }
            state.shift.endAt = liveDateTime(p.scheduled_end_at); state.shift.startAt = liveDateTime(p.scheduled_start_at);
            state.setup = p.model && !['-', 'PENDING', 'UNKNOWN', 'NO PROD'].includes(p.model) ? { model: p.model, lot: p.lot_number, plan: p.hourly_plan, cycle: p.standard_cycle_time } : null;
          } else if (state.shift?.status === 'active') { state.shift.status = 'ended'; createReport('Python'); }
          if (p.shift_id === 'NO PROD' && state.shift?.status === 'ended') state.live = { ...state.live, status: 'Shift ended', timestamp: new Date().toISOString() };
          else state.live = { actual: p.hourly_output || 0, modelActual: p.product_count || 0, shiftActual: p.total_product_count || 0, plan: p.live_plan || 0, cycle: p.current_cycle_time || 0, mode: p.current_mode, status: ['Running', 'Loading', 'Delay', 'Rest', 'Downtime', 'Planned stop', 'Model change'][p.machine_status] || 'Waiting', slot: p.hour_slot, timestamp: new Date().toISOString() };
          if (p.downtime_session) applyTimer({ state: p.downtime_session });
          state.pendingShift = p.pending_shift ? mapShift(p.pending_shift) : null;
          for (const c of db.prepare("SELECT * FROM commands WHERE status='pending' AND line=?").all(line)) {
            const data = JSON.parse(c.payload);
            if (c.kind === 'mode' && p.current_mode === data.mode || c.kind === 'setup' && p.model === data.model && p.lot_number === data.lot) commandStatus(c.id, 'confirmed');
          }
        }
        if (topic === 'smartchecksheet/hourly') {
          const id = hourId(p);
          if (!state.hourly.some(r => r.id === id) && p.shift_id === state.shift?.id) state.hourly.push({ id, shiftId: p.shift_id, slot: p.hour_slot, model: p.model, lot: p.lot_number, plan: p.plan, actual: p.actual, restMinutes: p.rest_time });
        }
        if (topic === `${line.toLowerCase()}/shift_form_result`) {
          commandStatus(p.source_payload?.event_id, p.status === 'active' ? 'confirmed' : p.status === 'pending' ? 'scheduled' : p.status === 'ended' ? 'confirmed' : 'rejected');
          if (p.status === 'active' && p.source_payload) { const next = mapShift(p.source_payload); next.id = p.active_shift?.shift_id || next.id; if (state.shift?.id !== next.id || state.shift.status === 'ended') activateShift(next, 'Python'); }
          if (p.status === 'ended' && state.shift?.status === 'active') { state.shift.status = 'ended'; createReport('Python'); }
        }
        if (topic === `${line.toLowerCase()}/downtime_result`) {
          applyTimer(p); commandStatus(p.command_id, p.error ? 'rejected' : 'confirmed');
          if (p.log) { const id = p.log.event_id || digest(`${p.state?.id}:${p.state?.revision}:log`); if (!state.downtime.some(r => r.id === id)) { state.downtime.push({ id, shiftId: state.shift?.id, slot: p.log.hourSlot || slotNow(), category: p.log.category, reason: p.log.description, duration: p.log.durationMinutes, action: p.log.actionTaken, createdAt: new Date().toISOString(), actor: 'Python' }); if (['Machine', 'Production', 'Quality'].includes(p.log.category)) issue(p.log.category === 'Machine' ? 'machine' : 'method', p.log.description, 'Python', p.log.actionTaken); } }
        }
        // nodered/endshift is deliberately never published: Python also subscribes to it.
        // The original Node-RED OEE tab, telemetry and InfluxDB paths remain untouched.
        commit();
      } catch (e) { console.error('Ignored invalid MQTT message:', topic, e.message); }
    });
  }

  function applyEvent(target, e, sent = {}) {
    const p = e.payload;
    const record = { id: e.event_id, shiftId: e.shift_id || p.shift_id, slot: p.hour_slot || slotNow(), actor: sent.actor || 'Python', createdAt: e.occurred_at || new Date().toISOString() };
    if (record.shiftId !== target.shift?.id) return;
    if (e.event_type === 'hourly.finalized') {
      const id = hourId(p);
      if (!target.hourly.some(row => row.id === id)) target.hourly.push({ id, shiftId: record.shiftId, slot: p.hour_slot, model: p.model, lot: p.lot_number, plan: p.plan, actual: p.actual, restMinutes: p.rest_time });
    }
    if (e.event_type === 'reject.recorded' && !target.rejects.some(row => row.id === record.id)) {
      const row = { ...record, slab: Number(p.slab_quantity || 0), returnRoll: Number(p.return_roll_quantity || 0), ng: Number(p.ng_quantity || 0), loft: Number(p.loft_quantity || 0), code: p.ng_code || p.slab_code || p.loft_code, remarks: sent.remarks || '' };
      target.rejects.push(row);
      if (target === state) issue(row.slab || row.returnRoll ? 'material' : 'method', `Reject recorded: ${row.code}`, record.actor);
    }
    if (e.event_type === 'parameter.recorded' && !target.parameters.some(row => row.id === record.id)) {
      target.parameters.push({ ...record, ...p, glueStd: p.glue_standard, glueActual: p.glue_actual });
      if (target === state) resolveCategory('method', 'Parameters confirmed by Python', record.actor);
    }
    if (e.event_type === 'downtime.recorded') {
      const row = { ...record, category: p.category, reason: p.description, duration: Number(p.duration_minutes || 0), action: p.action_taken || '', remarks: p.remarks || '' };
      const index = target.downtime.findIndex(item => item.id === record.id);
      if (index >= 0) target.downtime[index] = row;
      else {
        target.downtime.push(row);
        if (target === state && ['Machine', 'Production', 'Quality'].includes(p.category)) issue(p.category === 'Machine' ? 'machine' : 'method', p.description, record.actor, row.action);
      }
    }
    if (e.event_type === 'model.configured' && p.source_payload?.model_changed && target === state) issue('method', `Model changed to ${p.model}. Confirm parameters.`, record.actor);
    if (e.event_type === 'shift.ended') {
      target.shift.status = 'ended';
      target.live.shiftActual = Number(p.shift_total_output || 0);
      target.live.modelActual = Number(p.model_total_output || 0);
    }
  }
  function ingest(e) {
    if (!e || e.line_code !== line || typeof e.event_id !== 'string' || !e.event_id || typeof e.event_type !== 'string' || !e.payload || typeof e.payload !== 'object' || Array.isArray(e.payload)) throw new Error('A valid event envelope for this line is required.');
    const eventKey = line + ':' + e.event_id;
    if (db.prepare('SELECT id FROM events WHERE id=?').get(eventKey)) return { ok: true, duplicate: true };
    // The independent Pi relay or central forwarder delivers this durable envelope.
    db.exec('BEGIN');
    const before = structuredClone(state);
    try {
      const p = e.payload; const c = db.prepare('SELECT * FROM commands WHERE id=? AND line=?').get(e.event_id, line); const sent = c ? JSON.parse(c.payload) : {};
      applyEvent(state, e, sent);
      if (e.event_type === 'shift.ended' && before.shift?.id === e.shift_id && before.shift.status === 'active') {
        db.prepare('INSERT INTO reports VALUES(?,?,?,?,?)').run(randomUUID(), state.shift.id, line, new Date().toISOString(), JSON.stringify(snapshot()));
      }
      // Reconcile delayed delivery into saved reports for the corresponding shift.
      for (const report of db.prepare('SELECT id,snapshot FROM reports WHERE line=? AND shift_id=?').all(line, e.shift_id || p.shift_id)) {
        const saved = JSON.parse(report.snapshot); applyEvent(saved, e, sent);
        db.prepare('UPDATE reports SET snapshot=? WHERE id=? AND line=?').run(JSON.stringify(saved), report.id, line);
      }
      commandStatus(e.event_id, 'confirmed'); state.revision++; state.updatedAt = new Date().toISOString(); persist();
      db.prepare('INSERT INTO events VALUES(?,?)').run(eventKey, new Date().toISOString());
      db.prepare('INSERT INTO machine_events(line,event_id,envelope) VALUES(?,?,?)').run(line, e.event_id, JSON.stringify(e));
      db.exec('COMMIT'); broadcast(); return { ok: true };
    } catch (error) { db.exec('ROLLBACK'); state = before; throw error; }
  }
  connect();
  return {
    connectionStatus() { return { brokerConnected: mqttConnected, lastTelemetryAt: lastReceivedTelemetry ? new Date(lastReceivedTelemetry).toISOString() : null, connected: telemetryFresh() }; },
    snapshot, ingest,
    action(kind, payload, actor) {
      if (!telemetryFresh() && !['henkaten', 'report', 'verify'].includes(kind)) throw new Error(line + ' Python is disconnected. No command was sent.');
      if (!['shift', 'henkaten', 'report', 'verify'].includes(kind) && state.shift?.status !== 'active') throw new Error('Start an active shift first.');
      if (['condition', 'reject', 'adjust'].includes(kind) && !state.setup) throw new Error('Confirm model and lot setup first.');
      if (['report', 'verify'].includes(kind) && !state.shift) throw new Error('A shift is required.');
      const p = validate(kind, payload);
      if (['henkaten', 'report', 'verify'].includes(kind)) return localAction(kind, p, actor);
      if (kind === 'end') throw new Error('Python owns production shift endings.');
      if (['reject', 'condition', 'adjust'].includes(kind) && !config.ingestToken) throw new Error('Configure this line durable-event receiver first.');
      const id = randomUUID(); publishCommand(id, kind, p, actor);
      return { pending: true, commandId: id, message: 'Sent to ' + line + '. Waiting for Python confirmation.' };
    },
    report(id) { return db.prepare('SELECT snapshot FROM reports WHERE id=? AND line=?').get(id, line); },
    close() { broker?.end(); }
  };
}
