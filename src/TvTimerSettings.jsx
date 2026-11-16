import './tv-notice.css';
import { useEffect, useState } from 'react';
import { Clock3 } from 'lucide-react';
import { api } from './api.js';
import { tvPanels, TV_MIN_SECONDS, TV_MAX_SECONDS } from '../shared/tvTimers.js';

// Developer-only: how long each TV Board panel stays up on this line's TVs. Saved on the server, so every TV
// showing this line switches to the new times straight away. 0 turns a panel off.
export default function TvTimerSettings({ line, timers, live }) {
  const fromState = () => Object.fromEntries(tvPanels.map(panel => [panel.id, String(timers?.[panel.id] ?? panel.seconds)]));
  const [draft, setDraft] = useState(fromState);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const saved = JSON.stringify(fromState());
  useEffect(() => { setDraft(fromState()); }, [saved, line]);
  const changed = JSON.stringify(draft) !== saved;
  async function save(event) {
    event.preventDefault(); setBusy(true); setMessage(null);
    try { await api('/tv-timers', { timers: Object.fromEntries(Object.entries(draft).map(([id, value]) => [id, Number(value)])) }, 'PUT'); setMessage({ ok: true, text: 'Saved. TVs on this line use the new times now.' }); }
    catch (error) { setMessage({ ok: false, text: error.message }); }
    finally { setBusy(false); }
  }
  return <form className="panel tv-timer-settings" onSubmit={save}>
    <div className="tv-timer-head"><Clock3 size={20}/><div><strong>TV timers · {line}</strong><p>Seconds each panel stays on the TV. 0 turns it off. Developer only.</p></div></div>
    <div className="tv-timer-fields">{tvPanels.map(panel => <label key={panel.id} className="field"><span>{panel.label}{panel.liveOnly && !live ? ' (live lines only)' : ''}</span><input type="number" inputMode="numeric" min={0} max={TV_MAX_SECONDS} step={1} value={draft[panel.id]} onChange={event => setDraft(value => ({ ...value, [panel.id]: event.target.value }))} required/></label>)}</div>
    <div className="tv-timer-foot"><span>{message ? <b className={message.ok ? 'ok' : 'error'}>{message.text}</b> : timers?.updatedBy ? `Last changed by ${timers.updatedBy}` : `Default times. Allowed: ${TV_MIN_SECONDS}–${TV_MAX_SECONDS} s.`}</span>
      <button type="button" className="btn secondary" disabled={busy || !changed} onClick={() => { setDraft(fromState()); setMessage(null); }}>Reset</button>
      <button className="btn primary" disabled={busy || !changed}>{busy ? 'Saving…' : 'Save'}</button></div>
  </form>;
}
