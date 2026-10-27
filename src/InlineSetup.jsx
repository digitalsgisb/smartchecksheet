import { useEffect, useState } from 'react';
import { Check, Clock3 } from 'lucide-react';
import SelectOptions from './SelectOptions.jsx';

export default function InlineSetup({ state, action, writable, active }) {
  const [model, setModel] = useState(state.setup?.model || '');
  const [lot, setLot] = useState(state.setup?.lot || '');
  const [manualPlan, setManualPlan] = useState(state.setup?.plan || '');
  const [manualCycle, setManualCycle] = useState(state.setup?.cycle || '');
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
  const manual = state.mode === 'manual';
  const dirty = model !== (state.setup?.model || '') || lot.trim() !== (state.setup?.lot || '') || manual && (Number(manualPlan) !== state.setup?.plan || Number(manualCycle) !== state.setup?.cycle);
  const chosen = state.models.find(item => item.name === model);
  const plan = manual ? Number(manualPlan) : model === state.setup?.model ? state.setup.plan : chosen ? Math.max(1, Math.floor(chosen.pcsHr)) : undefined;
  async function save(event) {
    event.preventDefault();
    if (locked || !dirty) return;
    setBusy(true); setError('');
    try { await action('setup', { model, lot: lot.trim(), plan, ...(manual ? { cycle: Number(manualCycle) } : {}) }, true); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  return <form className="panel reference-model inline-setup" onSubmit={save}>
    <div className={`reference-model-fields ${manual ? 'manual-model-fields' : ''}`}>
      <label className="field"><span>Model</span>{manual ? <input required maxLength={120} value={model} disabled={locked} placeholder="Enter model" onChange={event => setModel(event.target.value)}/> : <select required value={model} disabled={locked} onChange={event => { setModel(event.target.value); setError(''); }}><option value="">Select model</option><SelectOptions items={state.models.map(item => item.name)}/></select>}</label>
      <label className="field"><span>Lot number</span><input required maxLength={80} value={lot} disabled={locked} placeholder="Type lot number" autoComplete="off" onChange={event => { setLot(event.target.value); setError(''); }}/></label>
      {manual ? <><label className="field"><span>Target / hour (pcs)</span><input required type="number" min="1" max="10000" step="1" value={manualPlan} disabled={locked} onChange={event => setManualPlan(event.target.value)}/></label><label className="field"><span>Standard cycle (min / piece)</span><input required type="number" min="0.001" max="10000" step="any" value={manualCycle} disabled={locked} onChange={event => setManualCycle(event.target.value)}/></label></> : <div className="detail inline-target"><span>Target / hour</span><strong>{plan ? plan + ' pcs' : '—'}</strong></div>}
    </div>
    <button className="btn primary" disabled={locked || !dirty}><Check size={20}/>{pending ? <><Clock3 size={18}/>WAITING FOR MACHINE</> : busy ? 'SAVING…' : 'SAVE MODEL / LOT'}</button>
    {error && <div className="form-error" role="alert">{error}</div>}
  </form>;
}
