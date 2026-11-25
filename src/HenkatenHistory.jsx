import { useEffect, useState } from 'react';
import { Ban, Pencil, RefreshCw } from 'lucide-react';
import { api } from './api.js';
import { PageSkeleton } from './ui.jsx';
import './production-log.css';

// Henkaten history: every 4M entry by shift, newest first. Executives and managers correct a wrong entry or void it with a reason;
// the old text is kept and shown under "Changes".
const day = offset => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(new Date(Date.now() - offset * 86400000));
const when = iso => new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Kuala_Lumpur', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const names = { man: 'Man', machine: 'Machine', material: 'Material', method: 'Method' };
const statusBadge = { pending: ['danger', 'OPEN'], resolved: ['success', 'FIXED'], void: ['', 'VOID'] };
const describe = (b, a) => [b.category !== a.category && `Category ${names[b.category] || b.category} → ${names[a.category] || a.category}`, b.issue !== a.issue && `Problem was “${b.issue}”`, b.action !== a.action && `Action was “${b.action || '—'}”`, a.status === 'void' && b.status !== 'void' && `Voided: ${a.voidReason}`].filter(Boolean).join(' · ');

function Entry({ entry, onSaved }) {
  const [mode, setMode] = useState(null), [form, setForm] = useState(entry), [reason, setReason] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function save(event) {
    event.preventDefault(); if (busy) return; setBusy(true); setError('');
    try { const next = mode === 'void' ? await api(`/henkaten-history/${encodeURIComponent(entry.id)}/void`, { reason }) : await api(`/henkaten-history/${encodeURIComponent(entry.id)}`, { category: form.category, issue: form.issue, action: form.action }, 'PATCH'); setMode(null); onSaved(next); }
    catch (failure) { setError(failure.message); } finally { setBusy(false); }
  }
  const [tone, label] = statusBadge[entry.status] || ['', entry.status];
  return <article className={`henkaten-entry ${entry.status === 'void' ? 'void' : ''}`}>
    <div><div className="meta"><strong>{names[entry.category] || entry.category}</strong><span>{when(entry.createdAt)}</span><span>{entry.actor}</span><span className={`badge ${tone}`}>{label}</span>{entry.editedAt && <span>Edited by {entry.editedBy}, {when(entry.editedAt)}</span>}</div>
      <h3>{entry.issue}</h3><p className="action">Action: {entry.action || 'No action entered'}</p>{entry.resolvedBy && <small className="meta">Fixed by {entry.resolvedBy}{entry.resolvedAt ? `, ${when(entry.resolvedAt)}` : ''}</small>}{entry.status === 'void' && <p>Void: {entry.voidReason}</p>}</div>
    {!mode && entry.status !== 'void' && <div className="buttons"><button className="btn secondary" onClick={() => { setForm(entry); setMode('edit'); }}><Pencil size={16}/>Edit</button><button className="btn secondary" onClick={() => { setReason(''); setMode('void'); }}><Ban size={16}/>Void</button></div>}
    {mode && <form onSubmit={save} data-update-blocked="true" onKeyDown={event => { if (event.key === 'Escape' && !busy) setMode(null); }}>
      {mode === 'edit' ? <><div className="field"><span>Category</span><div className="row" role="group" aria-label="Category">{Object.entries(names).map(([key, name]) => <button key={key} type="button" className={`btn ${form.category === key ? 'primary' : 'secondary'}`} aria-pressed={form.category === key} onClick={() => setForm({ ...form, category: key })}>{name}</button>)}</div></div>
        <label className="field"><span>Problem</span><textarea required maxLength={500} value={form.issue} onChange={e => setForm({ ...form, issue: e.target.value })}/></label>
        <label className="field"><span>Action</span><textarea maxLength={500} value={form.action} onChange={e => setForm({ ...form, action: e.target.value })}/></label></>
        : <label className="field"><span>Why is this entry wrong?</span><textarea required maxLength={200} value={reason} onChange={e => setReason(e.target.value)} placeholder="For example: keyed on the wrong line"/></label>}
      {error && <div className="form-error" role="alert">{error}</div>}
      <div className="row"><button type="button" className="btn secondary" disabled={busy} onClick={() => setMode(null)}>Cancel</button><button className="btn primary" disabled={busy}>{busy ? 'Saving…' : mode === 'void' ? 'Void entry' : 'Save changes'}</button></div>
    </form>}
    {entry.edits?.length > 0 && <details><summary>Changes ({entry.edits.length})</summary><ul>{entry.edits.map(e => <li key={e.at}>{when(e.at)} · {e.actor}: {describe(e.before, e.after) || 'No change'}</li>)}</ul></details>}
  </article>;
}

export default function HenkatenHistory({ line }) {
  const [from, setFrom] = useState(() => day(6)), [to, setTo] = useState(() => day(0)), [data, setData] = useState(null), [error, setError] = useState(''), [attempt, retry] = useState(0), [show, setShow] = useState('all');
  useEffect(() => { let off = false; setData(null); setError(''); api(`/henkaten-history?from=${from}&to=${to}`).then(next => !off && setData(next)).catch(e => !off && setError(e.message)); return () => { off = true; }; }, [line, from, to, attempt]);
  // The saved entry comes back with its new text; reload to get the change trail as well.
  const saved = () => retry(v => v + 1);
  const entries = (data?.entries || []).filter(e => show === 'all' || (show === 'edited' ? e.editedAt : e.status === show));
  const shifts = []; for (const e of entries) { const key = e.shiftId || 'No shift'; let group = shifts.find(s => s.key === key); if (!group) shifts.push(group = { key, entries: [] }); group.entries.push(e); }
  return <div className="henkaten-history"><div className="page-intro"><div><h1>Henkaten history</h1><p>Every 4M entry on {line}. Edit a wrong entry or void it. The old text is kept.</p></div><button className="btn secondary" onClick={() => retry(v => v + 1)}><RefreshCw size={17}/>Refresh</button></div>
    <div className="panel shift-history-filters"><label className="field"><span>From</span><input type="date" value={from} max={to} onChange={e => e.target.value && setFrom(e.target.value)}/></label><label className="field"><span>To</span><input type="date" value={to} min={from} max={day(0)} onChange={e => e.target.value && setTo(e.target.value)}/></label>
      <label className="field"><span>Show</span><select value={show} onChange={e => setShow(e.target.value)}><option value="all">All entries</option><option value="pending">Open</option><option value="resolved">Fixed</option><option value="edited">Edited</option><option value="void">Void</option></select></label></div>
    {error && <div className="notice" role="alert">{error}</div>}
    {!data && !error && <PageSkeleton variant="list" label="Loading Henkaten history"/>}
    {data && !entries.length && <p className="hint shift-history-empty">No Henkaten entries for {line} in these dates.</p>}
    {shifts.map(group => <section className="panel henkaten-history-shift" key={group.key}><header><h2>{group.key}</h2><span className="meta">{group.entries.length} {group.entries.length === 1 ? 'entry' : 'entries'}</span></header>{group.entries.map(e => <Entry key={e.id + (e.editedAt || '')} entry={e} onSaved={saved}/>)}</section>)}
  </div>;
}
