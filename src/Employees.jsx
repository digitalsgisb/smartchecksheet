import { useEffect, useMemo, useState } from 'react';
import { Pencil, Plus, RefreshCw, Save, UserCheck, UserX, X } from 'lucide-react';
import { api } from './api.js';
import { PageSkeleton } from './ui.jsx';
import './staff.css';

// Production staff, managed here and stored in Smart Attendance. Face enrollment stays at the kiosk.
const roleLabel = { SUPERVISOR: 'Supervisor', LEADER: 'Leader', FORMING: 'Forming', WATERJET: 'Waterjet', ASSEMBLY: 'Assembly', QUALITY: 'Quality' };
const covering = ['SUPERVISOR', 'LEADER'];
const blank = groupId => ({ id: '', name: '', nickname: '', position: '', groupId, line: '', team: '', fcGroup: '', role: '', coversLines: [] });

function StaffForm({ person, data, close, saved }) {
  const [form, setForm] = useState(() => person ? { ...person } : blank(data.groups[0]?.id || '')), [busy, setBusy] = useState(''), [error, setError] = useState('');
  const group = data.groups.find(item => item.id === form.groupId) || data.groups[0];
  const set = (key, value) => { setError(''); setForm(old => ({ ...old, [key]: value })); };
  const line = form.line.trim().toUpperCase(), covers = covering.includes(form.role);
  async function submit(patch = {}, kind = 'save') {
    if (busy) return; setBusy(kind); setError('');
    const employee = { ...form, ...patch, line, coversLines: covers ? form.coversLines : [] };
    try { const result = await api(person ? `/staff/${encodeURIComponent(person.id)}` : '/staff', { employee, ...(person ? { updatedAt: person.updatedAt } : {}) }, person ? 'PUT' : 'POST'); saved(result.employee, kind === 'save' ? person ? 'Saved.' : `${employee.name} added. Ask them to register their face at the kiosk.` : patch.active ? 'Reactivated.' : 'Deactivated.'); }
    catch (err) { setError(err.message); } finally { setBusy(''); }
  }
  return <form className="panel staff-form" data-update-blocked="true" onSubmit={e => { e.preventDefault(); submit(); }}>
    <header><h2>{person ? `Edit ${person.nickname || person.name}` : 'Add person'}</h2><button type="button" className="btn secondary icon-only" aria-label="Close" onClick={close}><X size={18}/></button></header>
    <div className="form-grid">
      <label className="field"><span>Staff number</span><input required disabled={!!person} maxLength={40} pattern="[A-Za-z0-9-]+" value={form.id} onChange={e => set('id', e.target.value.trim())} placeholder="5000958"/></label>
      <label className="field"><span>Full name</span><input required maxLength={80} value={form.name} onChange={e => set('name', e.target.value)}/></label>
      <label className="field"><span>Short name</span><input maxLength={80} value={form.nickname} onChange={e => set('nickname', e.target.value)} placeholder="Shown on tablets"/></label>
      <label className="field"><span>Position</span><input maxLength={80} value={form.position} onChange={e => set('position', e.target.value)} placeholder="OPERATOR"/></label>
      {data.groups.length > 1 && <label className="field"><span>Plant</span><select value={form.groupId} onChange={e => setForm(old => ({ ...old, groupId: e.target.value, team: '', coversLines: [] }))}>{data.groups.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>}
      <label className="field"><span>Line</span><input required list="staff-lines" maxLength={40} value={form.line} onChange={e => set('line', e.target.value.toUpperCase())}/><datalist id="staff-lines">{group?.lines.map(item => <option key={item} value={item}/>)}</datalist></label>
      <label className="field"><span>Team</span><select value={form.team} onChange={e => set('team', e.target.value)}><option value="">No team</option>{group?.teams.map(team => <option key={team} value={team}>Team {team}</option>)}</select></label>
      <label className="field"><span>Role</span><select value={form.role} onChange={e => set('role', e.target.value)}><option value="">No role</option>{data.roles.map(role => <option key={role} value={role}>{roleLabel[role]}</option>)}</select></label>
      {line === 'FC' && <label className="field"><span>FC tablet</span><select value={form.fcGroup} onChange={e => set('fcGroup', e.target.value)}><option value="">Unassigned</option><option value="fc1">FC Line 1</option><option value="fc2">FC Line 2</option><option value="fc3">FC Line 3</option></select></label>}
    </div>
    {covers && <fieldset className="staff-covers"><legend>Also covers these lines</legend>{group?.coverLines.length ? group.coverLines.map(item => <label key={item} className="check"><input type="checkbox" disabled={item === line} checked={item === line || form.coversLines.includes(item)} onChange={e => set('coversLines', e.target.checked ? [...form.coversLines, item] : form.coversLines.filter(other => other !== item))}/>{item}</label>) : <p className="hint">No other lines in this plant.</p>}</fieldset>}
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="script-actions">
      <button className="btn primary" disabled={!!busy}><Save size={17}/>{busy === 'save' ? 'Saving…' : person ? 'Save' : 'Add person'}</button>
      {person && (person.active
        ? <button type="button" className="btn secondary" disabled={!!busy} onClick={() => window.confirm(`Deactivate ${person.nickname || person.name}? They leave the lists; their records stay.`) && submit({ active: false }, 'active')}><UserX size={17}/>{busy === 'active' ? 'Saving…' : 'Deactivate'}</button>
        : <button type="button" className="btn secondary" disabled={!!busy} onClick={() => submit({ active: true }, 'active')}><UserCheck size={17}/>{busy === 'active' ? 'Saving…' : 'Reactivate'}</button>)}
    </div>
    {!person && <p className="hint">Saved to Smart Attendance. Face registration is still done at the kiosk.</p>}
  </form>;
}

export default function Employees() {
  const [data, setData] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [attempt, retry] = useState(0);
  const [editing, setEditing] = useState(null), [message, setMessage] = useState('');
  const [filter, setFilter] = useState({ text: '', groupId: '', line: '', role: '', status: 'active' });
  useEffect(() => {
    let disposed = false;
    setBusy(true);
    api('/staff').then(next => { if (!disposed) { setData(next); setError(''); } }, e => { if (!disposed) setError(e.message); }).finally(() => { if (!disposed) setBusy(false); });
    return () => { disposed = true; };
  }, [attempt]);
  const shown = useMemo(() => {
    const text = filter.text.trim().toLowerCase();
    return (data?.employees || []).filter(p => (filter.status === 'all' || p.active === (filter.status === 'active')) && (!filter.groupId || p.groupId === filter.groupId) && (!filter.line || p.line === filter.line || p.coversLines.includes(filter.line)) && (!filter.role || p.role === filter.role || (filter.role === 'none' && !p.role))
      && (!text || [p.name, p.nickname, p.id, p.position].some(value => value.toLowerCase().includes(text)))).sort((a, b) => a.line.localeCompare(b.line) || (a.nickname || a.name).localeCompare(b.nickname || b.name));
  }, [data, filter]);
  const lines = [...new Set((data?.employees || []).flatMap(p => [p.line, ...p.coversLines]).filter(Boolean))].sort();
  const label = id => data?.groups.find(group => group.id === id)?.label || '—';
  function saved(person, text) {
    setEditing(null); setMessage(text);
    if (person) setData(old => ({ ...old, employees: [...old.employees.filter(p => p.id !== person.id), person] }));
    retry(v => v + 1);
  }
  const set = (key, value) => setFilter(old => ({ ...old, [key]: value }));
  return <div className="staff-page">
    <div className="page-intro"><div><h1>Employees</h1><p>Production staff. Changes save to Smart Attendance at once.</p></div><div className="script-actions"><button className="btn secondary" disabled={busy} onClick={() => retry(v => v + 1)}><RefreshCw size={17}/>{busy ? 'Loading…' : 'Refresh'}</button>{data?.groups.length > 0 && <button className="btn primary" onClick={() => { setEditing('new'); setMessage(''); }}><Plus size={17}/>Add person</button>}</div></div>
    {error && <p className="form-error" role="alert">{error}{data && ' The list below may be out of date.'}</p>}
    {message && <p className="hint" role="status">{message}</p>}
    {editing && data && <StaffForm key={editing === 'new' ? 'new' : editing.id} person={editing === 'new' ? null : editing} data={data} close={() => setEditing(null)} saved={saved}/>}
    {!data && !error && <PageSkeleton variant="table" label="Loading employees"/>}
    {data && <>
      <div className="panel staff-filters">
        <label className="field"><span>Search</span><input type="search" value={filter.text} onChange={e => set('text', e.target.value)} placeholder="Name or staff number"/></label>
        {data.groups.length > 1 && <label className="field"><span>Plant</span><select value={filter.groupId} onChange={e => set('groupId', e.target.value)}><option value="">All</option>{data.groups.map(group => <option key={group.id} value={group.id}>{group.label}</option>)}</select></label>}
        <label className="field"><span>Line</span><select value={filter.line} onChange={e => set('line', e.target.value)}><option value="">All</option>{lines.map(line => <option key={line} value={line}>{line}</option>)}</select></label>
        <label className="field"><span>Role</span><select value={filter.role} onChange={e => set('role', e.target.value)}><option value="">All</option>{data.roles.map(role => <option key={role} value={role}>{roleLabel[role]}</option>)}<option value="none">No role yet</option></select></label>
        <label className="field"><span>Status</span><select value={filter.status} onChange={e => set('status', e.target.value)}><option value="active">Active</option><option value="inactive">Inactive</option><option value="all">All</option></select></label>
      </div>
      <p className="hint">{shown.length} of {data.employees.length} people</p>
      <div className="staff-list">{shown.map(p => <article key={p.id} className={`panel staff-card${p.active ? '' : ' inactive'}`}>
        <div><strong>{p.nickname || p.name}</strong>{p.nickname && <small>{p.name}</small>}<small>{p.id}{p.position && ` · ${p.position}`}</small></div>
        <dl><div><dt>Line</dt><dd>{p.line || '—'}</dd></div><div><dt>Team</dt><dd>{p.team || '—'}</dd></div><div><dt>Role</dt><dd className={p.role ? '' : 'missing'}>{roleLabel[p.role] || 'Not set'}</dd></div>{p.coversLines.length > 1 && <div><dt>Covers</dt><dd>{p.coversLines.join(', ')}</dd></div>}{data.groups.length > 1 && <div><dt>Plant</dt><dd>{label(p.groupId)}</dd></div>}</dl>
        <div className="staff-card-side">{p.active ? <span className={`badge ${p.status === 'IN' ? 'success' : 'neutral'}`}><i/>{p.status === 'IN' ? 'Clocked in' : 'Out'}</span> : <span className="badge amber"><i/>Inactive</span>}<button className="btn secondary" onClick={() => { setEditing(p); setMessage(''); window.scrollTo({ top: 0, behavior: 'smooth' }); }}><Pencil size={16}/>Edit</button></div>
      </article>)}{!shown.length && <p className="hint">No one matches these filters.</p>}</div>
    </>}
  </div>;
}
