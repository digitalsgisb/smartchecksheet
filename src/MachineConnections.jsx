import { useEffect, useState } from 'react';
import { Radio, RefreshCw } from 'lucide-react';
import { api } from './api.js';

export default function MachineConnections() {
  const [data, setData] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [attempt, retry] = useState(0);
  useEffect(() => {
    let disposed = false, timer;
    async function load() {
      setBusy(true);
      try { const next = await api('/admin/machine-connections'); if (!disposed) { setData(next); setError(''); } }
      catch (e) { if (!disposed) setError(e.message); }
      finally { if (!disposed) { setBusy(false); timer = setTimeout(load, 15000); } }
    }
    load(); return () => { disposed = true; clearTimeout(timer); };
  }, [attempt]);
  return <div className="machine-connections"><div className="page-intro"><div><span className="eyebrow">DEVELOPER</span><h1>Machine connections</h1><p>Machine data connection for each line.</p></div><button className="btn secondary" disabled={busy} onClick={() => retry(v => v + 1)}><RefreshCw size={17}/>{busy ? 'Checking…' : 'Refresh'}</button></div>
    <div className="notice">The header’s Connected badge refers to the app server. Machine data is checked separately here.</div>
    {error && <p className="form-error" role="alert">{error}{data && ' Displayed status may be outdated.'}</p>}
    {!data && !error && <p role="status">Checking connections…</p>}
    <div className="connection-cards">{data?.lines.map(item => <section className="panel connection-card" key={item.line}><header><h2><Radio size={22}/>{item.line}</h2><span className={`badge ${item.connected ? 'success' : item.status === 'manual' ? 'neutral' : 'amber'}`}><i/>{item.connected ? 'Machine connected' : item.status === 'manual' ? 'Manual recording' : 'Machine disconnected'}</span></header><p>{item.reason}</p><dl>{[['Recording mode', item.configured ? 'Live / Python' : 'Manual'], ['MQTT broker', item.configured ? item.brokerConnected ? 'Connected' : 'Disconnected' : 'Not configured'], ['Broker address', item.broker || '—'], ['Machine data', item.connected ? 'Fresh (under 8 seconds)' : item.configured ? 'No fresh data' : 'Not enabled'], ['Last received', item.lastTelemetryAt ? new Date(item.lastTelemetryAt).toLocaleString('en-GB', {timeZone:'Asia/Kuala_Lumpur'}) + ' MYT' : '—']].map(([key,value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl></section>)}</div>
    {data && <p className="hint">Server mode: {data.mode} · Refreshes every 15 seconds</p>}
  </div>;
}
