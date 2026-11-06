import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { api } from './api.js';
import SmoothSelect from './SmoothSelect.jsx';

export default function InlineSetup({ state, action, writable, active }) {
  const [model, setModel] = useState(state.setup?.model || '');
  const [lot, setLot] = useState(state.setup?.lot || '');
  const [manualPlan, setManualPlan] = useState(state.setup?.plan || '');
  const [manualCycle, setManualCycle] = useState(state.setup?.cycle || '');
  const manual = state.mode === 'manual';
  const [catalog, setCatalog] = useState(null), [modelsError, setModelsError] = useState(''), [modelWarnings, setModelWarnings] = useState([]), [attempt, retry] = useState(0);
  useEffect(() => {
    if (!manual) return;
    let disposed = false, timer;
    async function load() {
      try { const next = await api('/models'); if (!disposed) { setCatalog(next.models); setModelWarnings(next.warnings || []); setModelsError(''); } }
      catch (e) { if (!disposed) setModelsError(e.message); }
      finally { if (!disposed) timer = setTimeout(load, 60000); }
    }
    load(); return () => { disposed = true; clearTimeout(timer); };
  }, [manual, state.line, attempt]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    setModel(state.setup?.model || '');
    setLot(state.setup?.lot || '');
    setManualPlan(state.setup?.plan || '');
    setManualCycle(state.setup?.cycle || '');
    setError('');
  }, [state.line, state.setup?.model, state.setup?.lot, state.setup?.plan, state.setup?.cycle, state.shift?.id]);
  const pending = state.commands.some(command => command.kind === 'setup' && command.status === 'pending');
  const locked = !writable || !active || busy || pending;
  const dirty = model !== (state.setup?.model || '') || lot.trim() !== (state.setup?.lot || '') || manual && (Number(manualPlan) !== Number(state.setup?.plan || 0) || Number(manualCycle) !== Number(state.setup?.cycle || 0));
  const availableModels = manual ? catalog || [] : state.models;
  const chosen = availableModels.find(item => item.name === model);
  const modelLocked = manual && (!catalog || !!modelsError || !chosen);
  const missingLiveTarget = !manual && chosen && !(chosen.pcsHr > 0) && model !== state.setup?.model;
  const plan = manual || missingLiveTarget ? Number(manualPlan) : model === state.setup?.model ? state.setup.plan : chosen?.pcsHr > 0 ? Math.floor(chosen.pcsHr) : undefined;
  async function save(event) {
    event.preventDefault();
    if (locked || modelLocked || !dirty) return;
    setBusy(true); setError('');
    try { await action('setup', { model, lot: lot.trim(), plan, ...(manual ? { cycle: Number(manualCycle) } : {}) }, true); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  return <form className="panel reference-model inline-setup" onSubmit={save} data-update-blocked={dirty || busy}>
    <div className={`reference-model-fields ${manual ? 'manual-model-fields' : ''}`}>
      <label className="field"><span>Model</span><SmoothSelect items={availableModels.map(item => item.name)} value={model} disabled={locked || manual && (!catalog || !!modelsError)} placeholder={manual && !catalog ? 'Load model list' : 'Select model'} ariaLabel="Model" onChange={value => { setModel(value); setError(''); if (!manual) setManualPlan(''); if (manual) { const selected = availableModels.find(item => item.name === value); if (selected) { setManualPlan(selected.pcsHr); setManualCycle(selected.cycle); } } }}/></label>
      <label className="field"><span>Lot number</span><input required maxLength={80} value={lot} disabled={locked} placeholder="Type lot number" autoComplete="off" onChange={event => { setLot(event.target.value); setError(''); }}/></label>
      {missingLiveTarget && <label className="field"><span>Target / hour (pcs)</span><input required type="number" min="1" max="10000" step="1" value={manualPlan} disabled={locked} placeholder="Enter hourly target" onChange={event => setManualPlan(event.target.value)}/></label>}
      {manual ? <><label className="field"><span>Target / hour (pcs)</span><input required type="number" min="1" max="10000" step="1" value={manualPlan} readOnly onChange={event => setManualPlan(event.target.value)}/></label><label className="field"><span>Standard cycle (min / piece)</span><input required type="number" min="0.001" max="10000" step="any" value={manualCycle} readOnly onChange={event => setManualCycle(event.target.value)}/></label></> : <div className="detail inline-target"><span>Target / hour</span><strong>{plan ? plan + ' pcs' : '—'}</strong></div>}
    </div>
    <button className="btn primary" disabled={locked || modelLocked || !dirty}><Check size={20}/>{pending ? 'MODEL / LOT SENT' : busy ? 'SENDING…' : 'SAVE MODEL / LOT'}</button>
    {manual && modelsError && <div className="form-error" role="alert">{modelsError} <button type="button" className="text-btn" onClick={() => retry(value => value + 1)}>Retry models</button></div>}{manual && catalog && model && !chosen && <p className="hint">The saved model is not in the active model list. Select an active model before saving.</p>}{manual && <p className="hint">Target and standard cycle come from the selected model’s Google Sheet row.</p>}
    {manual && modelWarnings.map(warning => <p className="hint" key={warning}>{warning}</p>)}
    {error && <div className="form-error" role="alert">{error}</div>}
  </form>;
}
