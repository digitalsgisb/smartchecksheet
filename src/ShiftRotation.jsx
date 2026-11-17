import { useEffect, useRef, useState } from 'react';
import { ArrowLeftRight, Check, Loader2, Moon, Sun } from 'lucide-react';
import { api } from './api.js';
import { shiftWorkingHours } from './shiftOvertime.js';

const displayTime = value => new Date(value).toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

// Which team works Day (the other works Night) and planned OT, for one division and site.
// A plan only: operators still choose shift and OT, and see a small warning when they differ.
// Changes show at once; the server's reply is used straight away (no wait for the 15 s refresh); a failed save puts the old plan back.
export default function ShiftRotation({ groupId, rotation, canEdit }) {
  const [draft, setDraft] = useState(null), [error, setError] = useState(''), [confirmed, setConfirmed] = useState(null);
  // Whichever copy is newer: the page's last load or this card's last confirmed save.
  const latestCopy = confirmed && (!rotation || Date.parse(confirmed.updatedAt) >= Date.parse(rotation.updatedAt)) ? confirmed : rotation;
  const saved = latestCopy || { dayTeam: 'A', dayOt: null, nightOt: null };
  const [flash, setFlash] = useState(0), [swaps, setSwaps] = useState(0);
  const queue = useRef(Promise.resolve()), latest = useRef(0);
  // "Saved" shows for 2.5 s after the last save is confirmed.
  useEffect(() => { if (!flash) return; const timer = setTimeout(() => setFlash(0), 2500); return () => clearTimeout(timer); }, [flash]);
  // Drop the local change once the server's copy matches it.
  useEffect(() => { setDraft(old => old && !old.pending && old.dayTeam === saved.dayTeam && old.dayOt === saved.dayOt && old.nightOt === saved.nightOt ? null : old); }, [saved.dayTeam, saved.dayOt, saved.nightOt]);
  const plan = draft || saved, nightTeam = plan.dayTeam === 'A' ? 'B' : 'A';

  function save(change) {
    const next = { dayTeam: plan.dayTeam, dayOt: plan.dayOt, nightOt: plan.nightOt, ...change }, mine = ++latest.current;
    setDraft({ ...next, pending: true }); setError(''); setFlash(0);
    queue.current = queue.current.then(() => api('/executive/rotation', { groupId, ...next }, 'PUT')).then(
      result => { if (result?.rotation) setConfirmed(result.rotation); if (latest.current === mine) { setDraft({ ...next, pending: false }); setFlash(Date.now()); } },
      e => { if (latest.current === mine) { setDraft(null); setError(`Not saved. ${e.message}`); } });
  }

  const shift = (name, team, otKey, Icon) => <article className={`rotation-shift rotation-${name.toLowerCase()}`}>
    <span className="rotation-label"><Icon size={18} aria-hidden="true"/>{name} shift</span>
    <strong className="rotation-team" key={team}>Team {team}</strong>
    <div className="rotation-ot" role="group" aria-label={`${name} shift overtime`}>{[[false, 'NO OT'], [true, 'WITH OT']].map(([value, label]) => canEdit
      ? <button key={label} type="button" aria-pressed={plan[otKey] === value} onClick={() => save({ [otKey]: plan[otKey] === value ? null : value })}>{label}</button>
      : plan[otKey] === value && <span key={label} className="rotation-ot-value">{label}</span>)}
      {!canEdit && plan[otKey] === null && <span className="rotation-ot-value muted">OT not planned</span>}</div>
    <small key={String(plan[otKey])} className="rotation-hours">{typeof plan[otKey] === 'boolean' ? shiftWorkingHours(name, plan[otKey]) : 'OT not planned'}</small>
  </article>;

  return <section className="panel shift-rotation" data-update-blocked={!!draft?.pending}>
    <div className="shift-rotation-head"><div><h2>Shift rotation</h2><p>Plan for this division. Operators still choose on the checksheet and see a small warning if it differs.</p></div>
      <div className="shift-rotation-actions">{draft?.pending ? <span className="rotation-status saving" role="status"><Loader2 size={16} aria-hidden="true"/>Saving…</span> : flash ? <span className="rotation-status saved" role="status" key={flash}><Check size={16} aria-hidden="true"/>Saved</span> : null}
      {canEdit && <button type="button" className="btn secondary rotation-swap" onClick={() => { setSwaps(n => n + 1); save({ dayTeam: nightTeam }); }}><ArrowLeftRight size={18} key={swaps} className={swaps ? 'spin' : ''}/>Swap A / B</button>}</div></div>
    <div className="shift-rotation-grid">{shift('Day', plan.dayTeam, 'dayOt', Sun)}{shift('Night', nightTeam, 'nightOt', Moon)}</div>
    {error && <div className="connection-banner" role="alert">{error}</div>}
    <small className="executive-label">{latestCopy ? `Last changed by ${latestCopy.updatedBy} · ${displayTime(latestCopy.updatedAt)}` : 'Not set yet. Showing Team A on Day until an executive saves a plan.'}</small>
  </section>;
}
