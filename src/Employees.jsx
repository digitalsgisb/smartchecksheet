import { useEffect, useMemo, useState } from 'react';
import { Pencil, Plus, RefreshCw, Save, UserCheck, UserX, X } from 'lucide-react';
import { api } from './api.js';
import { PageSkeleton, morph } from './ui.jsx';
import SmoothSelect from './SmoothSelect.jsx';
import './staff.css';

// Production staff, managed here and stored in Smart Attendance. Face enrollment stays at the kiosk.
// Everyone who is not a supervisor, leader or quality inspector is an operator.
const roleLabel = { SUPERVISOR: 'Supervisor', LEADER: 'Leader', OPERATOR: 'Operator', QUALITY: 'Quality' };
const covering = ['SUPERVISOR', 'LEADER'];
// The tablet (Checksheet) line for an Attendance line, from the site's Attendance groups: FC + FC Line 1 → ABB2, MF → ABB7.
const homeOf = (map = [], line, fcGroup) => { const found = map.filter(item => item.attendanceLine === line && (!item.fcGroup || item.fcGroup === fcGroup)).map(item => item.line); return found.length ? [...new Set(found)] : line ? [line] : []; };
const fcLabel = { fc1: 'FC Line 1', fc2: 'FC Line 2', fc3: 'FC Line 3' };
const paperLine = p => p.line === 'FC' && fcLabel[p.fcGroup] ? fcLabel[p.fcGroup] : p.line || '—';
const blank = groupId => ({ id: '', name: '', nickname: '', position: '', groupId, line: '', team: '', fcGroup: '', role: '', coversLines: [] });

// Popup that grows from the pressed Edit / Add button and shrinks back into it.
function StaffForm({ person, data, close, saved }) {
  const [form, setForm] = useState(() => person ? { ...person } : blank(data.groups[0]?.id || '')), [busy, setBusy] = useState(''), [error, setError] = useState('');
  const group = data.groups.find(item => item.id === form.groupId) || data.groups[0];
  const set = (key, value) => { setError(''); setForm(old => ({ ...old, [key]: value })); };
  const line = form.line.trim().toUpperCase(), covers = covering.includes(form.role), tablets = homeOf(data.lineMap, line, form.fcGroup);
  const leave = () => { if (!busy) close(); };
  useEffect(() => { const escape = event => { if (event.key === 'Escape' && !event.defaultPrevented) leave(); }; window.addEventListener('keydown', escape); return () => window.removeEventListener('keydown', escape); });
  async function submit(patch = {}, kind = 'save') {
    if (busy) return; setBusy(kind); setError('');
    const employee = { ...form, ...patch, line, coversLines: covers ? form.coversLines : [] };
    try { const result = await api(person ? `/staff/${encodeURIComponent(person.id)}` : '/staff', { employee, ...(person ? { updatedAt: person.updatedAt } : {}) }, person ? 'PUT' : 'POST'); saved(result.employee, kind === 'save' ? person ? 'Saved.' : `${employee.name} added. Ask them to register their face at the kiosk.` : patch.active ? 'Reactivated.' : 'Deactivated.'); }
    catch (err) { setError(err.message); } finally { setBusy(''); }
  }
  return <div className="modal-overlay" onMouseDown={event => { if (event.target === event.currentTarget) leave(); }}>
    <section className="modal staff-modal" role="dialog" aria-modal="true" aria-labelledby="staff-title" data-update-blocked="true">
      <header><h2 id="staff-title">{person ? `Edit ${person.nickname || person.name}` : 'Add person'}</h2><button type="button" className="icon-btn" aria-label="Close dialog" onClick={leave}><X size={22}/></button></header>
      <form onSubmit={e => { e.preventDefault(); submit(); }}>
        <div className="modal-body">
          <div className="form-grid">
            <label className="field"><span>Staff number</span><input required disabled={!!person} maxLength={40} pattern="[A-Za-z0-9-]+" value={form.id} onChange={e => set('id', e.target.value.trim())} placeholder="5000958"/></label>
            <label className="field"><span>Full name</span><input required maxLength={80} value={form.name} onChange={e => set('name', e.target.value)}/></label>
            <label className="field"><span>Short name</span><input maxLength={80} value={form.nickname} onChange={e => set('nickname', e.target.value)} placeholder="Shown on tablets"/></label>
            <label className="field"><span>Position</span><input maxLength={80} value={form.position} onChange={e => set('position', e.target.value)} placeholder="OPERATOR"/></label>
            {data.groups.length > 1 && <label className="field"><span>Plant</span><SmoothSelect stagger ariaLabel="Plant" items={data.groups.map(item => ({ value: item.id, label: item.label }))} value={form.groupId} onChange={value => setForm(old => ({ ...old, groupId: value, team: '', coversLines: [] }))}/></label>}
            <label className="field"><span>Line</span><input required list="staff-lines" maxLength={40} value={form.line} onChange={e => set('line', e.target.value.toUpperCase())}/><datalist id="staff-lines">{group?.lines.map(item => <option key={item} value={item}/>)}</datalist>{line && tablets.join() !== line && <small className="hint">On tablets: {tablets.join(', ')}</small>}</label>
            <label className="field"><span>Team</span><SmoothSelect stagger required={false} ariaLabel="Team" placeholder="No team" items={[{ value: '', label: 'No team' }, ...(group?.teams || []).map(team => ({ value: team, label: `Team ${team}` }))]} value={form.team} onChange={value => set('team', value)}/></label>
            <label className="field"><span>Role</span><SmoothSelect stagger required={false} ariaLabel="Role" placeholder="No role" items={[{ value: '', label: 'No role' }, ...data.roles.map(role => ({ value: role, label: roleLabel[role] || role }))]} value={form.role} onChange={value => set('role', value)}/></label>
            {line === 'FC' && <label className="field"><span>FC tablet</span><SmoothSelect stagger required={false} ariaLabel="FC tablet" placeholder="Unassigned" items={[{ value: '', label: 'Unassigned' }, { value: 'fc1', label: 'FC Line 1' }, { value: 'fc2', label: 'FC Line 2' }, { value: 'fc3', label: 'FC Line 3' }]} value={form.fcGroup} onChange={value => set('fcGroup', value)}/></label>}
          </div>
          {covers && <fieldset className="staff-covers"><legend>Also covers these lines</legend>{group?.coverLines.length ? group.coverLines.map(item => <label key={item} className="check"><input type="checkbox" disabled={tablets.includes(item)} checked={tablets.includes(item) || form.coversLines.includes(item)} onChange={e => set('coversLines', e.target.checked ? [...form.coversLines, item] : form.coversLines.filter(other => other !== item))}/>{item}</label>) : <p className="hint">No other lines in this plant.</p>}</fieldset>}
          {!person && <p className="hint">Saved to Smart Attendance. Face registration is still done at the kiosk.</p>}
          {error && <p className="form-error" role="alert">{error}</p>}
        </div>
        <footer>
          {person && (person.active
            ? <button type="button" className="btn secondary staff-deactivate" disabled={!!busy} onClick={() => window.confirm(`Deactivate ${person.nickname || person.name}? They leave the lists; their records stay.`) && submit({ active: false }, 'active')}><UserX size={17}/>{busy === 'active' ? 'Saving…' : 'Deactivate'}</button>
            : <button type="button" className="btn secondary staff-deactivate" disabled={!!busy} onClick={() => submit({ active: true }, 'active')}><UserCheck size={17}/>{busy === 'active' ? 'Saving…' : 'Reactivate'}</button>)}
          <button type="button" className="btn secondary" disabled={!!busy} onClick={leave}>Cancel</button>
          <button className="btn primary" disabled={!!busy}><Save size={17}/>{busy === 'save' ? 'Saving…' : person ? 'Save' : 'Add person'}</button>
        </footer>
      </form>
    </section>
  </div>;
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
    return (data?.employees || []).filter(p => (filter.status === 'all' || p.active === (filter.status === 'active')) && (!filter.groupId || p.groupId === filter.groupId) && (!filter.line || (p.homeLines || [p.line]).includes(filter.line) || p.coversLines.includes(filter.line)) && (!filter.role || p.role === filter.role || (filter.role === 'none' && !p.role))
      && (!text || [p.name, p.nickname, p.id, p.position].some(value => value.toLowerCase().includes(text)))).sort((a, b) => a.line.localeCompare(b.line) || (a.nickname || a.name).localeCompare(b.nickname || b.name));
  }, [data, filter]);
  const lines = [...new Set((data?.employees || []).flatMap(p => [...(p.homeLines || [p.line]), ...p.coversLines]).filter(Boolean))].sort();
  const label = id => data?.groups.find(group => group.id === id)?.label || '—';
  const open = person => { setMessage(''); morph(() => setEditing(person), 'open'); };
  const close = () => morph(() => setEditing(null), 'back');
  function saved(person, text) {
    close(); setMessage(text);
    if (person) setData(old => ({ ...old, employees: [...old.employees.filter(p => p.id !== person.id), person] }));
    retry(v => v + 1);
  }
  const set = (key, value) => setFilter(old => ({ ...old, [key]: value }));
  const choice = (key, name, items) => <SmoothSelect stagger required={false} ariaLabel={name} placeholder="All" items={[{ value: '', label: 'All' }, ...items]} value={filter[key]} onChange={value => set(key, value)}/>;
  return <div className="staff-page">
    <div className="page-intro"><div><h1>Employees</h1><p>Production staff. Changes save to Smart Attendance at once.</p></div><div className="script-actions"><button className="btn secondary" disabled={busy} onClick={() => retry(v => v + 1)}><RefreshCw size={17}/>{busy ? 'Loading…' : 'Refresh'}</button>{data?.groups.length > 0 && <button className="btn primary" onClick={() => open('new')}><Plus size={17}/>Add person</button>}</div></div>
    {error && <p className="form-error" role="alert">{error}{data && ' The list below may be out of date.'}</p>}
    {message && <p className="hint" role="status">{message}</p>}
    {editing && data && <StaffForm key={editing === 'new' ? 'new' : editing.id} person={editing === 'new' ? null : editing} data={data} close={close} saved={saved}/>}
    {!data && !error && <PageSkeleton variant="table" label="Loading employees"/>}
    {data && <>
      <div className="panel staff-filters">
        <label className="field"><span>Search</span><input type="search" value={filter.text} onChange={e => set('text', e.target.value)} placeholder="Name or staff number"/></label>
        {data.groups.length > 1 && <label className="field"><span>Plant</span>{choice('groupId', 'Plant', data.groups.map(group => ({ value: group.id, label: group.label })))}</label>}
        <label className="field"><span>Line</span>{choice('line', 'Line', lines.map(line => ({ value: line, label: line })))}</label>
        <label className="field"><span>Role</span>{choice('role', 'Role', [...data.roles.map(role => ({ value: role, label: roleLabel[role] || role })), { value: 'none', label: 'No role yet' }])}</label>
        <label className="field"><span>Status</span><SmoothSelect stagger ariaLabel="Status" items={[{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }, { value: 'all', label: 'All' }]} value={filter.status} onChange={value => set('status', value)}/></label>
      </div>
      <p className="hint">{shown.length} of {data.employees.length} people</p>
      <div className="staff-list">{shown.map(p => <article key={p.id} className={`panel staff-card${p.active ? '' : ' inactive'}`}>
        <div><strong>{p.nickname || p.name}</strong>{p.nickname && <small>{p.name}</small>}<small>{p.id}{p.position && ` · ${p.position}`}</small></div>
        <dl><div><dt>Line</dt><dd>{paperLine(p)}{p.homeLines?.length > 0 && p.homeLines.join() !== p.line ? <small className="staff-tablet-line"> · {p.homeLines.join(', ')}</small> : null}</dd></div><div><dt>Team</dt><dd>{p.team || '—'}</dd></div><div><dt>Role</dt><dd className={p.role ? '' : 'missing'}>{roleLabel[p.role] || 'Not set'}</dd></div>{p.coversLines.filter(item => item !== p.line && !(p.homeLines || []).includes(item)).length > 0 && <div><dt>Also covers</dt><dd>{p.coversLines.filter(item => item !== p.line && !(p.homeLines || []).includes(item)).join(', ')}</dd></div>}{data.groups.length > 1 && <div><dt>Plant</dt><dd>{label(p.groupId)}</dd></div>}</dl>
        <div className="staff-card-side">{p.active ? <span className={`badge ${p.status === 'IN' ? 'success' : 'neutral'}`}><i/>{p.status === 'IN' ? 'Clocked in' : 'Out'}</span> : <span className="badge amber"><i/>Inactive</span>}<button className="btn secondary" onClick={() => open(p)}><Pencil size={16}/>Edit</button></div>
      </article>)}{!shown.length && <p className="hint">No one matches these filters.</p>}</div>
    </>}
  </div>;
}
