import { useEffect, useRef, useState } from 'react';
import { RefreshCw, Plus, Users, Pencil, Trash2 } from 'lucide-react';
import { api } from './api.js';
import { productionGroup } from '../shared/productionGroups.js';
import SmoothSelect from './SmoothSelect.jsx';
import './executive.css';
import { PageSkeleton } from './ui.jsx';

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const localInput = value => new Date(Date.parse(value) + 8 * 3600000).toISOString().slice(0, 16);
const displayTime = value => new Date(value).toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const inputTime = value => new Date(`${value}:00+08:00`).toISOString();
const blank = date => ({ employeeId: '', line: '', shiftName: 'Day', start: `${date}T08:00`, end: `${date}T16:15` });

export default function ExecutiveWorkspace({ openLine }) {
  const [date, setDate] = useState(today), [data, setData] = useState(null), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [group, setGroup] = useState(''), [search, setSearch] = useState(''), [form, setForm] = useState(null), [busy, setBusy] = useState(false);
  const [mapping, setMapping] = useState(null), [attempt, setAttempt] = useState(0), [loading, setLoading] = useState(true);
  const generation = useRef(0);
  useEffect(() => {
    const current = ++generation.current; let disposed = false, timer;
    setData(null); setError(''); setLoading(true);
    async function load() {
      try {
        const result = await api(`/executive?date=${date}`);
        if (disposed || generation.current !== current) return;
        setData(result); setError('');
      } catch (e) { if (!disposed && generation.current === current) { setError(e.message); if ([401, 403].includes(e.status)) setData(null); } }
      finally { if (!disposed) { setLoading(false); timer = setTimeout(load, 15000); } }
    }
    load(); return () => { disposed = true; clearTimeout(timer); };
  }, [date, attempt]);
  const selectedGroup = group || data?.groups[0]?.id || '';
  const scopedLines = data?.lines.filter(item => item.groupId === selectedGroup) || [];
  const people = data?.employees.filter(person => person.productionGroup.id === selectedGroup) || [];
  const peopleById = new Map(people.map(person => [person.id, person]));
  const assignments = data?.assignments.filter(item => item.groupId === selectedGroup) || [];
  const filtered = people.filter(person => `${person.name} ${person.team} ${person.line}`.toLowerCase().includes(search.toLowerCase()));
  function refresh() { setAttempt(value => value + 1); }
  async function mutate(path, payload, method, success) {
    setBusy(true); setError(''); setMessage('');
    try { await api(path, payload, method); setMessage(success); refresh(); return true; }
    catch (e) { setError(e.message); return false; }
    finally { setBusy(false); }
  }
  async function save(event) {
    event.preventDefault();
    try {
      if (await mutate('/executive/assignments', { ...form, startAt: inputTime(form.start), endAt: inputTime(form.end) }, 'POST', 'Shift assignment saved.')) setForm(null);
    } catch { setError('Choose valid shift times.'); }
  }
  function edit(item) { setForm(item ? { ...item, start: localInput(item.startAt), end: localInput(item.endAt) } : blank(date)); setError(''); }
  return <section className="executive-page">
    <div className="section-head"><div><h1>Executive workspace</h1><p>Plan shifts and line assignments. Attendance shows actual clock-in status.</p></div><button className="btn secondary" onClick={refresh} disabled={busy || loading}><RefreshCw size={18}/>Refresh</button></div>
    {error && <div className="connection-banner" role="alert">{error}{data && ' Displayed information may be outdated.'}</div>}
    {message && <div className="notice" role="status">{message}</div>}
    {loading && <PageSkeleton variant="grid" label="Loading executive workspace"/>}
    {data && <>
      {data.canConfigure && <details className="panel executive-setup" data-update-blocked={!!mapping || busy || !!form}><summary>Production group setup</summary><p>Map each line to its permanent division and site. Employee labels follow the connected Attendance group. Configure separate Attendance groups when sites share a line name.</p><div className="executive-config-grid">{data.lines.map(item => <label className="field" key={item.line}><span>{item.line}</span><SmoothSelect ariaLabel={`${item.line} production group`} items={[{ value: '', label: 'Not assigned' }, ...data.groups.map(g => ({ value: g.id, label: g.label }))]} value={mapping?.[item.line] ?? item.groupId} required={false} onChange={value => setMapping(old => ({ ...Object.fromEntries(data.lines.map(l => [l.line, l.groupId])), ...old, [item.line]: value }))}/></label>)}</div><button className="btn primary" disabled={busy || !mapping} onClick={async () => { if (await mutate('/executive/line-groups', { lineGroups: mapping }, 'PUT', 'Production groups saved.')) setMapping(null); }}>Save production groups</button></details>}
      <div className="executive-toolbar"><label className="field"><span>Division and site</span><SmoothSelect ariaLabel="Division and site" items={data.groups.map(g => ({ value: g.id, label: g.label }))} value={selectedGroup} onChange={value => { setGroup(value); setForm(null); }}/></label><label className="field"><span>Planning date (Malaysia)</span><input type="date" required value={date} onChange={e => { if (e.target.value) { setDate(e.target.value); setForm(null); } }}/></label><button className="btn primary" disabled={busy || !scopedLines.length || !!data.attendanceError || !!error} onClick={() => edit()}><Plus size={18}/>Assign shift</button></div>
      <div className="executive-group-heading"><span className="eyebrow">{productionGroup(selectedGroup)?.division}</span><h2>{productionGroup(selectedGroup)?.label}</h2></div>
      {!scopedLines.length && <div className="notice">No lines are mapped to this group. An administrator can assign them in Production group setup.</div>}
      {data.attendanceError && <div className="connection-banner" role="alert">{data.attendanceError} Saved shift plans are still shown; employee clock status is unavailable.</div>}
      <div className="executive-metrics">{[['Lines', scopedLines.length], ['Employees', data.attendanceError ? '—' : people.length], ['Currently clocked in', data.attendanceError ? '—' : people.filter(p => p.status === 'IN').length], ['Planned assignments', assignments.length]].map(([label, count]) => <article className="panel" key={label}><span>{label}</span><strong>{count}</strong></article>)}</div>
      <div className="executive-lines">{scopedLines.map(item => <article className="panel" key={item.line}><span className="eyebrow">{item.group.label}</span><h3>{item.line}</h3><p>{item.shift ? `${item.shift.shift} · ${item.shift.date} · ${item.shift.status}` : 'No production shift set'}</p><p>{item.connected ? item.live?.status : 'Line disconnected'} · {item.pendingIssues} pending 4M issues</p><strong>{item.live?.shiftActual ?? 0} pieces this shift</strong><div className="executive-actions">{[['checksheet', 'Checksheet'], ['live', 'Live'], ['henkaten', '4M'], ['work-orders', 'Work orders'], ['reports', 'Reports'], ['attendance', 'Attendance']].map(([page, label]) => <button key={page} className="text-btn" onClick={() => openLine(item.line, page)}>{label}</button>)}</div></article>)}</div>
      <section className="panel"><h2>Shift plan</h2><p>Shifts are planned in Malaysia time. Overnight shifts use the next date for the end time. Production shift recording remains in each line’s checksheet.</p>{!assignments.length ? <p>No assignments for this date.</p> : <div className="table-scroll"><table><thead><tr><th>Employee / group</th><th>Line / shift</th><th>Planned time</th><th>Current attendance</th><th>Actions</th></tr></thead><tbody>{assignments.map(item => <tr key={item.id}><td><strong>{item.employeeName}</strong><small className="executive-label">{productionGroup(item.groupId)?.label}</small></td><td>{item.line}<small className="executive-label">{item.shiftName}</small></td><td>{displayTime(item.startAt)}<small className="executive-label">to {displayTime(item.endAt)}</small></td><td>{peopleById.get(item.employeeId)?.status || 'Unavailable'}</td><td><div className="executive-actions"><button className="text-btn" disabled={busy || !!data.attendanceError || !!error} onClick={() => edit(item)}><Pencil size={15}/>Edit</button><button className="text-btn" disabled={busy} onClick={() => { if (window.confirm(`Remove ${item.employeeName} from ${item.shiftName} on ${item.line}?`)) mutate(`/executive/assignments/${item.id}`, { updatedAt: item.updatedAt }, 'DELETE', 'Assignment removed.'); }}><Trash2 size={15}/>Remove</button></div><small className="executive-label">By {item.updatedBy}</small></td></tr>)}</tbody></table></div>}</section>
      <section className="panel"><div className="section-head"><div><h2><Users size={20}/> Employees</h2><p>{data.updatedAt ? `Attendance updated ${displayTime(data.updatedAt)} · refreshes every 15 seconds` : 'Attendance not available'}</p></div><input aria-label="Search employees" placeholder="Search name, team or line…" value={search} onChange={e => setSearch(e.target.value)}/></div><div className="executive-employees">{filtered.map(person => <article key={person.id}><span className="executive-label">{person.productionGroup.label}</span><strong>{person.name}</strong><span>{person.line} · {person.team ? `Team ${person.team}` : 'Team unassigned'}</span><span>{person.status === 'REVIEW' ? 'Needs review' : person.status === 'IN' ? 'Clocked in' : 'Clocked out'}</span><small>{assignments.filter(a => a.employeeId === person.id).map(a => `${a.line} · ${a.shiftName}`).join(', ') || 'No shift assigned for this date'}</small><button className="text-btn" disabled={busy || !!error} onClick={() => setForm({ ...blank(date), employeeId: person.id })}>Assign shift</button></article>)}</div>{!filtered.length && <p>{data.attendanceError ? 'Employee list unavailable.' : 'No employees match this group or search.'}</p>}<p className="hint">Clocked out does not mean absent. Planned assignments do not change an employee’s permanent division, site, or clock records.</p></section>
    </>}
    {form && <div className="modal-overlay"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="assignment-title"><header><h2 id="assignment-title">{form.id ? 'Edit shift assignment' : 'Assign shift'}</h2></header><form onSubmit={save}><div className="modal-body"><p>{productionGroup(selectedGroup)?.label}</p><label className="field"><span>Employee</span><SmoothSelect ariaLabel="Employee" items={people.map(p => ({ value: p.id, label: `${p.name} · ${p.productionGroup.label}` }))} value={form.employeeId} onChange={value => setForm({ ...form, employeeId: value })}/></label><label className="field"><span>Assigned line</span><SmoothSelect ariaLabel="Assigned line" items={scopedLines.map(l => l.line)} value={form.line} onChange={value => setForm({ ...form, line: value })}/></label><label className="field"><span>Shift name</span><input required maxLength={60} value={form.shiftName} onChange={e => setForm({ ...form, shiftName: e.target.value })}/></label><div className="form-grid">{[['start', 'Start (Malaysia)'], ['end', 'End (Malaysia)']].map(([key, label]) => <label className="field" key={key}><span>{label}</span><input type="datetime-local" required value={form[key]} onChange={e => setForm({ ...form, [key]: e.target.value })}/></label>)}</div>{error && <p className="form-error" role="alert">{error}</p>}</div><footer><button type="button" className="btn secondary" disabled={busy} onClick={() => setForm(null)}>Cancel</button><button className="btn primary" disabled={busy || !form.employeeId || !form.line || !data || !!data.attendanceError}>{busy ? 'Saving…' : 'Save assignment'}</button></footer></form></section></div>}
  </section>;
}
