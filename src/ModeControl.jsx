import { useEffect, useRef, useState } from 'react';
import { Clock3, LoaderCircle, Play } from 'lucide-react';
import { modeRequestStatus } from './modeRequest.js';

export default function ModeControl({ state, action, writable, active }) {
  const [request, setRequest] = useState(null);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const status = modeRequestStatus(request, state.live.mode, state.commands);
  const syncing = request && ['sending', 'pending'].includes(status);
  const selected = syncing ? request.mode : state.live.mode;
  useEffect(() => { generation.current++; setRequest(null); setError(''); return () => { generation.current++; }; }, [state.line, state.shift?.id]);
  useEffect(() => {
    if (!request) return;
    if (status === 'confirmed') { setRequest(null); setError(''); }
    else if (['failed', 'rejected', 'unconfirmed'].includes(status)) {
      setRequest(null); setError('Mode change was not confirmed. Showing the last reported mode.');
    }
  }, [request, status]);
  useEffect(() => {
    if (!request) return;
    const timer = setTimeout(() => {
      setRequest(null); setError('Mode change was not confirmed. Check the machine before trying again.');
    }, Math.max(0, 32000 - (Date.now() - request.startedAt)));
    return () => clearTimeout(timer);
  }, [request]);
  async function choose(mode) {
    if (syncing || !writable || !active || state.timer.status === 'running' || mode === state.live.mode) return;
    const pending = { mode, startedAt: Date.now() };
    const currentGeneration = ++generation.current;
    setRequest(pending); setError('');
    try {
      const result = await action('mode', { mode }, true);
      if (generation.current !== currentGeneration) return;
      if (result.pending) setRequest(current => current?.startedAt === pending.startedAt ? { ...current, id: result.commandId } : current);
      else setRequest(null);
    } catch (failure) { if (generation.current === currentGeneration) { setRequest(null); setError(failure.message); } }
  }
  return <section className="reference-mode responsive-mode"><span>Machine mode</span><div className="mode-options">
    {[{ mode: 'NORMAL', label: 'Normal', Icon: Play }, { mode: 'REST', label: 'Rest', Icon: Clock3 }].map(({ mode, label, Icon }) =>
      <button key={mode} className={`btn ${selected === mode ? `mode-selected ${mode === 'REST' ? 'rest-selected' : ''}` : 'secondary'}`}
        aria-pressed={selected === mode} aria-busy={Boolean(syncing && request.mode === mode)}
        disabled={!writable || !active || state.timer.status === 'running' || Boolean(syncing) || selected === mode}
        onClick={() => choose(mode)}><Icon size={18}/>{label}{syncing && request.mode === mode && <LoaderCircle className="mode-sync-icon" size={15}/>}</button>)}
    </div>{syncing && <small className="mode-feedback" role="status">{selected === 'REST' ? 'Rest' : 'Normal'} requested · syncing</small>}
    {error && <small className="mode-feedback mode-error" role="alert">{error}</small>}
  </section>;
}
