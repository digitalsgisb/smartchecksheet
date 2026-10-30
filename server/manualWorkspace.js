import { randomUUID } from 'node:crypto';
import { emptyTimer, slotNow, shiftSchedule, finiteNumber, requireText } from './domain.js';
import { seedState } from './seed.js';

// Each line has an independent closure and SQLite key. No machine connection or simulator.
export function createManualWorkspace({ db, line, onChange = () => {} }) {
  const storageKey = 'manual:' + line;
  let state = JSON.parse(db.prepare('SELECT value FROM state WHERE line=?').get(storageKey)?.value || JSON.stringify({ ...seedState(false), line }));
  function persist() { db.prepare('INSERT INTO state(line,value) VALUES(?,?) ON CONFLICT(line) DO UPDATE SET value=excluded.value').run(storageKey, JSON.stringify(state)); }
  function snapshot() {
    return { ...state, mode: 'manual', connected: true, machineConnected: false, serverTime: Date.now(), oeeUrl: '', models: [], people: { supervisors: [], leaders: [], operators: [], quality: [] }, commands: [],
      reports: db.prepare('SELECT id, shift_id AS shiftId, created_at AS createdAt FROM reports WHERE line=? ORDER BY created_at DESC LIMIT 100').all(storageKey) };
  }
  function commit(label, actor = 'System', changes) {
    state.revision++; state.updatedAt = new Date().toISOString();
    if (label) state.audit.unshift({ id: randomUUID(), label, actor, createdAt: state.updatedAt, ...(changes ? { changes } : {}) });
    state.audit = state.audit.slice(0, 250); persist(); onChange(line);
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
    db.prepare('INSERT INTO reports VALUES(?,?,?,?,?)').run(id, state.shift.id, storageKey, new Date().toISOString(), JSON.stringify(snapshot()));
    commit('PDF report generated', actor); return id;
  }
  function finalizeHour() {
    if (!state.shift || !state.setup || state.live.actual === 0 && state.live.plan === 0) return;
    state.hourly.push({ id: randomUUID(), shiftId: state.shift.id, slot: state.live.slot, model: state.setup.model, lot: state.setup.lot, plan: state.live.plan, actual: state.live.actual, restMinutes: 0 });
    state.live.actual = 0; state.live.plan = 0;
  }
  function activateShift(p, actor) {
    if (state.shift?.status === 'active' && state.shift.id !== p.id) { finalizeHour(); state.shift.status = 'ended'; createReport(actor); }
    state.shift = { ...p, status: 'active' }; state.pendingShift = null; state.setup = null;
    state.hourly = []; state.rejects = []; state.downtime = []; state.parameters = []; state.verification = [];
    state.live = { actual: 0, modelActual: 0, shiftActual: 0, plan: 0, cycle: 0, mode: 'NORMAL', status: 'Waiting for setup', slot: slotNow(), timestamp: new Date().toISOString() };
    state.timer = emptyTimer(state.timer.revision + 1);
    // Open issues persist across shifts until explicitly resolved.
    issue('man', `Confirm manpower for ${p.shift} shift`, actor);
  }
  function validateShift(p) {
    const schedule = shiftSchedule(p.date, p.shift, p.overtime === true);
    const operators = ['forming', 'waterjet', 'assembly'].flatMap(key => {
      if (!Array.isArray(p[key]) || !p[key].length) throw new Error(`Select at least one ${key} operator.`);
      return p[key].map(v => requireText(v, 'Operator', 80));
    });
    const quality = requireText(p.quality, 'Quality inspector', 80);
    if (new Set([...operators, quality]).size !== operators.length + 1) throw new Error('An operator cannot occupy multiple roles in one shift.');
    return { id: `${p.date.replaceAll('-', '')}-${p.shift}-${line}`, date: p.date, shift: p.shift, overtime: p.overtime === true, supervisor: requireText(p.supervisor, 'Supervisor', 80), leader: requireText(p.leader, 'Leader', 80), forming: p.forming, waterjet: p.waterjet, assembly: p.assembly, quality, ...schedule };
  }
  function validate(kind, p) {
    if (kind === 'shift-edit') {
      if (p.expectedShiftId !== state.shift?.id || p.expectedVersion !== (state.shift?.editVersion || 0)) throw new Error('Shift details changed. Reopen Edit shift and try again.');
      const updated = validateShift(p);
      if (Date.parse(updated.startAt) > Date.now() || Date.parse(updated.endAt) <= Date.now()) throw new Error('The edited working hours must include the current time. Use Next shift to schedule another shift.');
      return updated;
    }
    if (kind === 'shift') return validateShift(p);
    if (kind === 'setup') {
      const plan = finiteNumber(p.plan, 'Hourly target', 1, 10000);
      if (!Number.isInteger(plan)) throw new Error('Hourly target must be a whole number.');
      return { model: requireText(p.model, 'Model', 120), lot: requireText(p.lot, 'Lot number', 80), plan, cycle: finiteNumber(p.cycle, 'Standard cycle', 0.001, 10000) };
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
  function applyAction(kind, p, actor) {
    const record = { id: randomUUID(), shiftId: state.shift?.id, slot: state.live.slot, actor, createdAt: new Date().toISOString() };
    if (kind === 'shift-edit') {
      // Keep the original ID and every production record; this is not a new shift.
      const before = { ...state.shift };
      state.shift = { ...state.shift, ...p, id: before.id, status: 'active', editVersion: (before.editVersion || 0) + 1, editedAt: record.createdAt, editedBy: actor };
      commit('Shift details edited', actor, { before, after: { ...state.shift } });
      return { ok: true };
    }
    if (kind === 'shift') {
      if (state.shift?.status === 'active' && state.shift.id === p.id) throw new Error('This shift is already active.');
      if (Date.parse(p.endAt) <= Date.now()) throw new Error('This shift has already ended.');
      if (Date.parse(p.startAt) > Date.now()) { state.pendingShift = p; } else activateShift(p, actor);
    }
    if (kind === 'setup') {
      const changed = state.setup?.model !== p.model;
      if (state.setup && (changed || state.setup.lot !== p.lot)) finalizeHour();
      state.setup = { ...p, configuredAt: record.createdAt }; state.live.plan = p.plan; state.live.status = 'Manual recording';
      if (changed) { state.live.modelActual = 0; issue('method', `Model changed to ${p.model}. Confirm parameter condition.`, actor); }
    }
    if (kind === 'reject') { state.rejects.push({ ...record, ...p }); issue(p.slab || p.returnRoll ? 'material' : 'method', `Reject recorded: ${p.code}`, actor, p.remarks); }
    if (kind === 'condition') { state.parameters.push({ ...record, ...p, model: state.setup.model }); resolveCategory('method', 'Parameter condition confirmed', actor); }
    if (kind === 'mode') { if (state.timer.status === 'running') throw new Error('Stop the shared downtime timer before changing mode.'); state.live.mode = p.mode; state.live.status = p.mode === 'REST' ? 'Rest' : 'Running'; }
    if (kind === 'adjust') { state.live.actual = Math.max(0, state.live.actual + p.adjust); state.live.modelActual = Math.max(0, state.live.modelActual + p.adjust); state.live.shiftActual = Math.max(0, state.live.shiftActual + p.adjust); }
    if (kind === 'timer') {
      const t = state.timer;
      if (p.action === 'start' && t.status !== 'idle') throw new Error('Log or cancel the current timer before starting another.');
      if (['start', 'update'].includes(p.action)) {
        if (p.action === 'update' && t.status !== 'idle') throw new Error('The active timer reason is locked.');
        Object.assign(t, { category: p.category, reason: p.reason, targetMinutes: p.targetMinutes, action: p.actionTaken, remarks: p.remarks });
        if (p.action === 'start') { t.id = randomUUID(); t.status = 'running'; t.startedAt = Date.now(); t.elapsedSeconds = 0; state.live.mode = p.category === 'Planned Stop' ? 'PLANNED STOP' : 'DOWN'; state.live.status = 'Downtime'; }
      }
      if (p.action === 'stop') { if (t.status !== 'running') throw new Error('No running timer to stop.'); t.elapsedSeconds = Math.max(0, (Date.now() - t.startedAt) / 1000); t.stoppedAt = Date.now(); t.status = 'stopped'; state.live.mode = 'NORMAL'; state.live.status = 'Running'; }
      if (p.action === 'log') {
        if (t.status === 'running') throw new Error('Stop the timer before logging.');
        const duration = t.status === 'stopped' ? Math.max(1, Math.ceil(t.elapsedSeconds / 60)) : p.duration;
        if (duration <= 0) throw new Error('Enter a positive duration or start a timer.');
        const category = t.status === 'stopped' ? t.category : p.category; const reason = t.status === 'stopped' ? t.reason : p.reason;
        state.downtime.push({ ...record, category, reason, duration, action: p.actionTaken, remarks: p.remarks });
        if (['Machine', 'Quality', 'Production'].includes(category)) issue(category === 'Machine' ? 'machine' : 'method', reason, actor, p.actionTaken);
        state.timer = emptyTimer(t.revision + 1); state.live.mode = 'NORMAL'; state.live.status = 'Running';
      } else if (p.action === 'cancel') { state.timer = emptyTimer(t.revision + 1); state.live.mode = 'NORMAL'; state.live.status = 'Running'; } else t.revision++;
    }
    if (kind === 'henkaten') { if (p.status === 'NG') issue(p.category, p.issue, actor, p.action); else resolveCategory(p.category, p.action, actor); }
    if (kind === 'verify') state.verification.push({ ...record, ...p });
    if (kind === 'report') return { reportId: createReport(actor) };
    if (kind === 'end') {
      if (state.timer.status !== 'idle') throw new Error('Log or cancel the downtime timer before ending the shift.');
      finalizeHour(); state.shift.status = 'ended'; state.live.status = 'Shift ended'; const id = createReport(actor); commit('Shift ended', actor); return { reportId: id };
    }
    commit(`${kind === 'adjust' ? `Count adjusted ${p.adjust > 0 ? '+1' : '-1'}: ${p.reason}` : kind === 'timer' ? `Downtime ${p.action}` : kind === 'henkaten' ? `${p.category} ${p.status}: ${p.action}` : `${kind[0].toUpperCase() + kind.slice(1)} saved`}`, actor);
    return { ok: true };
  }


  return {
    snapshot,
    action(kind, payload, actor) {
      if (!['shift', 'henkaten', 'report', 'verify'].includes(kind) && state.shift?.status !== 'active') throw new Error('Start an active shift first.');
      if (['condition', 'reject', 'adjust'].includes(kind) && !state.setup) throw new Error('Save model and lot setup first.');
      if (['report', 'verify'].includes(kind) && !state.shift) throw new Error('A shift is required.');
      return applyAction(kind, validate(kind, payload), actor);
    },
    report(id) { return db.prepare('SELECT snapshot FROM reports WHERE id=? AND line=?').get(id, storageKey); },
    tick() {
      if (state.pendingShift && Date.parse(state.pendingShift.startAt) <= Date.now()) { activateShift(state.pendingShift, 'Shift scheduler'); commit('Scheduled shift activated'); }
      if (state.timer.status === 'running' && state.timer.targetMinutes > 0 && Date.now() - state.timer.startedAt >= state.timer.targetMinutes * 60000) applyAction('timer', { action: 'stop' }, 'Timer');
      if (state.shift?.status === 'active' && state.shift.endAt && Date.parse(state.shift.endAt) <= Date.now() && state.timer.status === 'idle') applyAction('end', {}, 'Shift scheduler');
      if (state.shift?.status === 'active' && state.setup && state.live.slot !== slotNow()) { finalizeHour(); state.live.slot = slotNow(); state.live.plan = state.setup.plan; commit('Hour finalized'); }
    }
  };
}
