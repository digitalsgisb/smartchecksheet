import { useEffect, useState } from 'react';
import { ArrowRightLeft, Check, RefreshCw, Undo2, Users } from 'lucide-react';
import { api } from './api.js';
import { peopleRoles } from '../shared/lineLists.js';

// Start-shift names for one line, built from Employees. Before a line switches over, its old names are matched to Employees
// and the exec confirms; nothing changes until then.
const roleLabel = { SUPERVISOR: 'Supervisor', LEADER: 'Leader', OPERATOR: 'Operator' };
// Operators fill the forming, waterjet and assembly lists alike, so they are shown once.
const shownLists = { supervisors: 'Supervisors', leaders: 'Leaders', forming: 'Operators', quality: 'Quality' };
const listName = key => ['forming', 'waterjet', 'assembly'].includes(key) ? 'Operators' : peopleRoles[key];
const when = value => new Date(value).toLocaleString('en-GB', { timeZone: 'Asia/Kuala_Lumpur', dateStyle: 'medium', timeStyle: 'short' });
const what = (row, line) => row.patch.line ? `${roleLabel[row.role]}, home line ${row.homeLines?.join('/') || row.line || '—'} → ${line}` : `${roleLabel[row.role]}${row.currentRole && row.currentRole !== row.role ? ` (was ${roleLabel[row.currentRole]})` : ''}${row.patch.coversLines ? ' · covers this line' : ''}`;
const groups = [
  ['missing', 'Not in Employees', 'Add them in Employees, or they leave this line\'s lists.'],
  ['ambiguous', 'More than one person with this name', 'Give each a different short name in Employees.'],
  ['inactive', 'Deactivated in Employees', 'Reactivate them in Employees if they still work here.'],
  ['conflict', 'Listed under two roles', 'Each person has one role; the first one is used.']
];

export default function LineStaff({ line }) {
  const [data, setData] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(''), [message, setMessage] = useState(''), [attempt, retry] = useState(0), [ticked, setTicked] = useState({}), [quality, setQuality] = useState({});
  useEffect(() => {
    let disposed = false; setError(''); setData(null);
    api(`/staff/lines/${encodeURIComponent(line)}`).then(next => { if (disposed) return; setData(next); setTicked(Object.fromEntries((next.rows || []).filter(row => row.status === 'change' && row.apply).map(row => [row.id, true]))); setQuality(Object.fromEntries((next.qualityToAdd || []).map(name => [name, true]))); }, e => { if (!disposed) setError(e.message); });
    return () => { disposed = true; };
  }, [line, attempt]);
  async function switchOver() {
    const changes = data.rows.filter(row => row.status === 'change' && ticked[row.id]).map(row => ({ id: row.id, ...row.patch })), addQuality = (data.qualityToAdd || []).filter(name => quality[name]);
    if (!window.confirm(`${empty.length ? `${empty.map(key => shownLists[key]).join(', ')} will be empty. ` : ''}Use Employees for ${line}'s names${changes.length ? ` and save ${changes.length} change${changes.length === 1 ? '' : 's'} in Employees` : ''}?`)) return;
    setBusy('switch'); setError('');
    try { const result = await api(`/staff/lines/${encodeURIComponent(line)}/switch`, { changes, addQuality }); setData(result); setMessage(`${line} now uses Employees.${result.saved ? ` ${result.saved} saved.` : ''}`); }
    catch (e) { setError(e.message); retry(v => v + 1); } finally { setBusy(''); }
  }
  async function switchBack() {
    if (!window.confirm(`Go back to ${line}'s old names list? Employees stay as they are.`)) return;
    setBusy('back'); setError('');
    try { await api(`/staff/lines/${encodeURIComponent(line)}/switch`, {}, 'DELETE'); setMessage('Back on the old list.'); retry(v => v + 1); }
    catch (e) { setError(e.message); } finally { setBusy(''); }
  }
  const rows = status => data.rows.filter(row => row.status === status);
  // Lists still empty after the ticked changes: that line could not start a shift until someone is given the role.
  const listFor = { SUPERVISOR: 'supervisors', LEADER: 'leaders', OPERATOR: 'forming' };
  const empty = data && !data.switched ? Object.keys(shownLists).filter(key => !data.lists[key].length && !data.rows.some(row => row.status === 'change' && ticked[row.id] && listFor[row.role] === key) && !(key === 'quality' && (data.qualityToAdd || []).some(name => quality[name]))) : [];
  return <section className="panel list-editor line-staff" data-update-blocked={data && !data.switched ? 'true' : undefined}>
    <header><div className="list-title"><Users size={22}/><h2>Names</h2></div>{data?.switched ? <span className="list-source saved"><Check size={14}/>From Employees · {data.switched.switchedBy} · {when(data.switched.switchedAt)}</span> : data && <span className="list-source google">Old list in use</span>}</header>
    {error && <div className="notice" role="alert">{error}<button className="text-btn" onClick={() => retry(v => v + 1)}><RefreshCw size={16}/>Retry</button></div>}
    {message && <p className="hint" role="status">{message}</p>}
    {!data && !error && <p className="hint">Loading names…</p>}
    {data?.switched && <>
      <div className="people-grid">{Object.entries(shownLists).map(([key, label]) => <div key={key}><h3>{label} <small>{data.lists[key].length}</small></h3><ul>{data.lists[key].map(name => <li key={name}>{name}</li>)}{!data.lists[key].length && <li className="hint">No one yet</li>}</ul></div>)}</div>
      <p className="hint">Add, edit or move people, and edit QC names, in Employees. Tablets update within a minute.</p>
      <div className="list-actions"><a className="btn primary" href="#staff"><Users size={17}/>Open Employees</a><button className="btn secondary" disabled={!!busy} onClick={switchBack}><Undo2 size={17}/>{busy === 'back' ? 'Switching…' : 'Use old list again'}</button></div>
    </>}
    {data && !data.switched && <>
      <p>Before {line} uses Employees, check how its {data.oldSource === 'google' ? 'Google sheet' : data.oldSource === 'checksheet' ? 'saved' : ''} names match.{data.oldSource === 'none' && ' This line has no old list.'}</p>
      <p className="hint">{rows('ok').length} already match{rows('ok').length === 1 ? 'es' : ''}.</p>
      {rows('change').length > 0 && <div className="diff-role"><h4>Set in Employees <small>ticked ones are saved when you switch</small></h4>{rows('change').map(row => <label key={row.id} className={`chip ${ticked[row.id] ? 'added' : 'missing'}`}><input type="checkbox" checked={!!ticked[row.id]} onChange={e => setTicked(old => ({ ...old, [row.id]: e.target.checked }))}/>{row.name} · {what(row, line)}</label>)}</div>}
      {groups.map(([status, title, help]) => rows(status).length > 0 && <div className="diff-role" key={status}><h4>{title} <small>{help}</small></h4>{rows(status).map(row => <span className="chip missing" key={row.list + row.name}>{row.name} · {listName(row.list)}</span>)}</div>)}
      {data.qualityToAdd?.length > 0 && <div className="diff-role"><h4>QC <small>ticked names are added to the {data.qualityGroup} QC list</small></h4>{data.qualityToAdd.map(name => <label key={name} className={`chip ${quality[name] ? 'added' : 'missing'}`}><input type="checkbox" checked={!!quality[name]} onChange={e => setQuality(old => ({ ...old, [name]: e.target.checked }))}/>{name}</label>)}</div>}
      {data.unlisted.length > 0 && <div className="diff-role"><h4>On {line} in Employees, not in the old list <small>they appear once they have a role</small></h4>{data.unlisted.map(p => <span className={`chip ${p.role ? 'added' : 'missing'}`} key={p.id}>{p.name} · {roleLabel[p.role] || 'no role yet'}</span>)}</div>}
      {empty.length > 0 && <p className="form-error" role="alert">After switching, {empty.map(key => shownLists[key]).join(', ')} would be empty, so {line} could not start a shift. Give people these roles in Employees{empty.includes('quality') ? ', and add QC names in its QC tab' : ''} first.</p>}
      <div className="list-actions"><a className="btn secondary" href="#staff"><Users size={17}/>Open Employees</a><button className="btn primary" disabled={!!busy} onClick={switchOver}><ArrowRightLeft size={17}/>{busy === 'switch' ? 'Switching…' : `Use Employees for ${line}`}</button></div>
    </>}
  </section>;
}
