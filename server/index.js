import express from 'express';
import { randomUUID, randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { liveConfigs } from './machineConfig.js';
import { createLiveWorkspace } from './liveWorkspace.js';
import { openStore, hashPassword, verifyPassword, publicUser, digest, syncDeveloperLines } from './store.js';
import { seedState, models as demoModels, people as demoPeople } from './seed.js';
import { canWrite, canManage, roles, finiteNumber, requireText, slotNow, emptyTimer, shiftSchedule } from './domain.js';
import { renderReport } from './pdf.js';
import { attendanceConfig, createAttendanceBridge } from './attendance.js';
import { updatePage } from './updatePage.js';
import { createManualWorkspace } from './manualWorkspace.js';
import { createCmmsBridge } from './cmms.js';

const mode = process.env.APP_MODE || 'attendance';
if (!['attendance', 'demo', 'live'].includes(mode)) throw new Error('APP_MODE must be attendance, demo or live.');
const dbPath = process.env.DATABASE_PATH || `./data/production-${mode}.sqlite`;
if (mode === 'live' && /demo/i.test(dbPath)) throw new Error('Live mode must use a separate production database.');
if (mode === 'live' && (!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD.length < 12)) throw new Error('Set ADMIN_PASSWORD to at least 12 characters before starting live mode.');
const machines = mode === 'live' ? liveConfigs() : new Map();

const catalog = mode === 'demo' ? { models: demoModels, people: demoPeople } : { models: [], people: { supervisors: [], leaders: [], operators: [], quality: [] } };
const { models, people } = catalog;
if (mode === 'demo' && (!Array.isArray(models) || !models.length || models.some(m => !m.name || !Number.isFinite(m.cycle) || m.cycle <= 0 || !Number.isFinite(m.pcsHr) || m.pcsHr <= 0) || !people || ['supervisors', 'leaders', 'operators', 'quality'].some(key => !Array.isArray(people[key]) || !people[key].length))) throw new Error('Catalog must contain valid models and manpower lists.');
const db = openStore(dbPath === ':memory:' ? dbPath : resolve(dbPath));
let state = mode === 'attendance' ? seedState(false) : JSON.parse(db.prepare('SELECT value FROM state WHERE line = ?').get('ABB2')?.value || JSON.stringify(seedState(mode === 'demo')));
const app = express();
app.disable('x-powered-by');
if (process.env.TRUST_PROXY === 'true') app.set('trust proxy', 'loopback');
app.use('/api/cmms/work-orders', express.json({ limit: '12mb' }));
app.use(express.json({ limit: '128kb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
  if (['POST', 'PATCH', 'DELETE'].includes(req.method) && req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return res.status(403).json({ error: 'Cross-site requests are not allowed.' });
  next();
});
const adminName = process.env.ADMIN_USERNAME || 'developer';
const configuredAccountLines = () => [...new Set(['ABB2', ...attendanceConfig().groups.flatMap(g => g.accountLines), ...machines.keys()])];
if (!db.prepare('SELECT id FROM users WHERE username = ?').get(adminName)) {
  const password = process.env.ADMIN_PASSWORD || randomBytes(15).toString('base64url');
  db.prepare('INSERT INTO users(id, username, name, role, lines, password) VALUES(?,?,?,?,?,?)').run(randomUUID(), adminName, 'Developer', 'developer', JSON.stringify(configuredAccountLines()), hashPassword(password));
  if (!process.env.ADMIN_PASSWORD) console.log(`Local account: ${adminName}\nTemporary password: ${password}\nSet ADMIN_PASSWORD for deployment.`);
}
const listeners = new Map();
const manualWorkspaces = new Map();
const liveWorkspaces = new Map();
function workspaceFor(line) {
  if (machines.has(line)) {
    if (!liveWorkspaces.has(line)) liveWorkspaces.set(line, createLiveWorkspace({ db, config: machines.get(line), onChange: () => broadcast() }));
    return liveWorkspaces.get(line);
  }
  if (mode === 'demo' && line === 'ABB2') return null;
  if (!manualWorkspaces.has(line)) manualWorkspaces.set(line, createManualWorkspace({ db, line, onChange: () => broadcast() }));
  return manualWorkspaces.get(line);
}
// Upgrade existing developers too, including accounts created before multi-line access.
syncDeveloperLines(db, configuredAccountLines());

const telemetryFresh = () => mode === 'demo';
function persist() { if (mode === 'demo') db.prepare('INSERT INTO state(line,value) VALUES(?,?) ON CONFLICT(line) DO UPDATE SET value=excluded.value').run('ABB2', JSON.stringify(state)); }
function snapshot() {
  return { ...state, mode, connected: telemetryFresh(), serverTime: Date.now(),
    oeeUrl: process.env.OEE_DASHBOARD_URL || '', models, people,
    reports: mode === 'attendance' ? [] : db.prepare('SELECT id, shift_id AS shiftId, created_at AS createdAt FROM reports WHERE line = ? ORDER BY created_at DESC LIMIT 100').all('ABB2'),
    commands: mode === 'attendance' ? [] : db.prepare("SELECT id, kind, status, created_at AS createdAt FROM commands ORDER BY created_at DESC LIMIT 8").all() };
}
function broadcast() {
  for (const [res, session] of listeners) {
    const user = db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>?').get(session.token, Date.now());
    if (!user?.active || !JSON.parse(user.lines).includes(session.line)) { res.end(); listeners.delete(res); }
    else res.write(`event: state\ndata: ${JSON.stringify(workspaceFor(session.line)?.snapshot() || snapshot())}\n\n`);
  }
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
  db.prepare('INSERT INTO reports VALUES(?,?,?,?,?)').run(id, state.shift.id, 'ABB2', new Date().toISOString(), JSON.stringify(snapshot()));
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
  if (!people.supervisors.includes(p.supervisor) || !people.leaders.includes(p.leader) || !people.quality.includes(quality) || operators.some(name => !people.operators.includes(name))) throw new Error('Select manpower from the configured ABB2 catalog.');
  if (new Set([...operators, quality]).size !== operators.length + 1) throw new Error('An operator cannot occupy multiple roles in one shift.');
  return { id: `${p.date.replaceAll('-', '')}-${p.shift}-ABB2`, date: p.date, shift: p.shift, overtime: p.overtime === true, supervisor: requireText(p.supervisor, 'Supervisor', 80), leader: requireText(p.leader, 'Leader', 80), forming: p.forming, waterjet: p.waterjet, assembly: p.assembly, quality, ...schedule };
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
function demoAction(kind, p, actor) {
  const record = { id: randomUUID(), shiftId: state.shift?.id, slot: state.live.slot, actor, createdAt: new Date().toISOString() };
  if (kind === 'shift') {
    if (state.shift?.status === 'active' && state.shift.id === p.id) throw new Error('This shift is already active.');
    if (Date.parse(p.endAt) <= Date.now()) throw new Error('This shift has already ended.');
    if (Date.parse(p.startAt) > Date.now()) { state.pendingShift = p; } else activateShift(p, actor);
  }
  if (kind === 'setup') {
    const changed = state.setup?.model !== p.model;
    if (state.setup && (changed || state.setup.lot !== p.lot)) finalizeHour();
    state.setup = { ...p, configuredAt: record.createdAt }; state.live.status = 'Running';
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
    if (state.timer.status !== 'idle') throw new Error('Log or cancel the downtime timer before ending the demo shift.');
    finalizeHour(); state.shift.status = 'ended'; state.live.status = 'Shift ended'; const id = createReport(actor); commit('Demo shift ended', actor); return { reportId: id };
  }
  commit(`${kind === 'adjust' ? `Count adjusted ${p.adjust > 0 ? '+1' : '-1'}: ${p.reason}` : kind === 'timer' ? `Downtime ${p.action}` : kind === 'henkaten' ? `${p.category} ${p.status}: ${p.action}` : `${kind[0].toUpperCase() + kind.slice(1)} saved`}`, actor);
  return { ok: true };
}

function cookieToken(req) { const entry = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith('pd_session=')); return entry?.slice(11); }
function authenticate(req, res, next) {
  const token = cookieToken(req);
  const session = token ? db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>?').get(digest(token), Date.now()) : null;
  if (!session?.active) return res.status(401).json({ error: 'Please sign in.', code: token ? 'SESSION_INVALID' : 'SESSION_MISSING' });
  req.user = publicUser(session); next();
}
function lineAccess(req, res, next) {
  const queryLine = req.query.line;
  const headerLine = req.get('X-Checksheet-Line');
  if (queryLine && headerLine && queryLine !== headerLine) return res.status(400).json({ error: 'The selected line changed. Refresh the workspace.' });
  const line = queryLine || headerLine || req.user.lines[0];
  if (typeof line !== 'string' || !configuredAccountLines().includes(line) || !req.user.lines.includes(line)) return res.status(403).json({ error: 'Your account has no access to this line.' });
  req.line = line; req.workspace = workspaceFor(line); next();
}
function startSession(res, user) {
  const token = randomBytes(32).toString('hex'); const ttl = user.role === 'display' ? 30 * 86400000 : 8 * 3600000;
  db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now());
  db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(digest(token), user.id, Date.now() + ttl);
  res.setHeader('Set-Cookie', `pd_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${ttl / 1000}${process.env.COOKIE_SECURE === 'true' ? '; Secure' : ''}`);
  res.json({ user: publicUser(user) });
}
app.get('/api/health', (_req, res) => res.json({ ok: true, mode, machines: Object.fromEntries([...liveWorkspaces].map(([line, workspace]) => [line, { connected: workspace.snapshot().connected }])) }));
app.get('/api/config', (_req, res) => res.json({ mode, demo: mode === 'demo' }));
app.get('/api/app-update', (_req, res) => res.type('html').send(updatePage));
const attempts = new Map();
app.post('/api/auth/login', (req, res) => {
  const ip = req.ip; const limit = attempts.get(ip) || { count: 0, until: Date.now() + 900000 };
  if (limit.until < Date.now()) { limit.count = 0; limit.until = Date.now() + 900000; }
  if (limit.count >= 10) return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
  const user = db.prepare('SELECT * FROM users WHERE username=?').get(String(req.body.username || '').toLowerCase());
  if (!user?.active || !verifyPassword(req.body.password, user.password)) { limit.count++; attempts.set(ip, limit); return res.status(401).json({ error: 'Incorrect username or password.' }); }
  attempts.delete(ip); startSession(res, user);
});
app.post('/api/auth/demo', (_req, res) => { if (mode !== 'demo') return res.status(404).json({ error: 'Unavailable.' }); startSession(res, db.prepare('SELECT * FROM users WHERE username=?').get(adminName)); });
app.get('/api/auth/me', authenticate, (req, res) => res.json({ user: req.user }));
app.get('/api/account-lines', authenticate, (_req, res) => res.json({ lines: configuredAccountLines() }));
app.post('/api/auth/logout', authenticate, (req, res) => { const token = digest(cookieToken(req)); db.prepare('DELETE FROM sessions WHERE token=?').run(token); for (const [client, session] of listeners) if (session.token === token) { client.end(); listeners.delete(client); } res.setHeader('Set-Cookie', 'pd_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'); res.json({ ok: true }); });
app.get('/api/state', authenticate, lineAccess, (req, res) => res.json(req.workspace?.snapshot() || snapshot()));
const attendanceBridges = new Map();
function attendanceBridge(req, res) {
  if (!attendanceBridges.has(req.line)) {
    const config = attendanceConfig();
    attendanceBridges.set(req.line, createAttendanceBridge({ ...config, groups: config.groups.filter(group => group.accountLines.includes(req.line)) }));
  }
  return attendanceBridges.get(req.line)(req, res);
}
app.get('/api/attendance', authenticate, lineAccess, attendanceBridge);
app.get('/api/attendance/photos/:employeeId', authenticate, lineAccess, attendanceBridge);
const cmmsBridge = createCmmsBridge({ db });
app.get('/api/cmms/work-orders', authenticate, lineAccess, cmmsBridge);
app.get('/api/cmms/work-orders/:id', authenticate, lineAccess, cmmsBridge);
app.get('/api/cmms/work-orders/:id/photos/:photoId', authenticate, lineAccess, cmmsBridge);
app.post('/api/cmms/work-orders', authenticate, lineAccess, cmmsBridge);
app.patch('/api/cmms/work-orders/:id/verification', authenticate, lineAccess, cmmsBridge);
app.get('/api/events', authenticate, lineAccess, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream'); res.setHeader('Connection', 'keep-alive'); res.setHeader('X-Accel-Buffering', 'no'); res.flushHeaders();
  res.write(`event: state\ndata: ${JSON.stringify(req.workspace?.snapshot() || snapshot())}\n\n`); listeners.set(res, { userId: req.user.id, token: digest(cookieToken(req)), line: req.line });
  req.on('close', () => listeners.delete(res));
});
app.post('/api/actions/:kind', authenticate, lineAccess, (req, res) => {
  const kind = req.params.kind;
  if (kind === 'report' || kind === 'verify') { if (!canManage(req.user)) return res.status(403).json({ error: 'Management access is required.' }); }
  else if (!canWrite(req.user)) return res.status(403).json({ error: 'This account is read-only.' });
  try {
    if (req.workspace) { const result = req.workspace.action(kind, req.body, req.user.name); return res.status(result.pending ? 202 : 200).json(result); }
    if (!['shift', 'henkaten'].includes(kind) && (!state.shift || state.shift.status !== 'active') && !['report', 'verify'].includes(kind)) throw new Error('Start an active shift first.');
    if (['condition', 'reject', 'adjust'].includes(kind) && !state.setup) throw new Error('Confirm model and lot setup first.');
    const payload = validate(kind, req.body);
    return res.json(demoAction(kind, payload, req.user.name));
  } catch (error) { res.status(400).json({ error: error.message }); }
});
app.get('/api/reports/:id/pdf', authenticate, lineAccess, (req, res) => { const r = req.workspace ? req.workspace.report(req.params.id) : db.prepare('SELECT * FROM reports WHERE id=? AND line=?').get(req.params.id, req.line); if (!r) return res.status(404).json({ error: 'Report not found for this line.' }); renderReport(JSON.parse(r.snapshot), res, req.params.id); });
app.get('/api/users', authenticate, (req, res) => { if (!canManage(req.user)) return res.status(403).json({ error: 'Management access required.' }); res.json(db.prepare('SELECT * FROM users ORDER BY name').all().map(publicUser)); });
app.post('/api/users', authenticate, (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: 'Management access required.' });
  try {
    const p = req.body; const username = requireText(p.username, 'Username', 40).toLowerCase(); if (!/^[a-z0-9._-]+$/.test(username)) throw new Error('Username can contain letters, numbers, dots, hyphens and underscores.');
    if (!roles.includes(p.role) || req.user.role !== 'developer' && ['developer', 'management'].includes(p.role)) throw new Error('You cannot assign this role.');
    if (typeof p.password !== 'string' || p.password.length < 12 || p.password.length > 200) throw new Error('Use a password of 12–200 characters.');
    const accountLines = new Set(configuredAccountLines());
    if (!Array.isArray(p.lines) || p.lines.some(line => !accountLines.has(line))) throw new Error('Select a configured account line.');
    const lines = p.role === 'developer' ? configuredAccountLines() : p.lines;
    db.prepare('INSERT INTO users(id,username,name,role,lines,password) VALUES(?,?,?,?,?,?)').run(randomUUID(), username, requireText(p.name, 'Name', 80), p.role, JSON.stringify(lines), hashPassword(p.password));
    commit(`Account created: ${username}`, req.user.name); res.status(201).json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message.includes('UNIQUE') ? 'That username already exists.' : e.message }); }
});
app.patch('/api/users/:id', authenticate, (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: 'Management access required.' });
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Account not found.' });
  if (user.id === req.user.id) return res.status(400).json({ error: 'You cannot disable your own account.' });
  if (req.user.role !== 'developer' && ['developer', 'management'].includes(user.role)) return res.status(403).json({ error: 'Only a developer can change this account.' });
  if (typeof req.body.active !== 'boolean') return res.status(400).json({ error: 'Specify an active flag.' });
  db.prepare('UPDATE users SET active=? WHERE id=?').run(Number(req.body.active), user.id);
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id); commit(`Account ${req.body.active ? 'enabled' : 'disabled'}: ${user.username}`, req.user.name); res.json({ ok: true });
});

app.post('/api/integrations/events', (req, res) => {
  const config = machines.get(req.body?.line_code);
  if (mode !== 'live' || !config?.ingestToken || req.headers.authorization !== 'Bearer ' + config.ingestToken) return res.status(401).json({ error: 'Unauthorized.' });
  try { res.json(workspaceFor(config.line).ingest(req.body)); }
  catch (error) { res.status(400).json({ error: error.message }); }
});

for (const line of configuredAccountLines()) workspaceFor(line);

let ticks = 0;
const interval = setInterval(() => {
  for (const workspace of manualWorkspaces.values()) workspace.tick();
  ticks++;
  if (mode === 'demo' && state.pendingShift && Date.parse(state.pendingShift.startAt) <= Date.now()) { activateShift(state.pendingShift, 'Demo scheduler'); commit('Scheduled demo shift activated'); }
  if (mode === 'demo' && state.shift?.status === 'active' && state.shift.endAt && Date.parse(state.shift.endAt) <= Date.now() && state.timer.status === 'idle') demoAction('end', {}, 'Demo scheduler');
  if (mode === 'demo' && state.timer.status === 'running' && state.timer.targetMinutes > 0 && Date.now() - state.timer.startedAt >= state.timer.targetMinutes * 60000) { demoAction('timer', { action: 'stop' }, 'Demo timer'); }
  if (mode === 'demo' && state.shift?.status === 'active' && state.setup && state.live.mode === 'NORMAL' && ticks % 8 === 0) {
    if (state.live.slot !== slotNow()) { finalizeHour(); state.live.slot = slotNow(); }
    state.live.actual++; state.live.modelActual++; state.live.shiftActual++; state.live.plan = Math.max(state.live.plan, state.live.actual + 6); state.live.timestamp = new Date().toISOString(); commit();
  } else broadcast();
  if (ticks % 10 === 0) { db.prepare("UPDATE commands SET status='unconfirmed' WHERE status='pending' AND created_at < ?").run(new Date(Date.now() - 30000).toISOString()); }
}, 1000);
persist();
const dist = resolve('dist');
if (existsSync(dist)) { app.use(express.static(dist, { maxAge: '1h', setHeaders: (res, path) => { if (path.endsWith('sw.js') || path.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache'); } })); app.get('/{*path}', (req, res) => { if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Endpoint not found.' }); res.sendFile(resolve(dist, 'index.html')); }); }
app.use((error, _req, res, _next) => { console.error(error.message); res.status(400).json({ error: 'Invalid request.' }); });
const server = app.listen(Number(process.env.PORT || 3700), process.env.HOST || '127.0.0.1', () => console.log(`Production Digital (${mode}) on http://${process.env.HOST || '127.0.0.1'}:${process.env.PORT || 3700}`));
function shutdown() { clearInterval(interval); for (const res of listeners.keys()) res.end(); for (const workspace of liveWorkspaces.values()) workspace.close(); server.close(() => { db.close(); process.exit(0); }); }
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
