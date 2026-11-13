import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, ChevronDown } from 'lucide-react';
import { SlideGroup, Swap, morph } from './ui.jsx';

const time = value => new Date(value).toLocaleTimeString('en-GB', { timeZone: 'Asia/Kuala_Lumpur', hour: '2-digit', minute: '2-digit' });
// The card turns into its own form: choose NG or OK, describe it, save. No dialog.
function CardEditor({ id, category, item, start, openCount, action, close }) {
  const [status, setStatus] = useState(start || (item.status === 'NG' ? 'OK' : 'NG'));
  const [issue, setIssue] = useState(''), [fix, setFix] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const form = useRef(null);
  useEffect(() => { form.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); form.current?.querySelector('textarea')?.focus({ preventScroll: true }); }, []);
  async function save(event) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError('');
    try { await action('henkaten', { category: id, status, issue, action: fix }, true); close(); }
    catch (failure) { setError(failure.message); setBusy(false); }
  }
  return <form ref={form} className={`henkaten-card henkaten-editor status-${item.status.toLowerCase()}`} style={{ viewTransitionName: `board-${id}` }} onSubmit={save} data-update-blocked="true" onKeyDown={event => { if (event.key === 'Escape' && !busy) close(); }}>
    <span className="board-category"><category.icon size={34}/><span className="board-category-name">{category.name}</span></span>
    <SlideGroup className="editor-status" role="group" aria-label={`${category.name} status`} selector="[aria-pressed=true]" data-value={status}>
      <button type="button" aria-pressed={status === 'NG'} onClick={() => setStatus('NG')}><AlertTriangle size={20}/>NG</button>
      <button type="button" aria-pressed={status === 'OK'} onClick={() => setStatus('OK')}><Check size={20}/>OK</button>
    </SlideGroup>
    {status === 'NG' && <label className="field"><span>What is the problem?</span><textarea required maxLength={500} value={issue} onChange={event => setIssue(event.target.value)}/></label>}
    <label className="field"><span>{status === 'NG' ? 'Action taken' : 'How was it fixed?'}</span><textarea required maxLength={500} value={fix} onChange={event => setFix(event.target.value)}/></label>
    {status === 'OK' && openCount > 0 && <p className="editor-note">Saving OK closes {openCount === 1 ? 'the open problem' : `all ${openCount} open problems`} here.</p>}
    {error && <div className="form-error" role="alert">{error}</div>}
    <div className="editor-actions"><button type="button" className="btn secondary" disabled={busy} onClick={close}>Cancel</button><button className="btn primary" disabled={busy}><Swap id={busy ? 'busy' : status}>{busy ? 'Saving…' : `Save ${status}`}</Swap></button></div>
  </form>;
}
export default function HenkatenBoard({ state, action, writable, tv, categories }) {
  const [filter, setFilter] = useState('pending');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const edit = next => morph(() => setEditing(next));
  const pending = state.issues.filter(issue => issue.status === 'pending').length;
  const history = state.issues.filter(issue => filter === 'all' || issue.status === filter);
  return <div className="simple-board"><div className="board-heading"><h1>4M Board · {state.line}</h1><span className={`badge ${pending ? 'danger' : 'success'}`}>{pending} open {pending === 1 ? 'problem' : 'problems'}</span></div><div className="henkaten-grid">{Object.entries(categories).map(([key, category], index) => {
    const item = state.henkaten[key];
    if (!tv && writable && editing?.key === key) return <CardEditor key={key} id={key} category={category} item={item} start={editing.status} openCount={state.issues.filter(issue => issue.category === key && issue.status === 'pending').length} action={action} close={() => edit(null)}/>;
    const Card = tv ? 'article' : 'button';
    return <Card type={tv ? undefined : 'button'} disabled={tv ? undefined : !writable} onClick={tv ? undefined : () => edit({ key })} aria-label={tv ? undefined : `${category.name}: ${item.status}. Tap to update`} className={`henkaten-card status-${item.status.toLowerCase()}`} key={key} style={{ '--card-order': index, viewTransitionName: `board-${key}` }}><span className="board-category"><category.icon size={64}/><span className="board-category-name">{category.name}</span></span><div key={item.status} className="henkaten-status">{item.status === 'WAITING' ? 'WAIT' : item.status}</div><p className="board-problem">{item.status === 'NG' ? item.issue : item.status === 'WAITING' ? 'Not checked yet' : ''}</p>{!tv && <span className="board-tap">{writable ? "TAP TO UPDATE" : "VIEW ONLY"}</span>}</Card>;
  })}</div><section className="panel board-history"><button className="board-history-toggle" aria-expanded={historyOpen} aria-controls="board-history-content" onClick={() => setHistoryOpen(value => !value)}>Problem history ({state.issues.length})<ChevronDown size={19}/></button><div id="board-history-content" className="board-history-content" data-open={historyOpen} inert={!historyOpen}><div><SlideGroup className="board-filter" selector=".btn.primary">{[{ value: 'pending', label: 'Open' }, { value: 'resolved', label: 'Fixed' }, { value: 'all', label: 'All' }].map(option => <button key={option.value} className={`btn ${filter === option.value ? 'primary' : 'secondary'}`} onClick={() => setFilter(option.value)}>{option.label}</button>)}</SlideGroup>{history.map(issue => <article className="board-history-row" key={issue.id}><div><span>{categories[issue.category]?.name} · {time(issue.createdAt)}</span><h3>{issue.issue}</h3><p>Action: {issue.action || 'No action entered'}</p><small>{issue.actor}{issue.resolvedBy && ` · Fixed by ${issue.resolvedBy}`}</small></div><span className={`badge ${issue.status === 'pending' ? 'danger' : 'success'}`}>{issue.status === 'pending' ? 'OPEN' : 'FIXED'}</span>{!tv && issue.status === 'pending' && <button className="btn secondary" disabled={!writable} onClick={() => edit({ key: issue.category, status: 'OK' })}>Mark fixed</button>}</article>)}{!history.length && <p className="entry-instruction">No {filter === 'pending' ? 'open' : filter === 'resolved' ? 'fixed' : ''} problems.</p>}</div></div></section></div>;
}
