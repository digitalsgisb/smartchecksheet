import { useEffect, useRef, useState } from 'react';
import { RefreshCw, Plus, Users, Pencil, Trash2 } from 'lucide-react';
import { api } from './api.js';
import { productionGroup } from '../shared/productionGroups.js';
import SmoothSelect from './SmoothSelect.jsx';
import './executive.css';
import { PageSkeleton } from './ui.jsx';
import ShiftDesignation from './ShiftDesignation.jsx';
import ShiftRotation from './ShiftRotation.jsx';

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const localInput = value => new Date(Date.parse(value) + 8 * 3600000).toISOString().slice(0, 16);
const displayTime = value => new Date(value).toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const inputTime = value => new Date(`${value}:00+08:00`).toISOString();
const blank = date => ({ employeeId: '', line: '', shiftName: 'Day', start: `${date}T08:00`, end: `${date}T16:15` });

export default function ExecutiveWorkspace({ openLine }) {
  const [date, setDate] = useState(today), [data, setData] = useState(null), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [group, setGroup] = useState(''), [search, setSearch] = useState(''), [form, setForm] = useState(null), [busy, setBusy] = useState(false);
  const [mapping, setMapping] = useState(null), [attempt, setAttempt] = useState(0), [loading, setLoading] = useState(true);
  // Optimistic changes: they show at once and are dropped once a reload agrees; a failed save puts things back.
  const [local, setLocal] = useState({}), [overlay, setOverlay] = useState(null); // assignment id -> { item } | { removed }; line -> group id
  const generation = useRef(0), quiet = useRef(false);
  useEffect(() => {
    const current = ++generation.current; let disposed = false, timer;
    // A quiet reload (after saving shift or line) keeps the page on screen instead of showing the loading skeleton.
    if (!quiet.current) { setData(null); setError(''); setLoading(true); }
    quiet.current = false;
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
  useEffect(() => {
    if (!data) return;
    setLocal(old => { const next = { ...old }; for (const [id, change] of Object.entries(next)) { if (change.pending) continue; const row = data.assignments.find(a => a.id === id); if (change.removed ? !row : row && row.updatedAt !== change.from) delete next[id]; } return next; });
    setOverlay(old => old && !old.pending && data.lines.every(l => !(l.line in old.lines) || (old.lines[l.line] || '') === l.groupId) ? null : old);
  }, [data]);
  const selectedGroup = group || data?.groups[0]?.id || '';
  const lines = data?.lines.map(l => overlay && l.line in overlay.lines ? { ...l, groupId: overlay.lines[l.line] || '', group: productionGroup(overlay.lines[l.line]) || null } : l) || [];
  const scopedLines = lines.filter(item => item.groupId === selectedGroup);
  const people = data?.employees.filter(person => person.productionGroup.id === selectedGroup) || [];
  const peopleById = new Map(people.map(person => [person.id, person]));
  const assignments = data ? [...data.assignments.filter(a => !local[a.id]), ...Object.values(local).filter(c => c.item).map(c => c.item)].filter(item => item.groupId === selectedGroup).sort((a, b) => a.startAt.localeCompare(b.startAt) || a.line.localeCompare(b.line) || a.employeeName.localeCompare(b.employeeName)) : [];
  const filtered = people.filter(person => `${person.name} ${person.team} ${person.line}`.toLowerCase().includes(search.toLowerCase()));
  function refresh() { setAttempt(value => value + 1); }
  function quietRefresh() { quiet.current = true; setAttempt(value => value + 1); }
  const forget = key => setLocal(old => { const next = { ...old }; delete next[key]; return next; });
  function save(event) {
    event.preventDefault();
    let startAt, endAt;
    try { startAt = inputTime(form.start); endAt = inputTime(form.end); } catch { setError('Choose valid shift times.'); return; }
    const draft = form, key = form.id || `new-${Date.now()}`;
    const item = { id: key, employeeId: form.employeeId, employeeName: peopleById.get(form.employeeId)?.name || form.employeeName || '', groupId: selectedGroup, line: form.line, shiftName: form.shiftName, startAt, endAt, updatedBy: 'Saving…', updatedAt: form.updatedAt, pending: true };
    setLocal(old => ({ ...old, [key]: { item, pending: true } })); setForm(null); setError(''); setMessage('');
    api('/executive/assignments', { ...draft, startAt, endAt }, 'POST').then(result => {
      const id = result?.id || key;
      setLocal(old => { const next = { ...old }; delete next[key]; next[id] = { item: { ...item, id, pending: false, updatedBy: 'You' }, from: draft.updatedAt }; return next; });
      setMessage('Shift assignment saved.'); quietRefresh();
    }, e => { forget(key); setForm(draft); setError(`Not saved. ${e.message}`); });
  }
  function remove(item) {
    if (!window.confirm(`Remove ${item.employeeName} from ${item.shiftName} on ${item.line}?`)) return;
    setLocal(old => ({ ...old, [item.id]: { removed: true, pending: true } })); setError(''); setMessage('');
    api(`/executive/assignments/${item.id}`, { updatedAt: item.updatedAt }, 'DELETE').then(() => { setLocal(old => ({ ...old, [item.id]: { removed: true } })); setMessage('Assignment removed.'); quietRefresh(); }, e => { forget(item.id); setError(`Not removed. ${e.message}`); });
  }
  function saveGroups() {
    const chosen = mapping;
    setOverlay({ lines: chosen, pending: true }); setMapping(null); setError(''); setMessage('');
    api('/executive/line-groups', { lineGroups: chosen }, 'PUT').then(() => { setOverlay({ lines: chosen, pending: false }); setMessage('Production groups saved.'); quietRefresh(); }, e => { setOverlay(null); setMapping(chosen); setError(`Not saved. ${e.message}`); });
  }
  function edit(item) { setForm(item ? { ...item, start: localInput(item.startAt), end: localInput(item.endAt) } : blank(date)); setError(''); }
  return <section className="executive-page">
    <div className="section-head"><div><h1>Executive workspace</h1><p>Plan shifts and line assignments. Attendance shows actual clock-in status.</p></div><button className="btn secondary" onClick={refresh} disabled={busy || loading}><RefreshCw size={18}/>Refresh</button></div>
    {error && <div className="connection-banner" role="alert">{error}{data && ' Displayed information may be outdated.'}</div>}
    {message && <div className="notice" role="status">{message}</div>}
    {loading && <PageSkeleton variant="grid" label="Loading executive workspace"/>}
    {data && <>
      <div className="executive-toolbar"><label className="field"><span>Division and site</span><SmoothSelect ariaLabel="Division and site" items={data.groups.map(g => ({ value: g.id, label: g.label }))} value={selectedGroup} onChange={value => { setGroup(value); setForm(null); }}/></label><label className="field"><span>Planning date (Malaysia)</span><input type="date" required value={date} onChange={e => { if (e.target.value) { setDate(e.target.value); setForm(null); } }}/></label><button className="btn primary" disabled={busy || !scopedLines.length || !!data.attendanceError || !!error} onClick={() => edit()}><Plus size={18}/>Assign shift</button></div>
      <div className="executive-group-heading"><span className="eyebrow">{productionGroup(selectedGroup)?.division}</span><h2>{productionGroup(selectedGroup)?.label}</h2></div>
      {selectedGroup && <ShiftRotation key={selectedGroup} groupId={selectedGroup} rotation={data.rotations?.[selectedGroup] || null} canEdit={!!data.canSetShiftTeam}/>}
      {!data.attendanceError && <ShiftDesignation key={`spv-${selectedGroup}`} supervisors people={people} canEdit={!!data.canSetShiftTeam} lineOptions={data.lineOptions || []} onSaved={() => { quiet.current = true; setAttempt(value => value + 1); }}/>}
      {!scopedLines.length && <div className="notice">No lines are mapped to this group. An administrator can assign them in Production group setup.</div>}
      {data.attendanceError && <div className="connection-banner" role="alert">{data.attendanceError} Saved shift plans are still shown; employee clock status is unavailable.</div>}
      <div className="executive-metrics">{[['Lines', scopedLines.length], ['Employees', data.attendanceError ? '—' : people.length], ['Currently clocked in', data.attendanceError ? '—' : people.filter(p => p.status === 'IN').length], ['Planned assignments', assignments.length]].map(([label, count]) => <article className="panel" key={label}><span>{label}</span><strong>{count}</strong></article>)}</div>
      {!data.attendanceError && <ShiftDesignation key={selectedGroup} people={people} canEdit={!!data.canSetShiftTeam} lineOptions={data.lineOptions || []} onSaved={() => { quiet.current = true; setAttempt(value => value + 1); }}/>}
      <div className="executive-lines">{scopedLines.map(item => <article className="panel" key={item.line}><span className="eyebrow">{item.group.label}</span><h3>{item.line}</h3><p>{item.shift ? `${item.shift.shift} · ${item.shift.date} · ${item.shift.status}` : 'No production shift set'}</p><p>{item.connected ? item.live?.status : 'Line disconnected'} · {item.pendingIssues} pending 4M issues</p><strong>{item.live?.shiftActual ?? 0} pieces this shift</strong><div className="executive-actions">{[['checksheet', 'Checksheet'], ['live', 'Live'], ['henkaten', '4M'], ['work-orders', 'Work orders'], ['reports', 'Reports'], ['attendance', 'Attendance']].map(([page, label]) => <button key={page} className="text-btn" onClick={() => openLine(item.line, page)}>{label}</button>)}</div></article>)}</div>
      <section className="panel" data-update-blocked={Object.values(local).some(c => c.pending)}><h2>Shift plan</h2><p>Shifts are planned in Malaysia time. Overnight shifts use the next date for the end time. Production shift recording remains in each line’s checksheet.</p>{!assignments.length ? <p>No assignments for this date.</p> : <div className="table-scroll"><table><thead><tr><th>Employee / group</th><th>Line / shift</th><th>Planned time</th><th>Current attendance</th><th>Actions</th></tr></thead><tbody>{assignments.map(item => <tr key={item.id} className={`executive-row${item.pending ? ' pending' : ''}`} aria-busy={!!item.pending}><td><strong>{item.employeeName}</strong><small className="executive-label">{productionGroup(item.groupId)?.label}</small></td><td>{item.line}<small className="executive-label">{item.shiftName}</small></td><td>{displayTime(item.startAt)}<small className="executive-label">to {displayTime(item.endAt)}</small></td><td>{peopleById.get(item.employeeId)?.status || 'Unavailable'}</td><td><div className="executive-actions"><button className="text-btn" disabled={busy || !!local[item.id] || !!data.attendanceError || !!error} onClick={() => edit(item)}><Pencil size={15}/>Edit</button><button className="text-btn" disabled={busy || !!local[item.id]} onClick={() => remove(item)}><Trash2 size={15}/>Remove</button></div><small className="executive-label">By {item.updatedBy}</small></td></tr>)}</tbody></table></div>}</section>
      <section className="panel"><div className="section-head"><div><h2><Users size={20}/> Employees</h2><p>{data.updatedAt ? `Attendance updated ${displayTime(data.updatedAt)} · refreshes every 15 seconds` : 'Attendance not available'}</p></div><input aria-label="Search employees" placeholder="Search name, team or line…" value={search} onChange={e => setSearch(e.target.value)}/></div><div className="executive-employees">{filtered.map(person => <article key={person.id}><span className="executive-label">{person.productionGroup.label}</span><strong>{person.name}</strong><span>{person.line} · {person.team ? `Team ${person.team}` : 'Team unassigned'}</span><span>{person.status === 'REVIEW' ? 'Needs review' : person.status === 'IN' ? 'Clocked in' : 'Clocked out'}</span><small>{assignments.filter(a => a.employeeId === person.id).map(a => `${a.line} · ${a.shiftName}`).join(', ') || 'No shift assigned for this date'}</small><button className="text-btn" disabled={busy || !!error} onClick={() => setForm({ ...blank(date), employeeId: person.id })}>Assign shift</button></article>)}</div>{!filtered.length && <p>{data.attendanceError ? 'Employee list unavailable.' : 'No employees match this group or search.'}</p>}<p className="hint">Clocked out does not mean absent. Planned assignments do not change an employee’s permanent division, site, or clock records.</p></section>
      {data.canConfigure && <details className="panel executive-setup" data-update-blocked={!!mapping || busy || !!form || !!overlay?.pending}><summary>Production group setup</summary><p>Map each line to its permanent division and site. Employee labels follow the connected Attendance group. Configure separate Attendance groups when sites share a line name.</p><div className="executive-config-grid">{lines.map(item => <label className="field" key={item.line}><span>{item.line}</span><SmoothSelect ariaLabel={`${item.line} production group`} items={[{ value: '', label: 'Not assigned' }, ...data.groups.map(g => ({ value: g.id, label: g.label }))]} value={mapping?.[item.line] ?? item.groupId} required={false} onChange={value => setMapping(old => ({ ...Object.fromEntries(lines.map(l => [l.line, l.groupId])), ...old, [item.line]: value }))}/></label>)}</div><button className="btn primary" disabled={busy || !mapping} onClick={saveGroups}>Save production groups</button></details>}
    </>}
    {form && <div className="modal-overlay"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="assignment-title"><header><h2 id="assignment-title">{form.id ? 'Edit shift assignment' : 'Assign shift'}</h2></header><form onSubmit={save}><div className="modal-body"><p>{productionGroup(selectedGroup)?.label}</p><label className="field"><span>Employee</span><SmoothSelect ariaLabel="Employee" items={people.map(p => ({ value: p.id, label: `${p.name} · ${p.productionGroup.label}` }))} value={form.employeeId} onChange={value => setForm({ ...form, employeeId: value })}/></label><label className="field"><span>Assigned line</span><SmoothSelect ariaLabel="Assigned line" items={scopedLines.map(l => l.line)} value={form.line} onChange={value => setForm({ ...form, line: value })}/></label><label className="field"><span>Shift name</span><input required maxLength={60} value={form.shiftName} onChange={e => setForm({ ...form, shiftName: e.target.value })}/></label><div className="form-grid">{[['start', 'Start (Malaysia)'], ['end', 'End (Malaysia)']].map(([key, label]) => <label className="field" key={key}><span>{label}</span><input type="datetime-local" required value={form[key]} onChange={e => setForm({ ...form, [key]: e.target.value })}/></label>)}</div>{error && <p className="form-error" role="alert">{error}</p>}</div><footer><button type="button" className="btn secondary" disabled={busy} onClick={() => setForm(null)}>Cancel</button><button className="btn primary" disabled={busy || !form.employeeId || !form.line || !data || !!data.attendanceError}>{busy ? 'Saving…' : 'Save assignment'}</button></footer></form></section></div>}
  </section>;
}
