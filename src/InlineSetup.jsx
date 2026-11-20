import { useEffect, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import { api } from './api.js';
import SmoothSelect from './SmoothSelect.jsx';
import { Swap } from './ui.jsx';

export default function InlineSetup({ state, action, writable, active }) {
  const [model, setModel] = useState(state.setup?.model || '');
  const [lot, setLot] = useState(state.setup?.lot || '');
  const [manualPlan, setManualPlan] = useState(state.setup?.plan || '');
  const [manualCycle, setManualCycle] = useState(state.setup?.cycle || '');
  const manual = state.mode === 'manual';
  // Manual lines, and live lines with a Models Apps Script link, take models from the line's Google Sheet.
  const sheet = manual || !!state.modelsFromSheet;
  const [catalog, setCatalog] = useState(null), [modelsError, setModelsError] = useState(''), [modelWarnings, setModelWarnings] = useState([]), [attempt, retry] = useState(0);
  useEffect(() => {
    if (!sheet) return;
    let disposed = false, timer;
    async function load() {
      try { const next = await api('/models'); if (!disposed) { setCatalog(next.models); setModelWarnings(next.warnings || []); setModelsError(''); } }
      catch (e) { if (!disposed) setModelsError(e.message); }
      finally { if (!disposed) timer = setTimeout(load, 60000); }
    }
    load(); return () => { disposed = true; clearTimeout(timer); };
  }, [sheet, state.line, attempt]);
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
  // Pulse once when a save is confirmed: at once for a direct save, or when the machine's pending command clears.
  const [saved, setSaved] = useState(false), wasPending = useRef(false);
  useEffect(() => { if (!saved) return; const timer = setTimeout(() => setSaved(false), 1200); return () => clearTimeout(timer); }, [saved]);
  const dirty = model !== (state.setup?.model || '') || lot.trim() !== (state.setup?.lot || '') || Number(manualPlan) !== Number(state.setup?.plan || 0) || manual && Number(manualCycle) !== Number(state.setup?.cycle || 0);
  useEffect(() => { if (wasPending.current && !pending && !dirty && state.setup) setSaved(true); wasPending.current = pending; }, [pending, dirty, state.setup]);
  const availableModels = sheet ? catalog || [] : state.models;
  const chosen = availableModels.find(item => item.name === model);
  const modelLocked = sheet && (!catalog || !!modelsError || !chosen);
  // The operator types the hourly target; choosing a new model clears it so an old target is never saved by accident.
  const plan = Number(manualPlan);
  async function save(event) {
    event.preventDefault();
    if (locked || modelLocked || !dirty || !(plan >= 1)) return;
    setBusy(true); setError('');
    try { const result = await action('setup', { model, lot: lot.trim(), plan, ...(manual ? { cycle: Number(manualCycle) } : {}) }, true); if (!result?.pending) setSaved(true); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  return <form className="panel reference-model inline-setup" onSubmit={save} data-update-blocked={dirty || busy} data-saved={saved}>
    <div className={`reference-model-fields ${manual ? 'manual-model-fields' : ''}`}>
      <label className="field"><span>Model</span><SmoothSelect items={availableModels.map(item => item.name)} value={model} disabled={locked || sheet && (!catalog || !!modelsError)} placeholder={sheet && !catalog ? 'Load model list' : 'Select model'} ariaLabel="Model" onChange={value => { setModel(value); setError(''); const selected = availableModels.find(item => item.name === value); setManualPlan(''); if (manual && selected) setManualCycle(selected.cycle); }}/></label>
      <label className="field"><span>Lot number</span><input required maxLength={80} value={lot} disabled={locked} placeholder="Type lot number" autoComplete="off" onChange={event => { setLot(event.target.value); setError(''); }}/></label>
      <label className="field"><span>Target / hour (pcs)</span><input required type="number" inputMode="numeric" min="1" max="10000" step="1" value={manualPlan} disabled={locked} placeholder="Type target" onChange={event => { setManualPlan(event.target.value); setError(''); }}/></label>
      {manual && <label className="field"><span>Standard cycle (min / piece)</span><input required type="number" min="0.001" max="10000" step="any" value={manualCycle} readOnly/></label>}
    </div>
    <button className="btn primary" disabled={locked || modelLocked || !dirty || !(plan >= 1)}><Swap id={pending ? 'sent' : busy ? 'sending' : 'save'}><Check size={20}/>{pending ? 'Model / lot sent' : busy ? 'Sending…' : !dirty && state.setup ? 'Model / lot saved' : !(plan >= 1) ? 'Type target / hour to save' : 'Save model / lot'}</Swap></button>
    {sheet && modelsError && <div className="form-error" role="alert">{modelsError} <button type="button" className="text-btn" onClick={() => retry(value => value + 1)}>Retry models</button></div>}{sheet && catalog && model && !chosen && <p className="hint">The saved model is not in the active model list. Select an active model before saving.</p>}<p className="hint">Type how many pieces you aim to make each hour. Change it any time and save.</p>
    {sheet && modelWarnings.map(warning => <p className="hint" key={warning}>{warning}</p>)}
    {error && <div className="form-error" role="alert">{error}</div>}
  </form>;
}
