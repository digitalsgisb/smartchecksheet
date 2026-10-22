import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { Activity, ArrowDownToLine, ArrowRight, ArrowUpRight, Bell, Check, CheckCheck, ChevronDown, ChevronRight, CircleHelp, ClipboardCheck, Clock3, Code2, Download, Expand, Eye, EyeOff, Factory, FileText, LayoutDashboard, LogOut, Home, Menu, Monitor, MoreHorizontal, Play, Plus, Radio, Settings2, ShieldCheck, Smartphone, Square, Users, Wifi, WifiOff, Wrench, X, Zap, Package, GitBranch, Search, AlertTriangle, Minus, RefreshCw, Layers3 } from 'lucide-react';
import { api, setApiLine, lineUrl } from './api.js';
import ManualShiftFields from './ManualShiftFields.jsx';
import './workspace.css';
import { machineStatus } from './machineStatus.js';
import { RejectFields, DowntimeFields, DowntimeSaveButton, FourMFields } from './OperatorForms.jsx';
import HenkatenBoard from './HenkatenBoard.jsx';
import InlineSetup from './InlineSetup.jsx';
import ShiftEndNotice from './ShiftEndNotice.jsx';
import Attendance from './Attendance.jsx';
import './login.css';
import { applyAppUpdate } from './appUpdate.js';
import { revalidateSession } from './session.js';

const navigation = [
  { id: 'attendance', label: 'Attendance', icon: Users },
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'checksheet', label: 'Smart Checksheet', icon: ClipboardCheck },
  { id: 'live', label: 'Live Checksheet', icon: Radio },
  { id: 'henkaten', label: '4M Board', icon: GitBranch },
  { id: 'reports', label: 'PDF Reports', icon: FileText }
];
const categories = { man: { name: 'Man', icon: Users, subtitle: 'People & manpower' }, machine: { name: 'Machine', icon: Wrench, subtitle: 'Equipment & reliability' }, material: { name: 'Material', icon: Package, subtitle: 'Parts & incoming quality' }, method: { name: 'Method', icon: GitBranch, subtitle: 'Process & parameters' } };
const time = value => new Date(value).toLocaleTimeString('en-GB', { timeZone: 'Asia/Kuala_Lumpur', hour: '2-digit', minute: '2-digit' });
const dateLabel = value => new Date(`${value}T00:00:00+08:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const initials = name => name.split(' ').map(s => s[0]).slice(0, 2).join('');
const writingRoles = ['operator', 'management', 'developer'];
const managementRoles = ['management', 'developer'];
function Brand({ small = false }) { return <div className={`brand ${small ? 'small' : ''}`}><img src="/favicon.svg" alt=""/><div><strong>Production Digital<span className="brand-dot">.</span></strong><span>PRODUCTION WORKSPACE</span></div></div>; }
function Badge({ children, type = 'neutral', dot = false }) { return <span className={`badge ${type}`}>{dot && <i/>}{children}</span>; }
function Empty({ icon: Icon = ClipboardCheck, title, text, children }) { return <div className="empty"><Icon size={34}/><h3>{title}</h3><p>{text}</p>{children}</div>; }
function Field({ label, children, className = '' }) { return <label className={`field ${className}`}><span>{label}</span>{children}</label>; }
function Select({ items, value, onChange, required = true, multiple = false, disabled = false }) { return <select required={required} multiple={multiple} disabled={disabled} value={value} onChange={e => onChange(multiple ? [...e.target.selectedOptions].map(o => o.value) : e.target.value)}>{!multiple && <option value="">Select…</option>}{items.map(i => <option key={i.value || i} value={i.value || i}>{i.label || i}</option>)}</select>; }
function Stat({ icon: Icon, label, value, unit, note, accent = '' }) { return <article className={`stat-card ${accent}`}><div className="stat-head"><span>{label}</span><span className="stat-icon"><Icon size={18}/></span></div><div className="stat-value">{value}<small>{unit}</small></div><div className="stat-note">{note}</div></article>; }
function SectionHead({ eyebrow, title, text, children }) { return <div className="section-head"><div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h2>{title}</h2>{text && <p>{text}</p>}</div>{children}</div>; }

function Login({ onLogin, demo, error: initialError }) {
  const [error, setError] = useState(initialError || ''); const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  async function submit(e, isDemo = false) { e?.preventDefault(); setBusy(true); setError(''); try { const f = e ? Object.fromEntries(new FormData(e.target)) : {}; const result = await api(isDemo ? '/auth/demo' : '/auth/login', f); onLogin(result.user); } catch (e) { setError(e.message); } finally { setBusy(false); } }
  return <div className="login"><aside><Brand/><div className="login-message"><Badge type="lime" dot>One shared workspace</Badge><h1>Production<br/><em>Digital</em></h1><p>Checksheet, production records and 4M board.</p><div className="login-features"><span><ClipboardCheck/>Enter checksheet records</span><span><Radio/>View live production</span><span><ShieldCheck/>Access by role and line</span></div></div><span className="login-footer">DIGITAL TRANSFORMATION UNIT</span></aside><main><div className="login-form"><div className="eyebrow">PRODUCTION DIGITAL</div><h2>Sign in</h2><p>Enter your username and password.</p><form onSubmit={submit}><Field label="Username"><input name="username" autoComplete="username" required placeholder="Your username"/></Field><div className="field login-password-field"><label htmlFor="login-password">Password</label><div className="login-password-input"><input id="login-password" name="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" required placeholder="Your password"/><button type="button" className="login-password-toggle" aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} aria-controls="login-password" title={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword(value => !value)}>{showPassword ? <><EyeOff size={20} aria-hidden="true"/><span>Hide</span></> : <><Eye size={20} aria-hidden="true"/><span>Show</span></>}</button></div></div>{error && <div className="form-error" role="alert">{error}</div>}<button className="btn primary full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}<ArrowRight size={18}/></button></form>{demo && <div className="demo-entry"><div><span/>LOCAL DEMO WORKSPACE<span/></div><button className="btn secondary full" disabled={busy} onClick={() => submit(null, true)}>Open demo<ArrowUpRight size={18}/></button><p>Sample ABB2 data. Production equipment is not connected.</p></div>}<div className="login-support"><ShieldCheck size={16}/>Access is managed by your administrator.</div></div></main></div>;
}

function Dashboard({ state, user, go, open, writable }) {
  const totalPlan = state.hourly.reduce((a, r) => a + r.plan, 0) + (state.shift?.status === 'active' ? state.live.plan : 0);
  const totalActual = state.hourly.reduce((a, r) => a + r.actual, 0) + (state.shift?.status === 'active' ? state.live.actual : 0);
  const attainment = totalPlan ? Math.round(totalActual / totalPlan * 100) : 0;
  const reject = state.rejects.reduce((a, r) => a + r.ng + r.loft, 0);
  const pending = state.issues.filter(i => i.status === 'pending').length;
  return <>
    <div className="page-intro"><div><span className="eyebrow">{state.line}</span><h1>Production overview<span>.</span></h1><p>Output, rejects and shift details.</p></div><div className="date-chip"><Clock3 size={16}/>{dateLabel(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(new Date()))}</div></div>
    <section className="hero"><div className="hero-content"><span className="hero-eyebrow"><span/>{state.line} · PRODUCTION WORKSPACE</span><h2>Production<br/><em>overview</em></h2><p>View the shift or enter a record.</p><button className="btn lime" onClick={() => go(writable ? 'checksheet' : 'live')}>{writable ? 'Open Smart Checksheet' : 'View live checksheet'}<ArrowRight size={19}/></button></div><div className="hero-visual"><div className="orbit orbit-one"/><div className="orbit orbit-two"/><div className="orbit orbit-three"/><div className="factory-medallion"><Factory size={80} strokeWidth={1.35}/><span className="medallion-check"><Check size={23}/></span></div><div className="hero-float"><span className="live-dot"/><div><strong>{state.shift?.status === 'active' ? 'Line in operation' : 'Ready for the next shift'}</strong><span>{state.line} · {state.live.status}</span></div><Activity size={25}/></div><span className="hero-caption">CHECK · CONNECT · IMPROVE</span></div></section>
    <div className="stat-grid"><Stat icon={Package} label="Production output" value={totalActual.toLocaleString()} unit="pcs" note={`${totalPlan.toLocaleString()} pcs planned · current record`}/><Stat icon={Activity} label="Target reached" value={attainment} unit="%" accent="green" note="Actual output against available-time plan"/><Stat icon={AlertTriangle} label="Open 4M problems" value={pending.toString().padStart(2, '0')} unit="issues" accent="amber" note={pending ? 'Needs your team’s attention' : 'All reported changes resolved'}/><Stat icon={ShieldCheck} label="After-forming rejects" value={reject} unit="pcs" note="NG + loft layer · metres tracked separately"/></div>
    <div className="dashboard-columns"><section className="panel production-panel"><SectionHead eyebrow="SHIFT PERFORMANCE" title="Hourly output" text="Plan and actual output from the checksheet."><div className="chart-legend"><span><i/>Plan</span><span><i/>Actual</span></div></SectionHead><ProductionChart rows={state.hourly} live={state.shift?.status === 'active' ? state.live : null}/><div className="panel-footer"><span><Radio size={15}/>Shared with every connected device</span><button className="text-btn" onClick={() => go('live')}>View full record<ArrowUpRight size={16}/></button></div></section><section className="panel shift-panel"><div className="panel-title"><span className="eyebrow">ON THE FLOOR</span><Badge type={state.shift?.status === 'active' ? 'success' : 'neutral'} dot>{state.shift?.status === 'active' ? 'Active shift' : 'No active shift'}</Badge></div><h2>{state.line} <span>/</span> {state.shift?.shift || 'Waiting'}</h2><p className="shift-working"><Clock3 size={16}/>{state.shift?.workingTime || 'Start a shift to begin'}</p><div className="model-block"><span>CURRENT MODEL</span><strong>{state.setup?.model || 'Awaiting setup'}</strong><span>LOT <b>{state.setup?.lot || '—'}</b></span></div><Person name={state.shift?.supervisor || 'Not assigned'} title="Supervisor"/><Person name={state.shift?.leader || 'Not assigned'} title="Line leader"/><button className="btn secondary full" onClick={() => go('checksheet')}>Shift workspace<ArrowRight size={16}/></button></section></div>
    <SectionHead eyebrow="YOUR WORKSPACE" title="Pages" text="Select a page."/>
    <div className="workspace-grid">{navigation.slice(1).map(({ id, label, icon: Icon }, index) => <button className="workspace-card" key={id} onClick={() => go(id)}><span className={`workspace-icon tone-${index}`}><Icon size={25}/></span><ArrowUpRight className="workspace-arrow" size={19}/><h3>{label}</h3><p>{{ overview: 'View output, shifts and open issues.', checksheet: 'Manage setup, checks and production entries.', live: 'View this line’s saved production record.', henkaten: 'Track changes across the four Ms.', reports: 'Generate, preview and download shift records.' }[id]}</p><span className="workspace-link">Open<ArrowRight size={15}/></span></button>)}</div>
    <section className="oee-note"><Activity size={23}/><div><strong>OEE dashboard</strong><p>Open the existing OEE dashboard.</p></div>{state.oeeUrl ? <a className="btn secondary" href={state.oeeUrl} target="_blank" rel="noreferrer">Open OEE<ArrowUpRight size={16}/></a> : <Badge>OEE link not configured</Badge>}</section>
  </>;
}
function Person({ name, title }) { return <div className="person"><span className="avatar">{initials(name)}</span><div><strong>{name}</strong><span>{title}</span></div></div>; }
function ProductionChart({ rows, live }) {
  const chartRows = [...rows.slice(-7), ...(live ? [{ slot: live.slot, plan: live.plan, actual: live.actual, isLive: true }] : [])];
  const max = Math.max(100, ...chartRows.map(r => Math.max(r.plan, r.actual)));
  if (!chartRows.length) return <Empty title="Production will appear here" text="Hourly records are finalized by the line service."/>;
  return <div className="chart"><div className="chart-scale">{[max, Math.round(max * .75), Math.round(max * .5), Math.round(max * .25), 0].map((n, i) => <span key={i}>{n}</span>)}</div><div className="chart-plot"><div className="chart-grid">{[0, 1, 2, 3, 4].map(i => <i key={i}/>)}</div><div className="chart-bars">{chartRows.map((r, i) => <div className="chart-column" key={r.id || `live-${i}`}><div className="bar-pair"><div className="bar plan" style={{ height: `${r.plan / max * 100}%` }} title={`Plan: ${r.plan}`}/><div className="bar actual" style={{ height: `${r.actual / max * 100}%` }} title={`Actual: ${r.actual}`}><span>{r.actual}</span></div></div><span className="chart-label">{r.slot?.split('-')[0]}{r.isLive && <i/>}</span></div>)}</div></div></div>;
}

function ChecksheetTimer({ timer, serverTime, connected, open }) {
  const serverOffset = useMemo(() => serverTime - Date.now(), [serverTime]);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (timer.status !== 'running') return;
    const interval = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(interval);
  }, [timer.status]);
  const elapsed = timer.status === 'running'
    ? Math.max(0, (now + serverOffset - timer.startedAt) / 1000)
    : timer.elapsedSeconds;
  const seconds = Math.floor(timer.targetMinutes > 0 ? Math.max(0, timer.targetMinutes * 60 - elapsed) : elapsed);
  const label = !connected ? 'LAST KNOWN TIMER' : timer.status === 'running' ? 'TIMER RUNNING' : 'TIMER STOPPED';
  return <button type="button" className={'checksheet-timer timer-' + timer.status} onClick={() => open('timer')} aria-label={'Open downtime. ' + label.toLowerCase()}>
    <span className="checksheet-timer-label"><Clock3 size={19}/>{label}</span>
    <span className="checksheet-timer-digits" role="timer" aria-live="off">{String(Math.floor(seconds / 60)).padStart(2, '0')}:{String(seconds % 60).padStart(2, '0')}</span>
    <span className="checksheet-timer-link">OPEN DOWNTIME<ChevronRight size={18}/></span>
  </button>;
}
function Checksheet({ state, user, open, action, writable, go, connected }) {
  const [adjustReason, setAdjustReason] = useState('');
  const [extra, setExtra] = useState(null);
  useEffect(() => {
    const escape = event => { if (event.key === 'Escape') setExtra(null); };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, []);
  const active = state.shift?.status === 'active';
  const machine = state.mode === 'manual' ? { key: state.timer.status === 'running' ? 'down' : 'waiting', label: state.timer.status === 'running' ? 'Recorded downtime' : 'Manual recording' } : machineStatus(state.live, connected, state.timer);
  const rejectPieces = state.rejects.reduce((sum, record) => sum + Number(record.ng || 0) + Number(record.loft || 0), 0);
  const tasks = [
    { kind: 'condition', label: 'Check parameters', help: 'Temperature, time and glue', icon: Settings2 },
    { kind: 'reject', label: 'Enter reject', help: 'Reject length or quantity', icon: AlertTriangle },
    { kind: 'timer', label: 'Record downtime', help: 'Start / stop timer or enter minutes', icon: Clock3 },
    { kind: 'henkaten', label: 'Report 4M change', help: 'Man, Machine, Material or Method', icon: GitBranch }
  ];
  return <div className="operator-checksheet reference-checksheet">
    <section className={`machine-status-banner machine-${machine.key} ${state.timer.status !== 'idle' ? 'has-timer' : ''}`} role={state.timer.status === 'idle' ? 'status' : undefined}><strong>{state.mode === 'manual' ? machine.label.toUpperCase() : machine.key === 'change' ? 'MODEL CHANGE' : `MACHINE ${machine.label.toUpperCase()}`}</strong>{state.timer.status !== 'idle' && <ChecksheetTimer timer={state.timer} serverTime={state.serverTime} connected={connected} open={open}/>}</section>
    <div className="reference-title"><h1>{state.line} Checksheet</h1><span>{state.shift ? dateLabel(state.shift.date) : state.line}</span></div>
    {!writable && <div className="notice"><ShieldCheck size={20}/>{['executive', 'display'].includes(user.role) ? 'View only. Ask an operator or leader to enter records.' : 'Not connected. Wait for the connection before entering records.'}</div>}
    <section className="reference-shift"><div><strong>{active ? `${state.shift.shift} shift · ${state.shift.overtime ? 'OT' : 'No OT'}` : 'No active shift'}</strong><span>{state.shift?.workingTime || 'Start a shift to begin'}{state.pendingShift ? ` · Next: ${state.pendingShift.shift}` : ''}</span></div><button className="btn secondary" onClick={() => active ? setExtra('shift') : open('shift')} disabled={!active && !writable}>{active ? 'Shift details' : 'Start shift'}</button>{active && <button className="btn secondary" disabled={!writable} onClick={() => open('shift')}>Next shift</button>}</section>
    <div className="reference-people"><Detail label="Supervisor" value={state.shift?.supervisor}/><Detail label="Line leader" value={state.shift?.leader}/></div>
    <InlineSetup state={state} action={action} writable={writable} active={active}/>
    <div className="reference-cycles"><Detail label="Standard cycle (min / piece)" value={state.setup?.cycle ?? '—'}/><div className={state.setup && Number(state.live.cycle) > Number(state.setup.cycle) ? 'cycle-slow' : ''}><Detail label="Current cycle (min / piece)" value={Number(state.live.cycle || 0).toFixed(2)}/></div></div>
    <div className="reference-counts"><div><span>Shift output</span><strong>{state.live.shiftActual}<small> pcs</small></strong></div><div className="reject-count"><span>Rejects (NG + loft)</span><strong>{rejectPieces}<small> pcs</small></strong></div><div><span>This hour</span><strong>{state.live.actual}<small> pcs</small></strong></div></div>
    <section className="reference-mode"><span>Machine mode</span><div><button className={`btn ${state.live.mode === 'NORMAL' ? 'mode-selected' : 'secondary'}`} aria-pressed={state.live.mode === 'NORMAL'} disabled={!writable || !active || state.timer.status === 'running' || state.live.mode === 'NORMAL'} onClick={() => action('mode', { mode: 'NORMAL' })}><Play size={18}/>Normal</button><button className={`btn ${state.live.mode === 'REST' ? 'mode-selected rest-selected' : 'secondary'}`} aria-pressed={state.live.mode === 'REST'} disabled={!writable || !active || state.timer.status === 'running' || state.live.mode === 'REST'} onClick={() => action('mode', { mode: 'REST' })}><Clock3 size={18}/>Rest</button></div></section>
    {!active ? <p className="operator-help">Start a shift to enter records.</p> : !state.setup && <p className="operator-help">Set a model and lot before entering records.</p>}
    <div className="operator-task-grid">{tasks.map(({ kind, label, help, icon: Icon }) => <button key={kind} className={`operator-task task-${kind}`} disabled={!writable || !active || ['condition', 'reject'].includes(kind) && !state.setup} onClick={() => kind === 'henkaten' ? go('henkaten') : open(kind)}><Icon size={28}/><span><strong>{label}</strong><small>{help}</small></span><ChevronRight size={22}/></button>)}</div>
    <div className="operator-view-buttons"><button className="btn secondary" onClick={() => go('live')}><FileText size={20}/>View checksheet</button><button className="btn secondary" onClick={() => go('henkaten')}><GitBranch size={20}/>View 4M board</button><button className="btn secondary" disabled={!writable || !active || !state.setup} onClick={() => setExtra('count')}><Plus size={20}/>Correct count</button></div>
    {extra && <div className="modal-overlay" onMouseDown={event => { if (event.target === event.currentTarget) setExtra(null); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="operator-extra-title"><header><h2 id="operator-extra-title">{extra === 'shift' ? 'Shift details' : 'Correct output count'}</h2><button className="icon-btn" aria-label="Close dialog" onClick={() => setExtra(null)}><X size={22}/></button></header><div className="modal-body">{extra === 'shift' ? <><div className="detail-grid"><Detail label="Production date" value={dateLabel(state.shift.date)}/><Detail label="Working hours" value={state.shift.workingTime}/><Detail label="Supervisor" value={state.shift.supervisor}/><Detail label="Line leader" value={state.shift.leader}/><Detail label="Forming operators" value={state.shift.forming?.join(', ')}/><Detail label="Waterjet operators" value={state.shift.waterjet?.join(', ')}/><Detail label="Assembly operators" value={state.shift.assembly?.join(', ')}/><Detail label="Quality inspector" value={state.shift.quality}/></div>{['demo', 'manual'].includes(state.mode) && active && writable && <div className="demo-end"><span>{state.mode === 'demo' ? 'Demo only' : 'Manual shift'}</span><button className="text-btn danger" onClick={() => { setExtra(null); open('end'); }}>End shift</button></div>}</> : <><p>Enter a reason. Then add or remove one piece.</p><div className="adjust-row"><input aria-label="Count adjustment reason" placeholder="Enter reason" value={adjustReason} onChange={e => setAdjustReason(e.target.value)}/><button className="btn secondary" disabled={!writable || !active || !state.setup || !adjustReason.trim()} onClick={() => action('adjust', { adjust: -1, reason: adjustReason })}><Minus size={20}/>Remove 1</button><button className="btn secondary" disabled={!writable || !active || !state.setup || !adjustReason.trim()} onClick={() => action('adjust', { adjust: 1, reason: adjustReason })}><Plus size={20}/>Add 1</button></div></>}</div><footer><button className="btn secondary" onClick={() => setExtra(null)}>Close</button></footer></section></div>}
  </div>;
}
function Detail({ label, value }) { return <div className="detail"><span>{label}</span><strong>{value || '—'}</strong></div>; }
function PageTitle({ eyebrow, title, text, children }) { return <div className="page-intro"><div><span className="eyebrow">{eyebrow}</span><h1>{title}<span>.</span></h1><p>{text}</p></div><div className="title-actions">{children}</div></div>; }

function LiveChecksheet({ state, open, tv, manage }) {
  const [tab, setTab] = useState('production');
  const tabs = ['production', 'rejects', 'downtime', 'parameters', 'verification'];
  const rows = [...state.hourly, ...(state.shift?.status === 'active' && state.setup ? [{ id: 'live', slot: state.live.slot, model: state.setup.model, lot: state.setup.lot, plan: state.live.plan, actual: state.live.actual, restMinutes: '—', live: true }] : [])];
  return <><PageTitle eyebrow={state.line} title="Live Checksheet" text={`${state.shift?.id || `${state.line} · Awaiting shift`} · Shared production record`}><Badge type={state.connected ? 'success' : 'amber'} dot>{state.connected ? 'Connected' : 'Stale data'}</Badge>{!tv && manage && <button className="btn secondary" disabled={!state.shift} onClick={() => open('verify')}><CheckCheck size={17}/>Verify record</button>}</PageTitle>
    <div className="live-summary"><div><span className="avatar large"><Factory size={26}/></span><div><span className="eyebrow">{state.line}</span><h3>{state.setup?.model || 'Awaiting model setup'}</h3></div></div><Detail label="Lot number" value={state.setup?.lot}/><Detail label="Shift" value={state.shift ? `${state.shift.shift} · ${state.shift.workingTime}` : '—'}/><Detail label="Supervisor / leader" value={state.shift ? `${state.shift.supervisor} / ${state.shift.leader}` : '—'}/></div>
    <div className="stat-grid"><Stat icon={Package} label="Shift output" value={state.live.shiftActual} unit="pcs" note={`${state.mode === 'manual' ? 'Manually recorded' : 'Machine count'} · all model segments`}/><Stat icon={AlertTriangle} label="NG + loft rejects" value={state.rejects.reduce((n, r) => n + r.ng + r.loft, 0)} unit="pcs" note="After-forming pieces"/><Stat icon={Clock3} label="Logged downtime" value={state.downtime.reduce((n, r) => n + Number(r.duration || 0), 0)} unit="min" note="All downtime categories"/><Stat icon={CheckCheck} label="Verification" value={state.verification.length ? state.verification.at(-1).status === 'verified' ? 'Verified' : 'Issue' : 'Pending'} note={state.verification.at(-1)?.actor || 'Management verification required'}/></div>
    <section className="panel record-panel"><div className="record-tabs" role="tablist">{tabs.map(t => <button role="tab" aria-selected={tab === t} key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>{t[0].toUpperCase() + t.slice(1)}<span>{t === 'production' ? rows.length : state[t]?.length || 0}</span></button>)}</div><div className="table-scroll">{tab === 'production' && <table><thead><tr><th>Hour / segment</th><th>Model</th><th>Lot number</th><th>Plan</th><th>Actual</th><th>Difference</th><th>Rest (min)</th><th>State</th></tr></thead><tbody>{rows.map(r => <tr key={r.id} className={r.live ? 'live-row' : ''}><td className="strong">{r.slot}</td><td>{r.model}</td><td className="mono">{r.lot}</td><td>{r.plan}</td><td className="strong">{r.actual}</td><td className={r.actual >= r.plan ? 'positive' : 'negative'}>{r.actual - r.plan > 0 ? '+' : ''}{r.actual - r.plan}</td><td>{r.restMinutes}</td><td><Badge type={r.live ? 'success' : 'neutral'} dot={r.live}>{r.live ? 'Live' : 'Finalized'}</Badge></td></tr>)}</tbody></table>}{tab === 'rejects' && <table><thead><tr><th>Hour</th><th>Slab (m)</th><th>Return roll (m)</th><th>NG (pcs)</th><th>Loft (pcs)</th><th>Code / remarks</th><th>Recorded by</th></tr></thead><tbody>{state.rejects.map(r => <tr key={r.id}><td>{r.slot}</td><td>{r.slab}</td><td>{r.returnRoll}</td><td>{r.ng}</td><td>{r.loft}</td><td>{r.code}<small className="cell-note">{r.remarks}</small></td><td>{r.actor}</td></tr>)}</tbody></table>}{tab === 'downtime' && <table><thead><tr><th>Hour</th><th>Category</th><th>Reason</th><th>Duration</th><th>Action taken</th><th>Recorded by</th></tr></thead><tbody>{state.downtime.map(r => <tr key={r.id}><td>{r.slot}</td><td><Badge>{r.category}</Badge></td><td>{r.reason}</td><td>{r.duration} min</td><td>{r.action}</td><td>{r.actor}</td></tr>)}</tbody></table>}{tab === 'parameters' && <table><thead><tr><th>Model</th><th>Heating / cooling</th><th>Shuttle / waterjet</th><th>RH / CTR / LH</th><th>Glue STD / ACT</th><th>Recorded by</th></tr></thead><tbody>{state.parameters.map(r => <tr key={r.id}><td>{r.model}</td><td>{r.heating} / {r.cooling} s</td><td>{r.shuttle} / {r.waterjet}</td><td>{r.rh} / {r.ctr} / {r.lh} °C</td><td>{r.glueStd} / {r.glueActual} g</td><td>{r.actor}</td></tr>)}</tbody></table>}{tab === 'verification' && <table><thead><tr><th>Verified by</th><th>Result</th><th>Remarks</th><th>Time</th></tr></thead><tbody>{state.verification.map(r => <tr key={r.id}><td>{r.actor}</td><td><Badge type={r.status === 'verified' ? 'success' : 'amber'}>{r.status}</Badge></td><td>{r.remarks || '—'}</td><td>{time(r.createdAt)}</td></tr>)}</tbody></table>}</div>{(tab === 'production' ? !rows.length : !state[tab]?.length) && <Empty title="No records yet" text="Saved entries will appear here automatically."/>}<div className="panel-footer"><span><Radio size={15}/>{state.mode === 'demo' ? 'Demo record' : state.mode === 'manual' ? 'Manual production record' : 'Python confirmed production data'} · Updated {time(state.updatedAt)}</span><span>Times shown in Malaysia time</span></div></section>
  </>;
}

function Henkaten(props) { return <HenkatenBoard {...props} categories={categories}/>; }

function Reports({ state, open, manage }) {
  const [search, setSearch] = useState(''); const [selected, setSelected] = useState(null);
  const reports = state.reports.filter(r => r.shiftId.toLowerCase().includes(search.toLowerCase()));
  return <><PageTitle eyebrow={state.line} title="PDF Reports" text="Create, view or download a shift report."><button className="btn primary" disabled={!manage || !state.shift} onClick={() => open('report')}><Plus size={17}/>Generate report</button></PageTitle><div className="notice"><FileText size={18}/>Reports show the data saved at the time of creation.</div><div className="reports-layout"><section className="panel report-list"><div className="search-input"><Search size={17}/><input aria-label="Search reports" placeholder="Search shift ID…" value={search} onChange={e => setSearch(e.target.value)}/></div>{reports.map(r => <button key={r.id} className={`report-item ${selected?.id === r.id ? 'active' : ''}`} onClick={() => setSelected(r)}><span className="pdf-icon"><FileText size={22}/><small>PDF</small></span><div><strong>{r.shiftId}</strong><span>{new Date(r.createdAt).toLocaleString('en-GB', { timeZone: 'Asia/Kuala_Lumpur' })}</span><span>Version {r.id.slice(0, 8)}</span></div><ChevronRight size={18}/></button>)}{!reports.length && <Empty icon={FileText} title="No reports" text="Generate a report from the current shift to get started."/>}</section><section className="panel pdf-preview">{selected ? <><div className="panel-title"><strong>{selected.shiftId}</strong><a className="btn secondary" href={lineUrl(`/reports/${selected.id}/pdf`, state.line)} target="_blank" rel="noreferrer"><Download size={17}/>Open / download</a></div><iframe title="Production record PDF preview" src={lineUrl(`/reports/${selected.id}/pdf`, state.line)}/><p className="hint">If your tablet does not support embedded PDFs, use Open / download.</p></> : <Empty icon={FileText} title="Select a report" text="Select a report to preview its production, reject, downtime, parameter and Henkaten records."/>}</section></div></>;
}

function UserManagement({ user, notify, open, refreshUsers, users }) {
  return <><PageTitle eyebrow="ACCOUNTS" title="User Management" text="Add accounts and select their line access."><button className="btn primary" onClick={() => open('user')}><Plus size={17}/>Add account</button></PageTitle><div className="role-grid">{[{ name: 'Operator', text: 'Production entry and Henkaten updates', icon: ClipboardCheck }, { name: 'Executive', text: 'Read-only production overview', icon: Activity }, { name: 'Management', text: 'Verification, reports and operator accounts', icon: ShieldCheck }, { name: 'Developer', text: 'All account roles and administration', icon: Code2 }, { name: 'Display', text: 'Read-only access for TV screens', icon: Monitor }].map(r => <div className="role-card" key={r.name}><r.icon size={22}/><strong>{r.name}</strong><p>{r.text}</p></div>)}</div><section className="panel"><SectionHead eyebrow="WORKSPACE ACCOUNTS" title={`${users.length} people, one workspace.`}/><div className="table-scroll"><table><thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Line access</th><th>Status</th><th>Action</th></tr></thead><tbody>{users.map(u => <tr key={u.id}><td><Person name={u.name} title={u.id === user.id ? 'Your account' : 'Workspace member'}/></td><td>{u.username}</td><td><Badge>{u.role}</Badge></td><td>{u.role === 'developer' ? 'All configured lines (' + u.lines.join(', ') + ')' : u.lines.join(', ') || 'No lines assigned'}</td><td><Badge type={u.active ? 'success' : 'neutral'} dot>{u.active ? 'Active' : 'Disabled'}</Badge></td><td><button className="text-btn" disabled={u.id === user.id || user.role !== 'developer' && ['developer', 'management'].includes(u.role)} onClick={async () => { try { await api(`/users/${u.id}`, { active: !u.active }, 'PATCH'); await refreshUsers(); notify(`Account ${u.active ? 'disabled' : 'enabled'}.`); } catch (e) { notify(e.message, true); } }}>{u.active ? 'Disable' : 'Enable'}</button></td></tr>)}</tbody></table></div></section><div className="notice"><Layers3 size={18}/>Attendance follows account line access: ABB2 → FC Line 1; ABB3 → FC Line 3; ABB7 → Mini Forming. FC Line 2 is unassigned and ABB4 is retired. Each line has independent checksheet records. Machine commands are commissioned separately.</div></>;
}

function EntryModal({ kind, preset, state, user, close, action, onUserCreated, fullPage = false, readOnly = false }) {
  const serverOffset = useMemo(() => state.serverTime - Date.now(), [state.serverTime]);
  const s = state.shift;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(new Date());
  const defaults = {
    shift: { date: today, shift: 'Day', overtime: false, supervisor: '', leader: '', forming: [], waterjet: [], assembly: [], quality: '' },
    setup: { model: state.setup?.model || '', lot: state.setup?.lot || '', plan: state.setup?.plan || 73 },
    condition: { heating: '', cooling: '', shuttle: '2A', waterjet: '', rh: '', ctr: '', lh: '', glueStd: '', glueActual: '' },
    reject: { slab: 0, returnRoll: 0, ng: 0, loft: 0, code: '', oht: '', slabCode: '', ngCode: '', loftCode: '', remarks: '' },
    timer: { category: state.timer.category, reason: state.timer.reason, targetMinutes: state.timer.targetMinutes, duration: 0, actionTaken: state.timer.action, remarks: state.timer.remarks },
    henkaten: { category: preset.category || 'man', status: preset.status || 'NG', issue: '', action: '' },
    verify: { status: 'verified', remarks: '' }, user: { name: '', username: '', role: 'operator', password: '', lines: ['ABB2'] }, report: {}, end: {}
  };
  const [form, setForm] = useState(defaults[kind]); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [now, setNow] = useState(Date.now());
  const [rejectType, setRejectType] = useState(null);
  const [accountLines, setAccountLines] = useState([]);
  useEffect(() => { if (kind === 'user') api('/account-lines').then(r => setAccountLines(r.lines)).catch(e => setError(e.message)); }, [kind]);
  const [timerMethod, setTimerMethod] = useState('timer');
  const timerReasonRef = useRef(null);
  const [startAttempted, setStartAttempted] = useState(false);
  const timerBusy = busy || readOnly || kind === 'timer' && state.commands.some(command => command.kind === 'timer' && command.status === 'pending');
  const set = useCallback((k, v) => setForm(f => ({ ...f, [k]: v })), []);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 500); const onEscape = e => { if (e.key === 'Escape') close(); }; window.addEventListener('keydown', onEscape); return () => { clearInterval(timer); window.removeEventListener('keydown', onEscape); }; }, [close]);
  useEffect(() => { if (kind === 'timer' && state.timer.status !== 'idle') setForm(f => ({ ...f, category: state.timer.category, reason: state.timer.reason, targetMinutes: state.timer.targetMinutes })); }, [kind, state.timer.revision]);
  async function submit(e, timerAction) {
    e?.preventDefault(); setError('');
    if (readOnly) { setError('View only. Ask an operator to update downtime.'); return; }
    if (kind === 'timer' && timerAction === 'start') {
      setStartAttempted(true);
      if (!form.category) { setError('Select a category.'); return; }
      if (!form.reason?.trim()) { setError('Enter the reason before starting.'); timerReasonRef.current?.focus(); return; }
    }
    if (kind === 'reject' && (!rejectType || Number(form[rejectType]) <= 0)) { setError('Select a reject type and enter a quantity greater than 0.'); return; }
    setBusy(true);
    try {
      if (kind === 'user') { await api('/users', form); await onUserCreated(); close(); return; }
      const result = await action(kind, kind === 'timer' ? { ...form, action: timerAction || 'log', revision: state.timer.revision } : form, true);
      if (kind !== 'timer' || ['log', 'cancel'].includes(timerAction || 'log')) close();
      if (result.pending && kind === 'timer') setError('Sent. Waiting for the machine. Please do not press again.');
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  const titles = { shift: 'Set shift', setup: 'Set model and lot', condition: 'Check parameters', reject: 'Enter reject', timer: 'Record downtime', henkaten: 'Report 4M change', verify: 'Verify the production record', report: 'Generate a PDF report', user: 'Add account', end: 'End shift' };
  const input = (key, label, type = 'text', props = {}) => <Field label={label}><input type={type} required value={form[key]} onChange={e => set(key, type === 'number' && e.target.value !== '' ? Number(e.target.value) : e.target.value)} {...(type === 'number' ? { min: 0, step: 'any' } : {})} {...props}/></Field>;
  const elapsed = state.timer.status === 'running' ? Math.max(0, (now + serverOffset - state.timer.startedAt) / 1000) : state.timer.elapsedSeconds;
  const remaining = state.timer.targetMinutes > 0 ? Math.max(0, state.timer.targetMinutes * 60 - elapsed) : elapsed;
  return <div className={fullPage ? "downtime-page-shell" : "modal-overlay"} onMouseDown={e => { if (!fullPage && e.target === e.currentTarget && !busy) close(); }}><section className={`${fullPage ? "downtime-page" : "modal"} entry-modal entry-${kind} timer-state-${state.timer.status}`} role={fullPage ? "region" : "dialog"} aria-modal={fullPage ? undefined : true} aria-labelledby="modal-title"><header><div><span className="eyebrow">{state.line} · {state.mode === 'demo' ? 'DEMO WORKSPACE' : state.mode === 'manual' ? 'MANUAL RECORDS' : 'PRODUCTION'}</span><h2 id="modal-title">{fullPage ? "DOWNTIME" : titles[kind]}</h2></div>{!fullPage && <button className="icon-btn" aria-label="Close dialog" onClick={close} disabled={busy}><X size={22}/></button>}</header><form onSubmit={e => submit(e)}><div className="modal-body">
    {kind === 'shift' && (state.mode === 'manual' ? <ManualShiftFields form={form} set={set}/> : <><div className="notice"><Clock3 size={17}/>Select the date, shift and operator names. A future shift starts at its scheduled time.</div><div className="form-grid">{input('date', 'Production date', 'date')}<Field label="Shift"><Select items={['Day', 'Night']} value={form.shift} onChange={v => set('shift', v)}/></Field><label className="checkbox"><input type="checkbox" checked={form.overtime} onChange={e => set('overtime', e.target.checked)}/>Overtime (OT)</label><div className="working-preview"><Clock3 size={15}/>{form.shift === 'Day' ? form.overtime ? '08:00 – 20:00' : '08:00 – 16:15' : form.overtime ? '20:00 – 08:00 (+1 day)' : '16:15 – 00:30 (+1 day)'}</div><Field label="Supervisor"><Select items={state.people.supervisors} value={form.supervisor} onChange={v => set('supervisor', v)}/></Field><Field label="Line leader"><Select items={state.people.leaders} value={form.leader} onChange={v => set('leader', v)}/></Field>{['forming', 'waterjet', 'assembly'].map(key => <Field key={key} label={`${key[0].toUpperCase() + key.slice(1)} operators`}><div className="operator-picker">{state.people.operators.map(name => { const used = ['forming', 'waterjet', 'assembly'].some(k => k !== key && form[k].includes(name)) || form.quality === name; return <label key={name} className={used ? 'disabled' : ''}><input type="checkbox" disabled={used} checked={form[key].includes(name)} onChange={e => set(key, e.target.checked ? [...form[key], name] : form[key].filter(n => n !== name))}/>{name}</label>; })}</div></Field>)}<Field label="Quality inspector"><Select items={state.people.quality} value={form.quality} onChange={v => set('quality', v)}/></Field></div></>)}
    {kind === 'setup' && <><div className="form-grid"><Field label="Model"><Select items={state.models.map(m => m.name)} value={form.model} onChange={v => { set('model', v); set('plan', state.models.find(m => m.name === v)?.pcsHr || 1); }}/></Field>{input('lot', 'Lot number', 'text', { maxLength: 80 })}{input('plan', 'Hourly target (pcs)', 'number', { min: 1, max: 10000, step: 1 })}<Detail label="Standard cycle" value={`${state.models.find(m => m.name === form.model)?.cycle || '—'} min / pc`}/></div><div className="notice"><Settings2 size={18}/>Check the parameters after changing the model.</div></>}
    {kind === 'condition' && <><div className="form-model"><Factory size={21}/>{state.setup?.model}<Badge>Lot {state.setup?.lot}</Badge></div><div className="form-grid">{input('heating', 'Heating time (seconds)', 'number')}{input('cooling', 'Cooling time (seconds)', 'number')}{input('shuttle', 'Shuttle')}{input('waterjet', 'Waterjet code')}{input('rh', 'RH temperature (°C)', 'number', { max: 500 })}{input('ctr', 'CTR temperature (°C)', 'number', { max: 500 })}{input('lh', 'LH temperature (°C)', 'number', { max: 500 })}{input('glueStd', 'Standard glue (grams)', 'number')}{input('glueActual', 'Actual glue (grams)', 'number')}</div></>}
    {kind === 'reject' && <RejectFields form={form} set={set} setForm={setForm} selected={rejectType} choose={setRejectType}/>}
    {kind === 'timer' && <DowntimeFields form={form} set={set} state={state} method={timerMethod} setMethod={setTimerMethod} seconds={remaining} busy={timerBusy} submit={submit} fullPage={fullPage} reasonRef={timerReasonRef} startAttempted={startAttempted}/>}
    {kind === 'henkaten' && <FourMFields form={form} set={set} state={state}/>}
    {kind === 'verify' && <><div className="notice"><ShieldCheck size={18}/>Verification is saved with your account, the shift and timestamp.</div><Field label="Verification result"><Select items={[{ value: 'verified', label: 'Correct — verified' }, { value: 'issue', label: 'Issue found — follow-up required' }]} value={form.status} onChange={v => set('status', v)}/></Field><Field label="Remarks / issue details"><textarea required={form.status === 'issue'} maxLength={500} value={form.remarks} onChange={e => set('remarks', e.target.value)}/></Field></>}
    {kind === 'report' && <><div className="report-confirm"><FileText size={40}/><h3>{s?.id}</h3><p>The report includes hourly production, rejects, downtime, parameter checks, Henkaten history and verification.</p><Badge type={state.mode === 'demo' ? 'amber' : 'success'}>{state.mode === 'demo' ? 'Demo data — marked in PDF' : 'Production snapshot'}</Badge></div></>}
    {kind === 'end' && <div className="notice"><AlertTriangle size={22}/>This ends the current shift and saves its PDF report. It does not send a command to production equipment.</div>}
    {kind === 'user' && <><div className="form-grid">{input('name', 'Full name', 'text', { maxLength: 80 })}{input('username', 'Username', 'text', { autoComplete: 'off', maxLength: 40 })}<Field label="Account role"><Select items={user.role === 'developer' ? ['operator', 'management', 'executive', 'developer', 'display'] : ['operator', 'executive', 'display']} value={form.role} onChange={v => set('role', v)}/></Field>{input('password', 'Initial password (12+ characters)', 'password', { minLength: 12, maxLength: 200, autoComplete: 'new-password' })}</div><fieldset><legend>Account line access{form.role === 'developer' ? ' — all configured lines automatically' : ''}</legend>{accountLines.map(line => <label className="checkbox" key={line}><input type="checkbox" checked={form.role === 'developer' || form.lines.includes(line)} disabled={form.role === 'developer'} onChange={e => set('lines', e.target.checked ? [...form.lines, line] : form.lines.filter(value => value !== line))}/>{line}</label>)}</fieldset><p className="hint">Attendance and photos follow these account permissions. Each assigned line has its own checksheet. Machine commands are commissioned separately. Executive and display accounts are read-only.</p></>}
    {error && kind !== 'timer' && <div className="form-error" role="alert">{error}</div>}
  </div>{kind === 'timer' && error && <div className="form-error timer-action-error" role="alert">{error}</div>}<footer><button type="button" className="btn secondary" onClick={close} disabled={busy}>{fullPage ? <><Home size={22}/>HOME</> : "Close"}</button>{kind === 'timer' ? <DowntimeSaveButton state={state} method={timerMethod} busy={timerBusy} submit={submit}/> : <button className="btn primary save-action" disabled={busy || kind === 'reject' && !rejectType}>{busy ? 'Saving…' : kind === 'report' ? 'Generate PDF' : kind === 'end' ? 'End shift' : kind === 'shift' ? (state.shift?.status === 'active' ? 'Save next shift' : 'Start shift') : kind === 'setup' ? 'Save model / lot' : kind === 'condition' ? 'Save parameters' : kind === 'reject' ? 'SAVE REJECT' : kind === 'henkaten' ? `SAVE ${form.status}` : 'Save'}<Check size={20}/></button>}</footer></form></section></div>;
}

export default function App() {
  const [user, setUser] = useState(null); const [config, setConfig] = useState(null); const [loading, setLoading] = useState(true); const [state, setState] = useState(null);
  const [selectedLine, setSelectedLine] = useState('');
  const [route, setRoute] = useState(location.hash.slice(1) || 'overview'); const [sidebar, setSidebar] = useState(false); const [online, setOnline] = useState(navigator.onLine); const [streamConnected, setStreamConnected] = useState(false);
  const [modal, setModal] = useState(null); const [toast, setToast] = useState(null); const [users, setUsers] = useState([]); const [installPrompt, setInstallPrompt] = useState(null); const [showActivity, setShowActivity] = useState(false); const [clock, setClock] = useState(Date.now()); const [loadError, setLoadError] = useState('');
  const { needRefresh: [needRefresh] } = useRegisterSW({ immediate: true, onNeedReload() {} });
  const [updating, setUpdating] = useState(false);
  const updateInProgress = useRef(false);
  const updateApp = useCallback(async () => {
    if (updateInProgress.current) return;
    updateInProgress.current = true; setUpdating(true);
    try {
      const response = await fetch('/api/health', { cache: 'no-store', signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error('The server is unavailable. Try again when connected.');
      await applyAppUpdate({ serviceWorker: navigator.serviceWorker, reload: () => window.location.reload() });
    } catch (error) {
      setToast({ message: `App update could not finish. ${error.message}`, error: true });
    } finally { updateInProgress.current = false; setUpdating(false); }
  }, []);
  const tv = route.startsWith('tv/'); const page = tv ? route.slice(3) : route;
  const manage = user && managementRoles.includes(user.role); const canEdit = user && writingRoles.includes(user.role);
  const writable = canEdit && online && streamConnected && state?.connected;
  function switchLine(line) {
    if (line === selectedLine || !user.lines.includes(line)) return;
    if (modal && !window.confirm('Close the unsaved form and switch production line?')) return;
    setModal(null); setState(null); setStreamConnected(false); setShowActivity(false);
    setApiLine(line); setSelectedLine(line);
  }
  useEffect(() => {
    const line = user?.lines.includes(selectedLine) ? selectedLine : user?.lines[0] || '';
    setApiLine(line);
    if (line !== selectedLine) { setState(null); setStreamConnected(false); setSelectedLine(line); }
  }, [user, selectedLine]);
  function notify(message, error = false) { setToast({ message, error }); }
  function go(next) { location.hash = next; setSidebar(false); setShowActivity(false); }
  function open(kind, preset = {}) { if (kind === 'timer') { go('downtime'); return; } setModal({ kind, preset }); }
  async function refreshUsers() { try { setUsers(await api('/users')); } catch (e) { notify(e.message, true); } }
  async function action(kind, payload, propagate = false) {
    if (!online || !streamConnected) { const error = new Error('Connection lost. Your action has not been sent.'); if (propagate) throw error; notify(error.message, true); return; }
    try { const result = await api(`/actions/${kind}`, payload); notify(result.pending ? result.message : kind === 'report' ? 'PDF report generated. Open it in PDF Reports.' : 'Saved.'); if (result.reportId) go('reports'); return result; } catch (e) { if (propagate) throw e; notify(e.message, true); }
  }
  useEffect(() => {
    const hash = () => setRoute(location.hash.slice(1) || 'overview'); const on = () => setOnline(true); const off = () => { setOnline(false); setStreamConnected(false); };
    const install = e => { e.preventDefault(); setInstallPrompt(e); };
    window.addEventListener('hashchange', hash); window.addEventListener('online', on); window.addEventListener('offline', off); window.addEventListener('beforeinstallprompt', install);
    const timer = setInterval(() => setClock(Date.now()), 1000);
    let disposed = false, sessionRetry;
    async function restoreSession() {
      try {
        const nextConfig = await api('/config');
        if (disposed) return;
        setConfig(nextConfig);
        const result = await api('/auth/me');
        if (disposed) return;
        setUser(result.user); setLoadError(''); setLoading(false);
      } catch (error) {
        if (disposed) return;
        if (error.status === 401) { setLoadError(''); setLoading(false); }
        else {
          setLoadError('Reconnecting to Production Digital. Your session will resume when the server is reachable.');
          sessionRetry = setTimeout(restoreSession, 3000);
        }
      }
    }
    restoreSession();
    return () => { disposed = true; clearTimeout(sessionRetry); clearInterval(timer); window.removeEventListener('hashchange', hash); window.removeEventListener('online', on); window.removeEventListener('offline', off); window.removeEventListener('beforeinstallprompt', install); };
  }, []);
  useEffect(() => {
    if (!user || !online || !selectedLine || !user.lines.includes(selectedLine)) return;
    let disposed = false;
    const events = new EventSource(lineUrl('/events', selectedLine));
    events.addEventListener('state', e => { const next = JSON.parse(e.data); if (!disposed && next.line === selectedLine) { setState(next); setStreamConnected(true); setLoadError(''); } });
    events.onerror = () => { setStreamConnected(false); revalidateSession(() => api('/auth/me'), () => { if (!disposed) { setUser(null); setState(null); } }); };
    return () => { disposed = true; events.close(); setStreamConnected(false); };
  }, [user, online, selectedLine]);
  useEffect(() => { if (page === 'users' && manage) refreshUsers(); }, [page, user]);
  useEffect(() => { if (needRefresh && !user && !loading) updateApp(); }, [needRefresh, user, loading, updateApp]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(null), 5500); return () => clearTimeout(timer); }, [toast]);
  async function logout() { try { await api('/auth/logout', {}); setUser(null); setState(null); setModal(null); setShowActivity(false); go('overview'); } catch (e) { notify(e.message, true); } }
  if (loading) return <div className="boot"><Brand/><span>{loadError || 'Opening your workspace…'}</span></div>;
  if (!user) return <Login onLogin={setUser} demo={config?.demo} error={loadError}/>;
  if (!user.lines.length) return <div className="boot"><Brand/><Empty icon={ShieldCheck} title="No line assigned" text="Ask your administrator to assign line access to this account."><button className="btn secondary" onClick={logout}>Sign out</button></Empty></div>;
  const title = navigation.find(n => n.id === page)?.label || (page === 'users' ? 'User Management' : page === 'downtime' ? 'Downtime' : 'Overview');
  return <div className={`app page-${page} ${tv ? 'tv-mode' : ''}`}>
    {!tv && <><div className={`sidebar-backdrop ${sidebar ? 'visible' : ''}`} onClick={() => setSidebar(false)}/><aside className={`sidebar ${sidebar ? 'open' : ''}`}><Brand/><div className="workspace-select"><span className="line-mark"><Factory size={21}/></span><div><span>PRODUCTION LINE</span><div className="workspace-line-choice">{user.lines.length > 1 ? <select aria-label="Production line" value={selectedLine} onChange={event => switchLine(event.target.value)}>{user.lines.map(line => <option key={line} value={line}>{line}</option>)}</select> : <strong>{selectedLine}</strong>}</div></div><Badge type="lime">Active</Badge></div><div className="nav-group-label">WORKSPACE</div><nav>{navigation.map(({ id, label, icon: Icon }) => <button key={id} className={page === id ? 'active' : ''} onClick={() => go(id)}><Icon size={21}/><span>{label}</span>{id === 'henkaten' && state?.issues.filter(i => i.status === 'pending').length > 0 ? <b>{state.issues.filter(i => i.status === 'pending').length}</b> : <ChevronRight size={16}/>}</button>)}</nav>{manage && <><div className="nav-group-label">ADMINISTRATION</div><nav><button className={page === 'users' ? 'active' : ''} onClick={() => go('users')}><Users size={21}/><span>User Management</span><ChevronRight size={16}/></button></nav></>}<div className="sidebar-bottom"><div className="sidebar-note"><Zap size={22}/><div><strong>Production Digital</strong><span>{selectedLine} production</span></div></div><div className="sidebar-footer"><span>© DIGITAL TRANSFORMATION UNIT</span><Badge type="lime">v1.0</Badge></div></div></aside></>}
    <div className="app-body"><header className="topbar">{!tv && <button className="icon-btn mobile-menu" aria-label="Open menu" onClick={() => setSidebar(true)}><Menu size={22}/></button>}<div className="header-identity"><img src="/company-logo.png" alt="Sugihara Grand Industries Sdn Bhd"/><strong className="header-page-name">{title.split(' ').length > 1 ? <><b>{title.split(' ').slice(0, -1).join(' ')}</b> <span>{title.split(' ').at(-1)}</span></> : <b>{title}</b>}</strong></div><button className="btn home-button" onClick={() => go(canEdit ? 'checksheet' : 'overview')}><Home size={23}/>HOME</button><div className="topbar-right"><span className="desktop-clock">{time(clock)} <small>MYT</small></span><Badge type={online && streamConnected && (config?.mode === 'attendance' || state?.connected) ? 'success' : 'amber'} dot>{!online ? 'Offline' : !streamConnected ? 'Reconnecting' : config?.mode === 'attendance' || state?.connected ? 'Connected' : 'Line disconnected'}</Badge>{state?.mode === 'demo' && <Badge type="amber">Demo</Badge>}{tv ? <><button className="icon-btn" title="Fullscreen" onClick={() => { if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => notify('Fullscreen is unavailable.', true)); else document.exitFullscreen?.(); }}><Expand size={20}/></button><button className="btn secondary" onClick={() => go(page)}>Exit TV</button></> : <><button className="icon-btn notification-button" aria-label="Recent activity" onClick={() => setShowActivity(v => !v)}><Bell size={19}/>{state?.issues.some(i => i.status === 'pending') && <i/>}</button><span className="topbar-divider"/><span className="user-avatar">{initials(user.name)}</span><div className="user-label"><strong>{user.name}</strong><span>{user.role}</span></div><button className="icon-btn" title="Sign out" onClick={logout}><LogOut size={18}/></button></>}</div></header>
    {showActivity && <aside className="activity-popover"><header><h3>Recent activity</h3><button className="icon-btn" aria-label="Close activity" onClick={() => setShowActivity(false)}><X size={18}/></button></header>{state?.audit.slice(0, 8).map(item => <div key={item.id}><span><Activity size={16}/></span><p><strong>{item.label}</strong><small>{item.actor} · {time(item.createdAt)}</small></p></div>)}</aside>}
    <main className="main-content">{state?.mode === 'manual' && <div className="notice"><ClipboardCheck size={18}/>{selectedLine} · Manual production records. Machine counts are not connected and are never simulated.</div>}{state?.mode === 'demo' && <div className="environment-banner"><span><Code2 size={15}/>Demo only · Sample data. Machine not connected.</span><span>ABB2 first</span></div>}{(!online || !streamConnected || state && !state.connected) && <div className="connection-banner" role="status"><WifiOff size={19}/>{!online ? 'You are offline. Displayed records may be outdated; production actions are disabled.' : !streamConnected ? 'Reconnecting to the server. Production actions are disabled until synchronization returns.' : 'The ABB2 Python service is disconnected. Displayed machine data is stale.'}</div>}{needRefresh && <div className="notice"><RefreshCw size={17}/>A new app version is available.<button className="text-btn" disabled={updating} onClick={() => { if (!modal || window.confirm('Close the current unsaved form and update the app?')) updateApp(); }}>{updating ? 'Updating…' : 'Update app'}</button></div>}
    {!state ? <Empty title="Connecting" text={loadError || 'Waiting for this line’s saved records.'}/> : <div className="page-content" key={`${selectedLine}:${page}`}>{page === 'attendance' && <Attendance line={selectedLine}/>}{page === 'overview' && <Dashboard state={state} user={user} go={go} open={open} writable={writable}/>} {page === 'checksheet' && <Checksheet state={state} user={user} go={go} open={open} action={action} writable={writable} connected={online && streamConnected && state.connected}/>} {page === 'downtime' && <EntryModal fullPage readOnly={!writable} kind="timer" preset={{}} state={state} user={user} close={() => go('checksheet')} action={action}/>} {page === 'live' && <LiveChecksheet state={state} open={open} tv={tv} manage={manage}/>} {page === 'henkaten' && <Henkaten state={state} open={open} writable={canEdit && online && streamConnected} tv={tv}/>} {page === 'reports' && <Reports state={state} open={open} manage={manage && online && streamConnected}/>} {page === 'users' && (manage ? <UserManagement user={user} users={users} refreshUsers={refreshUsers} notify={notify} open={open}/> : <Empty icon={ShieldCheck} title="Management access required" text="Your account cannot manage users."/>)} {!['attendance', 'overview', 'checksheet', 'downtime', 'live', 'henkaten', 'reports', 'users'].includes(page) && <Empty title="Page not found" text="Choose a workspace from the menu."/>}</div>}
    {!tv && <footer className="app-footer"><span>Production Digital <i/>{selectedLine}</span><div>{installPrompt ? <button className="text-btn" onClick={async () => { await installPrompt.prompt(); setInstallPrompt(null); }}><Smartphone size={15}/>Install app</button> : <span><Smartphone size={14}/>PC & tablet ready</span>}{['live', 'henkaten'].includes(page) && <button className="text-btn" onClick={() => go(`tv/${page}`)}><Monitor size={16}/>TV display<ArrowUpRight size={14}/></button>}</div></footer>}
    {state?.commands.some(c => ['pending', 'unconfirmed', 'rejected', 'failed'].includes(c.status)) && <div className="command-tray">{state.commands.filter(c => ['pending', 'unconfirmed', 'rejected', 'failed'].includes(c.status)).slice(0, 2).map(c => <span key={c.id}><Clock3 size={14}/>{c.kind}: {c.status === 'unconfirmed' ? 'Confirmation timed out — check the line before retrying' : c.status}</span>)}</div>}
    </main></div>{state && !tv && <ShiftEndNotice shift={state.shift} pendingShift={state.pendingShift} writable={writable} open={open} go={go}/>} {modal && state && <EntryModal key={modal.kind} kind={modal.kind} preset={modal.preset} state={state} user={user} close={() => setModal(null)} action={action} onUserCreated={async () => { await refreshUsers(); notify('Account created.'); }}/>} {toast && <div className={`toast ${toast.error ? 'error' : ''}`} role="status">{toast.error ? <AlertTriangle size={20}/> : <CheckCheck size={20}/>}<span>{toast.message}</span><button aria-label="Dismiss notification" onClick={() => setToast(null)}><X size={17}/></button></div>}
  </div>;
}
