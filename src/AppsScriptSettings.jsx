import { useEffect, useState } from 'react';
import { Check, Link2, RefreshCw, Save, FlaskConical } from 'lucide-react';
import { api } from './api.js';
import './apps-script-settings.css';

const labels = { supervisors: 'Supervisors', leaders: 'Leaders', forming: 'Forming', waterjet: 'Waterjet', assembly: 'Assembly', quality: 'Quality', models: 'Models' };
function LineSettings({ setting, kind = 'names' }) {
  const [saved, setSaved] = useState(setting), [url, setUrl] = useState(setting.url);
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [result, setResult] = useState(null), [message, setMessage] = useState('');
  const changed = url.trim() !== saved.url;
  async function run(action) {
    if (busy) return;
    setBusy(action); setError(''); setMessage(''); setResult(null);
    try {
      const path = `/admin/${kind === 'models' ? 'model-scripts' : 'apps-script'}/${encodeURIComponent(saved.line)}`;
      const next = await api(action === 'test' ? `${path}/test` : path, { url: url.trim() }, action === 'test' ? 'POST' : 'PATCH');
      if (action === 'test') setResult(next);
      else { setSaved(next); setUrl(next.url); setMessage(kind === 'models' ? 'Saved. The Model dropdown reads this line’s Models sheet.' : 'Saved. Applies when Start shift opens.'); }
    } catch (e) { setError(e.message); }
    finally { setBusy(''); }
  }
  return <section className="panel script-line" aria-labelledby={`script-${kind}-${saved.line}`} aria-busy={!!busy}>
    <header><div className="script-line-title"><Link2 size={21}/><h2 id={`script-${kind}-${saved.line}`}>{saved.line}</h2></div><span className="script-source">{changed ? 'Unsaved' : saved.source === 'saved' ? 'Saved link' : 'Default link'}</span></header>
    <form data-update-blocked={changed || !!busy} onSubmit={e => { e.preventDefault(); run('save'); }}>
      <label className="field"><span>{kind === 'models' ? 'Models Apps Script URL' : 'Names Apps Script URL'}</span><input type="url" required maxLength={2048} disabled={!!busy} value={url} onChange={e => { setUrl(e.target.value); setResult(null); setError(''); setMessage(''); }} placeholder="https://script.google.com/macros/s/…/exec"/></label>
      <div className="script-actions"><button className="btn secondary" type="button" disabled={!!busy || !url.trim()} onClick={() => run('test')}><FlaskConical size={17} className={busy === 'test' ? 'script-testing' : ''}/>{busy === 'test' ? 'Testing…' : 'Test Apps Script'}</button><button className="btn primary" type="submit" disabled={!!busy || !changed || !url.trim()}><Save size={17}/>{busy === 'save' ? 'Saving…' : 'Save link'}</button></div>
    </form>
    <div aria-live="polite">{error && <p className="form-error" role="alert">{error}</p>}{message && <p className="script-success"><Check size={16}/>{message}</p>}{result && <div className="script-test-result"><p className="script-success"><Check size={17}/>Connected{changed ? ' · Save to apply' : ''}</p><dl>{Object.entries(result.counts).map(([key, count]) => <div key={key}><dt>{labels[key]}</dt><dd>{count}</dd></div>)}</dl></div>}</div>
    {saved.updatedAt && <small className="script-updated">Saved by {saved.updatedBy} · {new Date(saved.updatedAt).toLocaleString('en-GB', { timeZone: 'Asia/Kuala_Lumpur', dateStyle: 'medium', timeStyle: 'short' })} MYT</small>}
  </section>;
}
export default function AppsScriptSettings() {
  const [data, setData] = useState(null), [error, setError] = useState(''), [attempt, retry] = useState(0);
  useEffect(() => {
    let disposed = false; setError('');
    Promise.all([api('/admin/apps-script'), api('/admin/model-scripts')]).then(([names, models]) => ({ ...names, modelLines: models.lines })).then(next => { if (!disposed) setData(next); }).catch(e => { if (!disposed) setError(e.message); });
    return () => { disposed = true; };
  }, [attempt]);
  return <div className="script-settings"><div className="page-intro"><div><span className="eyebrow">ADMINISTRATION</span><h1>Apps Script links<span>.</span></h1><p>Names and model lists for each production line.</p></div></div><p className="hint">Test checks the link without saving. Saved links apply immediately—no restart needed.</p>
    {error && <div className="notice" role="alert">{error}<button className="text-btn" onClick={() => retry(v => v + 1)}><RefreshCw size={16}/>Retry</button></div>}
    {!data && !error && <p role="status">Loading links…</p>}
    <h2>Operator names</h2><div className="script-settings-grid">{data?.lines.map(setting => <LineSettings key={setting.line} setting={setting}/>)}</div>
    <h2>Models</h2><p className="hint">Use a Models sheet with line, model, targetPerHour, cycleMinutes and active columns. <a href="/apps-script/Models.gs" download>Download the Models Apps Script template</a>. Deploy it as a web app and paste its /exec URL below. The line is supplied automatically.</p><div className="script-settings-grid">{data?.modelLines.map(setting => <LineSettings key={setting.line} setting={setting} kind="models"/>)}</div>{data && !data.lines.length && <p className="notice">No production lines assigned.</p>}
  </div>;
}
