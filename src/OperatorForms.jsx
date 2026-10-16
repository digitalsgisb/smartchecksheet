import { useCallback, useState } from 'react';
import DurationWheel from './DurationWheel.jsx';
import { Play, Square, Clock3, AlertTriangle, Check, Users, Wrench, Package, GitBranch } from 'lucide-react';

export const rejectTypes = [
  { key: 'slab', label: 'Slab reject', stage: 'Before forming', unit: 'metres', step: 'any' },
  { key: 'returnRoll', label: 'Return roll', stage: 'Before forming', unit: 'metres', step: 'any' },
  { key: 'ng', label: 'NG reject', stage: 'After forming', unit: 'pieces', step: 1 },
  { key: 'loft', label: 'Loft reject', stage: 'After forming', unit: 'pieces', step: 1 }
];
export function RejectFields({ form, set, setForm, selected, choose }) {
  const type = rejectTypes.find(item => item.key === selected);
  function select(key) {
    if (key === selected) return;
    setForm(current => ({ ...current, slab: 0, returnRoll: 0, ng: 0, loft: 0, slabCode: '', ngCode: '', loftCode: '', oht: '' }));
    choose(key);
  }
  return <div className="simple-entry reject-entry"><h3>1. Select reject type</h3>{['Before forming', 'After forming'].map(stage => <section key={stage}><div className="entry-group-label">{stage} · {stage === 'Before forming' ? 'metres' : 'pieces'}</div><div className="choice-grid">{rejectTypes.filter(item => item.stage === stage).map(item => <button key={item.key} type="button" className={`choice-button reject-choice ${selected === item.key ? 'selected' : ''}`} aria-pressed={selected === item.key} onClick={() => select(item.key)}><AlertTriangle size={22}/>{item.label}{selected === item.key && <Check size={22}/>}</button>)}</div></section>)}
    {type && <section className="entry-step"><h3>2. Enter {type.unit}</h3><label className="field quantity-field"><span>{type.label} ({type.unit})</span><input type="number" inputMode={type.step === 1 ? 'numeric' : 'decimal'} min={type.step === 1 ? 1 : 0.01} step={type.step} required value={form[type.key] || ''} placeholder="Enter quantity" onChange={event => set(type.key, event.target.value === '' ? '' : Number(event.target.value))}/></label>{selected === 'returnRoll' && <label className="field"><span>OHT number</span><input required maxLength={80} value={form.oht} onChange={event => set('oht', event.target.value)}/></label>}<h3>3. Enter reason or reject code</h3><label className="field"><span>Reason / code</span><input required maxLength={120} placeholder="Enter reason or code" value={form.code} onChange={event => set('code', event.target.value)}/></label><details className="entry-optional"><summary>Add note (optional)</summary><label className="field"><span>Note</span><textarea maxLength={500} value={form.remarks} onChange={event => set('remarks', event.target.value)}/></label></details><div className="entry-summary">Saving: <strong>{form[type.key] || 0} {type.unit}</strong> · {type.label}</div></section>}
    {!type && <p className="entry-instruction">Select one of the four buttons above.</p>}
  </div>;
}

export function DowntimeFields({ form, set, state, method, setMethod, seconds, busy, submit, fullPage = false, reasonRef, startAttempted = false }) {
  const [discard, setDiscard] = useState(false);
  const status = state.timer.status;
  const manual = status === 'idle' && method === 'manual';
  const setDuration = useCallback(value => set('duration', value), [set]);
  return <div className="simple-entry downtime-entry">
    {status === 'idle' && <><div className="choice-grid method-choice"><button type="button" className={`choice-button ${!manual ? 'selected' : ''}`} aria-pressed={!manual} onClick={() => { setMethod('timer'); set('duration', 0); }}>Use timer</button><button type="button" className={`choice-button ${manual ? 'selected' : ''}`} aria-pressed={manual} onClick={() => { setMethod('manual'); if (!form.duration) set('duration', 1); }}>Enter minutes</button></div><h3>1. Select category</h3><div className="category-choice">{['Machine', 'Quality', 'Production', 'Schedule', 'Planned Stop'].map(category => <button type="button" key={category} data-category={category} className={`choice-button ${form.category === category ? 'selected' : ''}`} aria-pressed={form.category === category} onClick={() => set('category', category)}>{category}{form.category === category && <Check className="category-selected-icon" size={23} aria-hidden="true"/>}</button>)}</div><label className="field"><span>2. Why did the machine stop?</span><input ref={reasonRef} aria-invalid={startAttempted && !form.reason?.trim()} aria-describedby="downtime-reason-help" required maxLength={500} placeholder="Enter reason (required)" value={form.reason} onChange={event => set('reason', event.target.value)}/><span id="downtime-reason-help" className="reason-required-help">{manual ? "Reason is required to save downtime." : "Reason is required to start the timer."}</span></label>{manual ? <DurationWheel minutes={form.duration} onChange={setDuration}/> : <details className="entry-optional"><summary>Set countdown (optional)</summary><label className="field"><span>Minutes (0 = count up)</span><input type="number" min={0} max={1440} step={1} value={form.targetMinutes} onChange={event => set('targetMinutes', Number(event.target.value))}/></label></details>}</>}
    {!manual && <div className={`clear-timer timer-${status}`}><span>{status === 'running' ? 'TIMER RUNNING' : status === 'stopped' ? 'TIMER STOPPED' : 'TIMER READY'}</span><strong>{String(Math.floor(seconds / 60)).padStart(2, '0')}<small>:</small>{String(Math.floor(seconds % 60)).padStart(2, '0')}</strong><p>{status === 'running' ? 'Press STOP TIMER when the machine runs again.' : status === 'stopped' ? 'Enter action taken. Then press SAVE DOWNTIME.' : 'Select a category and enter a reason. Then press START TIMER.'}</p>{status === 'running' && <span className="timer-close-note">{fullPage ? 'You can leave this page. The timer keeps running.' : 'Closing this window keeps the timer running.'}</span>}</div>}
    {status !== 'idle' && <div className="entry-summary"><strong>{state.timer.category}</strong> · {state.timer.reason}</div>}
    {(status === 'stopped' || manual) && <label className="field"><span>{manual ? '4.' : '3.'} What did you do to fix it?</span><input required maxLength={500} placeholder="Enter action taken" value={form.actionTaken} onChange={event => set('actionTaken', event.target.value)}/></label>}
    {(status === 'stopped' || manual) && <details className="entry-optional"><summary>Add note (optional)</summary><label className="field"><span>Note</span><textarea maxLength={500} value={form.remarks} onChange={event => set('remarks', event.target.value)}/></label></details>}
    {status !== 'idle' && <div className="discard-control">{discard ? <><p>Discard this timer without saving?</p><div className="choice-grid"><button className="btn secondary" type="button" onClick={() => setDiscard(false)}>Keep timer</button><button className="btn danger-action" type="button" disabled={busy} onClick={() => submit(null, 'cancel')}>Discard timer</button></div></> : <button className="text-btn" type="button" disabled={busy} onClick={() => setDiscard(true)}>Discard timer…</button>}</div>}
  </div>;
}

const fourM = [{ key: 'man', label: 'Man', icon: Users }, { key: 'machine', label: 'Machine', icon: Wrench }, { key: 'material', label: 'Material', icon: Package }, { key: 'method', label: 'Method', icon: GitBranch }];
export function FourMFields({ form, set, state }) {
  const count = state.issues.filter(issue => issue.category === form.category && issue.status === 'pending').length;
  return <div className="simple-entry"><h3>1. Select category</h3><div className="choice-grid">{fourM.map(({ key, label, icon: Icon }) => <button type="button" key={key} className={`choice-button ${form.category === key ? 'selected' : ''}`} aria-pressed={form.category === key} onClick={() => set('category', key)}><Icon size={24}/>{label}</button>)}</div><h3>2. Select status</h3><div className="choice-grid"><button type="button" className={`choice-button status-choice ng-choice ${form.status === 'NG' ? 'selected' : ''}`} aria-pressed={form.status === 'NG'} onClick={() => set('status', 'NG')}><AlertTriangle/>NG · Problem</button><button type="button" className={`choice-button status-choice ok-choice ${form.status === 'OK' ? 'selected' : ''}`} aria-pressed={form.status === 'OK'} onClick={() => set('status', 'OK')}><Check/>OK · Fixed</button></div>{form.status === 'NG' && <label className="field"><span>3. What is the problem?</span><textarea required maxLength={500} value={form.issue} onChange={event => set('issue', event.target.value)}/></label>}<label className="field"><span>{form.status === 'NG' ? '4. Action taken' : '3. How was it fixed?'}</span><textarea required maxLength={500} value={form.action} onChange={event => set('action', event.target.value)}/></label>{form.status === 'OK' && count > 0 && <div className="entry-summary">Saving OK will close <strong>all {count} open {count === 1 ? 'problem' : 'problems'}</strong> in this category.</div>}</div>;
}

export function DowntimeSaveButton({ state, method, busy, submit }) {
  const status = state.timer.status;
  if (status === 'running') return <button type="button" className="btn danger-action" disabled={busy || !state.connected} onClick={() => submit(null, 'stop')}><Square size={22}/>STOP TIMER</button>;
  if (status === 'idle' && method !== 'manual') return <button type="button" className="btn start-action" disabled={busy || !state.connected} onClick={() => submit(null, 'start')}><Play size={22}/>START TIMER</button>;
  return <button className="btn save-action" disabled={busy || !state.connected}><Check size={22}/>{busy ? 'SAVING…' : 'SAVE DOWNTIME'}</button>;
}
