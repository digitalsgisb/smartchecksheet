import { useEffect, useState } from 'react';
import { Check, Clock3 } from 'lucide-react';

export default function InlineSetup({ state, action, writable, active }) {
  const [model, setModel] = useState(state.setup?.model || '');
  const [lot, setLot] = useState(state.setup?.lot || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    setModel(state.setup?.model || '');
    setLot(state.setup?.lot || '');
    setError('');
  }, [state.setup?.model, state.setup?.lot, state.shift?.id]);
  const pending = state.commands.some(command => command.kind === 'setup' && command.status === 'pending');
  const locked = !writable || !active || busy || pending;
  const dirty = model !== (state.setup?.model || '') || lot.trim() !== (state.setup?.lot || '');
  const chosen = state.models.find(item => item.name === model);
  const plan = model === state.setup?.model ? state.setup.plan : chosen?.pcsHr;
  async function save(event) {
    event.preventDefault();
    if (locked || !dirty) return;
    setBusy(true); setError('');
    try { await action('setup', { model, lot: lot.trim(), plan }, true); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  return <form className="panel reference-model inline-setup" onSubmit={save}>
    <div className="reference-model-fields">
      <label className="field"><span>Model</span><select required value={model} disabled={locked} onChange={event => { setModel(event.target.value); setError(''); }}><option value="">Select model</option>{state.models.map(item => <option value={item.name} key={item.name}>{item.name}</option>)}</select></label>
      <label className="field"><span>Lot number</span><input required maxLength={80} value={lot} disabled={locked} placeholder="Type lot number" autoComplete="off" onChange={event => { setLot(event.target.value); setError(''); }}/></label>
      <div className="detail inline-target"><span>Target / hour</span><strong>{plan ? plan + ' pcs' : '—'}</strong></div>
    </div>
    <button className="btn primary" disabled={locked || !dirty}><Check size={20}/>{pending ? <><Clock3 size={18}/>WAITING FOR MACHINE</> : busy ? 'SAVING…' : 'SAVE MODEL / LOT'}</button>
    {error && <div className="form-error" role="alert">{error}</div>}
  </form>;
}
