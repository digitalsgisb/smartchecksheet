import express from 'express';
import { randomUUID, randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import mqtt from 'mqtt';
import { openStore, hashPassword, verifyPassword, publicUser, digest, syncDeveloperLines } from './store.js';
import { seedState, models as demoModels, people as demoPeople } from './seed.js';
import { canWrite, canManage, roles, finiteNumber, requireText, slotNow, emptyTimer, shiftSchedule } from './domain.js';
import { renderReport } from './pdf.js';
import { attendanceConfig, createAttendanceBridge } from './attendance.js';
import { updatePage } from './updatePage.js';

const mode = process.env.APP_MODE || 'attendance';
if (!['attendance', 'demo', 'live'].includes(mode)) throw new Error('APP_MODE must be attendance, demo or live.');
const dbPath = process.env.DATABASE_PATH || `./data/production-${mode}.sqlite`;
if (mode === 'live' && /demo/i.test(dbPath)) throw new Error('Live mode must use a separate production database.');
if (mode === 'live' && (!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD.length < 12)) throw new Error('Set ADMIN_PASSWORD to at least 12 characters before starting live mode.');
if (mode === 'live' && !process.env.MQTT_URL) throw new Error('Live mode requires the private ABB2 MQTT_URL.');
if (mode === 'live' && !process.env.CATALOG_PATH) throw new Error('Live mode requires CATALOG_PATH with verified ABB2 models and manpower. Demo catalogs are never used for production.');
const catalog = mode === 'live' ? JSON.parse(readFileSync(resolve(process.env.CATALOG_PATH), 'utf8')) : mode === 'demo' ? { models: demoModels, people: demoPeople } : { models: [], people: { supervisors: [], leaders: [], operators: [], quality: [] } };
const { models, people } = catalog;
if (mode !== 'attendance' && (!Array.isArray(models) || !models.length || models.some(m => !m.name || !Number.isFinite(m.cycle) || m.cycle <= 0 || !Number.isFinite(m.pcsHr) || m.pcsHr <= 0) || !people || ['supervisors', 'leaders', 'operators', 'quality'].some(key => !Array.isArray(people[key]) || !people[key].length))) throw new Error('Catalog must contain valid models and manpower lists.');
const db = openStore(dbPath === ':memory:' ? dbPath : resolve(dbPath));
let state = mode === 'attendance' ? seedState(false) : JSON.parse(db.prepare('SELECT value FROM state WHERE line = ?').get('ABB2')?.value || JSON.stringify(seedState(mode === 'demo')));
const app = express();
app.disable('x-powered-by');
if (process.env.TRUST_PROXY === 'true') app.set('trust proxy', 'loopback');
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
const configuredAccountLines = () => [...new Set(['ABB2', ...attendanceConfig().groups.flatMap(g => g.accountLines)])];
if (!db.prepare('SELECT id FROM users WHERE username = ?').get(adminName)) {
  const password = process.env.ADMIN_PASSWORD || randomBytes(15).toString('base64url');
  db.prepare('INSERT INTO users(id, username, name, role, lines, password) VALUES(?,?,?,?,?,?)').run(randomUUID(), adminName, 'Developer', 'developer', JSON.stringify(configuredAccountLines()), hashPassword(password));
  if (!process.env.ADMIN_PASSWORD) console.log(`Local account: ${adminName}\nTemporary password: ${password}\nSet ADMIN_PASSWORD for deployment.`);
}
const listeners = new Map();
// Upgrade existing developers too, including accounts created before multi-line access.
syncDeveloperLines(db, configuredAccountLines());
let broker = null;
let mqttConnected = false;
let lastTelemetry = 0;
const telemetryFresh = () => mode === 'demo' || mqttConnected && Date.now() - lastTelemetry < 8000;
function persist() { if (mode !== 'attendance') db.prepare('INSERT INTO state(line,value) VALUES(?,?) ON CONFLICT(line) DO UPDATE SET value=excluded.value').run('ABB2', JSON.stringify(state)); }
function snapshot() {
  return { ...state, mode, connected: telemetryFresh(), serverTime: Date.now(),
    oeeUrl: process.env.OEE_DASHBOARD_URL || '', models, people,
    reports: mode === 'attendance' ? [] : db.prepare('SELECT id, shift_id AS shiftId, created_at AS createdAt FROM reports WHERE line = ? ORDER BY created_at DESC LIMIT 100').all('ABB2'),
    commands: mode === 'attendance' ? [] : db.prepare("SELECT id, kind, status, created_at AS createdAt FROM commands ORDER BY created_at DESC LIMIT 8").all() };
}
function broadcast() {
  const data = `event: state\ndata: ${JSON.stringify(snapshot())}\n\n`;
  for (const [res, session] of listeners) {
    const user = db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>?').get(session.token, Date.now());
    if (!user?.active || !JSON.parse(user.lines).includes('ABB2')) { res.end(); listeners.delete(res); } else res.write(data);
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
  if (!session?.active) return res.status(401).json({ error: 'Please sign in.' });
  req.user = publicUser(session); next();
}
function lineAccess(req, res, next) { if (!req.user.lines.includes('ABB2')) return res.status(403).json({ error: 'Your account has no ABB2 access.' }); next(); }
function startSession(res, user) {
  const token = randomBytes(32).toString('hex'); const ttl = user.role === 'display' ? 30 * 86400000 : 8 * 3600000;
  db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now());
  db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(digest(token), user.id, Date.now() + ttl);
  res.setHeader('Set-Cookie', `pd_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${ttl / 1000}${process.env.COOKIE_SECURE === 'true' ? '; Secure' : ''}`);
  res.json({ user: publicUser(user) });
}
app.get('/api/health', (_req, res) => res.json({ ok: true, mode, mqtt: mqttConnected, telemetryFresh: telemetryFresh() }));
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
app.get('/api/state', authenticate, lineAccess, (_req, res) => res.json(snapshot()));
const attendanceBridge = createAttendanceBridge(attendanceConfig());
app.get('/api/attendance', authenticate, attendanceBridge);
app.get('/api/attendance/photos/:employeeId', authenticate, attendanceBridge);
app.get('/api/events', authenticate, lineAccess, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream'); res.setHeader('Connection', 'keep-alive'); res.setHeader('X-Accel-Buffering', 'no'); res.flushHeaders();
  res.write(`event: state\ndata: ${JSON.stringify(snapshot())}\n\n`); listeners.set(res, { userId: req.user.id, token: digest(cookieToken(req)) });
  req.on('close', () => listeners.delete(res));
});
app.post('/api/actions/:kind', authenticate, lineAccess, (req, res) => {
  if (mode === 'attendance') return res.status(503).json({ error: 'Production controls are not connected. Attendance and account management are available.' });
  const kind = req.params.kind;
  if (kind === 'report' || kind === 'verify') { if (!canManage(req.user)) return res.status(403).json({ error: 'Management access is required.' }); }
  else if (!canWrite(req.user)) return res.status(403).json({ error: 'This account is read-only.' });
  try {
    if (!telemetryFresh() && !['henkaten', 'report', 'verify'].includes(kind)) return res.status(503).json({ error: 'The ABB2 service is disconnected. No command was sent.' });
    if (!['shift', 'henkaten'].includes(kind) && (!state.shift || state.shift.status !== 'active') && !['report', 'verify'].includes(kind)) throw new Error('Start an active shift first.');
    if (['condition', 'reject', 'adjust'].includes(kind) && !state.setup) throw new Error('Confirm model and lot setup first.');
    const payload = validate(kind, req.body);
    if (mode === 'demo' || ['henkaten', 'report', 'verify'].includes(kind)) return res.json(demoAction(kind, payload, req.user.name));
    if (kind === 'end') return res.status(400).json({ error: 'Python owns production shift endings. End-shift commands are not sent from React.' });
    if (['reject', 'condition', 'adjust'].includes(kind) && !process.env.INGEST_TOKEN) return res.status(503).json({ error: 'The durable-event receiver must be configured before enabling this production action.' });
    const id = randomUUID(); publishCommand(id, kind, payload, req.user.name); res.status(202).json({ pending: true, commandId: id, message: 'Sent to ABB2. Waiting for Python confirmation.' });
  } catch (error) { res.status(400).json({ error: error.message }); }
});
app.get('/api/reports/:id/pdf', authenticate, lineAccess, (req, res) => { if (mode === 'attendance') return res.status(404).json({ error: 'Production reports are not available in attendance mode.' }); const r = db.prepare('SELECT * FROM reports WHERE id=? AND line=?').get(req.params.id, 'ABB2'); if (!r) return res.status(404).json({ error: 'Report not found.' }); renderReport(JSON.parse(r.snapshot), res, r.id); });
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

const liveOperators = value => Array.isArray(value) ? value : typeof value === 'string' && value !== '-' ? value.split(',').map(v => v.trim()).filter(Boolean) : [];
const liveDateTime = value => value && !/(Z|[+-]\d\d:\d\d)$/.test(value) ? `${value}+08:00` : value;
function mapShift(p) { return { id: p.shift_id || `${p.prodDate?.replaceAll('-', '')}-${p.shift}-${(p.productionLine || 'ABB2').replaceAll(' ', '')}`, date: p.prodDate, shift: p.shift, overtime: p.overtime, workingTime: p.workingTime, supervisor: p.supervisor, leader: p.lineLeader, forming: liveOperators(p.formingOperator), waterjet: liveOperators(p.waterjetOperator), assembly: liveOperators(p.assemblyOperator), quality: p.qualityOperator }; }
function applyTimer(p) {
  const t = p.state; if (!t) return;
  state.timer = { id: t.id, status: t.status, revision: t.revision, startedAt: t.started_ms, stoppedAt: t.stopped_ms, elapsedSeconds: (t.elapsed_ms || 0) / 1000, targetMinutes: Number(t.data?.presetTime || 0), category: t.data?.downtimeCategory || 'Machine', reason: t.data?.cleanReasonName || t.data?.machineIssue || '', action: t.data?.actionTaken || '', remarks: t.data?.remarks || '' };
}
function commandStatus(id, status) { if (id) db.prepare('UPDATE commands SET status=? WHERE id=?').run(status, id); }
function publishCommand(id, kind, p, actor) {
  let topic; let payload;
  if (kind === 'shift') { topic = 'nodered/newshift'; const hours = p.shift === 'Day' ? p.overtime ? '8:00 AM to 8:00 PM' : '8:00 AM to 4:15 PM' : p.overtime ? '8:00 PM to 8:00 AM' : '4:15 PM to 12:30 AM'; payload = { productionLine: 'Line 1', shift: p.shift, prodDate: p.date, overtime: p.overtime, supervisor: p.supervisor, lineLeader: p.leader, formingOperator: p.forming, waterjetOperator: p.waterjet, assemblyOperator: p.assembly, qualityOperator: p.quality, workingTime: hours, event_id: id, testMode: false }; }
  if (kind === 'setup') { topic = 'nodered/modeltarget'; const m = models.find(m => m.name === p.model); payload = { model: p.model, lot_number: p.lot, standard_cycle: p.cycle, hourly_plan: p.plan, pcs_hr: m.pcsHr, std_slab_width: m.slabWidth, std_slab_length: m.slabLength, model_changed: state.setup?.model !== p.model, change_type: state.setup?.model !== p.model ? 'model_change' : 'lot_update', event_id: id }; }
  if (kind === 'mode') { topic = 'nodered/mode'; payload = p.mode; }
  if (kind === 'adjust') { topic = 'nodered/adjust_count'; payload = { adjust: p.adjust, reason: p.reason, operator: actor, event_id: id }; }
  if (kind === 'reject') { topic = 'nodered/reject'; payload = { totalSlabReject: p.slab, slabRejectCode: p.slabCode, totalReturnRoll: p.returnRoll, ohtNumber: p.oht, totalRejectNG: p.ng, ngRejectCode: p.ngCode, totalLoftLayerReject: p.loft, loftLayerRejectCode: p.loftCode, remarks: p.remarks, event_id: id }; }
  if (kind === 'condition') { topic = 'noderedparam/condition'; payload = { paramData: [{ model: state.setup.model, heating: p.heating, cooling: p.cooling, shuttle: p.shuttle, waterjet: p.waterjet }], tempData: [{ rh: p.rh, ctr: p.ctr, lh: p.lh }], glueData: [{ std: p.glueStd, act: p.glueActual }], event_id: id }; }
  if (kind === 'timer') { topic = 'nodered/downtime_session'; payload = { action: p.action, command_id: id, session_id: state.timer.id, revision: p.revision, data: { downtimeCategory: p.category, cleanReasonName: p.reason, machineIssue: p.reason, presetTime: p.targetMinutes, durationMinutes: p.duration, actionTaken: p.actionTaken, remarks: p.remarks } }; }
  if (!topic || !broker?.connected) throw new Error('The MQTT bridge is disconnected.');
  const baseline = { ...p, actor, expectedCount: kind === 'adjust' ? Math.max(0, state.live.shiftActual + p.adjust) : undefined };
  db.prepare('INSERT INTO commands VALUES(?,?,?,?,?)').run(id, kind, 'pending', new Date().toISOString(), JSON.stringify(baseline));
  // Never retain commands or automatically replay them. Existing Python rejects/counts are not idempotent.
  broker.publish(topic, typeof payload === 'string' ? payload : JSON.stringify(payload), { qos: 0, retain: false }, error => { if (error) { commandStatus(id, 'failed'); commit('MQTT command failed', actor); } });
  broadcast();
}
if (mode === 'live') {
  broker = mqtt.connect(process.env.MQTT_URL, { username: process.env.MQTT_USERNAME || undefined, password: process.env.MQTT_PASSWORD || undefined, reconnectPeriod: 3000, queueQoSZero: false, clean: true });
  broker.on('connect', () => { mqttConnected = true; broker.subscribe(['smartchecksheet/live', 'smartchecksheet/hourly', 'abb2/shift_form_result', 'abb2/downtime_result', 'abb2/status']); broadcast(); });
  broker.on('offline', () => { mqttConnected = false; broadcast(); });
  broker.on('error', error => console.error('MQTT:', error.message));
  broker.on('message', (topic, buffer) => {
    try {
      const p = JSON.parse(buffer.toString());
      if (topic === 'smartchecksheet/live') {
        lastTelemetry = Date.now();
        if (p.shift_id && p.shift_id !== 'NO PROD') {
          if (state.shift?.id !== p.shift_id) {
            if (state.shift) createReport('Python recovery');
            activateShift({ id: p.shift_id, date: p.date, shift: p.shift, overtime: p.overtime, supervisor: p.supervisor, leader: p.leader, forming: liveOperators(p.forming_operator), waterjet: liveOperators(p.waterjet_operator), assembly: liveOperators(p.assembly_operator), quality: p.quality_inspector, workingTime: p.working_time }, 'Python');
          }
          state.shift.endAt = liveDateTime(p.scheduled_end_at); state.shift.startAt = liveDateTime(p.scheduled_start_at);
          state.setup = p.model && !['-', 'PENDING', 'UNKNOWN'].includes(p.model) ? { model: p.model, lot: p.lot_number, plan: p.hourly_plan, cycle: p.standard_cycle_time } : null;
        } else if (state.shift) state.shift.status = 'ended';
        state.live = { actual: p.hourly_output || 0, modelActual: p.product_count || 0, shiftActual: p.total_product_count || 0, plan: p.live_plan || 0, cycle: p.current_cycle_time || 0, mode: p.current_mode, status: ['Running', 'Loading', 'Delay', 'Rest', 'Downtime', 'Planned stop', 'Model change'][p.machine_status] || 'Waiting', slot: p.hour_slot, timestamp: new Date().toISOString() };
        if (p.downtime_session) applyTimer({ state: p.downtime_session });
        state.pendingShift = p.pending_shift ? mapShift(p.pending_shift) : null;
        for (const c of db.prepare("SELECT * FROM commands WHERE status='pending'").all()) {
          const data = JSON.parse(c.payload);
          if (c.kind === 'mode' && p.current_mode === data.mode || c.kind === 'setup' && p.model === data.model && p.lot_number === data.lot) commandStatus(c.id, 'confirmed');
        }
      }
      if (topic === 'smartchecksheet/hourly') {
        const id = digest(JSON.stringify(p));
        if (!state.hourly.some(r => r.id === id) && p.shift_id === state.shift?.id) state.hourly.push({ id, shiftId: p.shift_id, slot: p.hour_slot, model: p.model, lot: p.lot_number, plan: p.plan, actual: p.actual, restMinutes: p.rest_time });
      }
      if (topic === 'abb2/shift_form_result') {
        commandStatus(p.source_payload?.event_id, p.status === 'active' ? 'confirmed' : p.status === 'pending' ? 'scheduled' : p.status === 'ended' ? 'confirmed' : 'rejected');
        if (p.status === 'active' && p.source_payload) { const next = mapShift(p.source_payload); next.id = p.active_shift?.shift_id || next.id; if (state.shift?.id !== next.id || state.shift.status === 'ended') activateShift(next, 'Python'); }
        if (p.status === 'ended' && state.shift) { state.shift.status = 'ended'; createReport('Python'); }
      }
      if (topic === 'abb2/downtime_result') {
        applyTimer(p); commandStatus(p.command_id, p.error ? 'rejected' : 'confirmed');
        if (p.log) { const id = digest(`${p.state?.id}:${p.state?.revision}:log`); if (!state.downtime.some(r => r.id === id)) { state.downtime.push({ id, shiftId: state.shift?.id, slot: p.log.hourSlot || slotNow(), category: p.log.category, reason: p.log.description, duration: p.log.durationMinutes, action: p.log.actionTaken, createdAt: new Date().toISOString(), actor: 'Python' }); if (['Machine', 'Production', 'Quality'].includes(p.log.category)) issue(p.log.category === 'Machine' ? 'machine' : 'method', p.log.description, 'Python', p.log.actionTaken); } }
      }
      // nodered/endshift is deliberately never published: Python also subscribes to it.
      // The original Node-RED OEE tab, telemetry and InfluxDB paths remain untouched.
      commit();
    } catch (e) { console.error('Ignored invalid MQTT message:', topic, e.message); }
  });
}
app.post('/api/integrations/events', (req, res) => {
  if (mode !== 'live' || !process.env.INGEST_TOKEN || req.headers.authorization !== `Bearer ${process.env.INGEST_TOKEN}`) return res.status(401).json({ error: 'Unauthorized.' });
  const e = req.body;
  if (!e.event_id || e.line_code !== 'ABB2' || !e.payload || typeof e.event_type !== 'string') return res.status(400).json({ error: 'ABB2 event_id, event_type and payload are required.' });
  if (db.prepare('SELECT id FROM events WHERE id=?').get(e.event_id)) return res.json({ ok: true, duplicate: true });
  // Durable receiver accepts the existing event envelope. Forward to this endpoint from
  // the central ingest service so the Pi's existing analytics destination stays intact.
  db.exec('BEGIN');
  const before = structuredClone(state);
  try {
    const p = e.payload; const c = db.prepare('SELECT * FROM commands WHERE id=?').get(e.event_id); const sent = c ? JSON.parse(c.payload) : {};
    const record = { id: e.event_id, shiftId: e.shift_id || p.shift_id, slot: p.hour_slot || slotNow(), actor: sent.actor || 'Python', createdAt: e.occurred_at || new Date().toISOString() };
    if (record.shiftId === state.shift?.id) {
      if (e.event_type === 'reject.recorded') { const row = { ...record, slab: Number(p.slab_quantity || 0), returnRoll: Number(p.return_roll_quantity || 0), ng: Number(p.ng_quantity || 0), loft: Number(p.loft_quantity || 0), code: p.ng_code || p.slab_code || p.loft_code, remarks: sent.remarks || '' }; state.rejects.push(row); issue(row.slab || row.returnRoll ? 'material' : 'method', `Reject recorded: ${row.code}`, record.actor); }
      if (e.event_type === 'parameter.recorded') { state.parameters.push({ ...record, ...p, glueStd: p.glue_standard, glueActual: p.glue_actual }); resolveCategory('method', 'Parameters confirmed by Python', record.actor); }
      if (e.event_type === 'model.configured' && p.source_payload?.model_changed) issue('method', `Model changed to ${p.model}. Confirm parameters.`, record.actor);
    }
    commandStatus(e.event_id, 'confirmed'); state.revision++; state.updatedAt = new Date().toISOString(); persist();
    db.prepare('INSERT INTO events VALUES(?,?)').run(e.event_id, new Date().toISOString()); db.exec('COMMIT'); broadcast(); res.json({ ok: true });
  } catch (error) { db.exec('ROLLBACK'); state = before; res.status(400).json({ error: error.message }); }
});

let ticks = 0;
const interval = setInterval(() => {
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
function shutdown() { clearInterval(interval); for (const res of listeners.keys()) res.end(); broker?.end(); server.close(() => { db.close(); process.exit(0); }); }
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
