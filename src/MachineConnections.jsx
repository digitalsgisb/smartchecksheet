import { useEffect, useState } from 'react';
import { Download, Plus, Radio, RefreshCw, Save, Trash2, Unplug, X } from 'lucide-react';
import { api, readApiResponse } from './api.js';
import { PageSkeleton } from './ui.jsx';
import { sheetsUrlPattern as sheetsPattern } from '../shared/sheetsUrl.js';
import { productionGroups } from '../shared/productionGroups.js';

const time = value => value ? new Date(value).toLocaleString('en-GB', { timeZone: 'Asia/Kuala_Lumpur' }) + ' MYT' : '—';
// Google Sheets link for the line's Pi program. Sent to the Pi over MQTT (retained); the Pi confirms on <line>/config_result.
function SheetsLink({ item }) {
  const saved = item.piSettings?.googleWebAppUrl || '', pi = item.sheets || {};
  const [url, setUrl] = useState(saved), [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  async function save(e) {
    e.preventDefault(); if (busy) return; const value = url.trim();
    if (value && !sheetsPattern.test(value)) { setError('Paste the Apps Script web app link: https://script.google.com/macros/s/…/exec'); return; }
    setBusy(true); setError(''); setMessage('');
    try { const result = await api(`/admin/lines/${encodeURIComponent(item.line)}/sheets-url`, { googleWebAppUrl: value }, 'PUT'); setMessage(result.sent ? 'Saved and sent to the Pi. Its answer appears below.' : 'Saved. It is sent when the Pi connects.'); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  const using = pi.source === 'smartchecksheet' ? 'Link saved here' : pi.source === 'default' ? 'Link built into the Pi program' : '—';
  return <details className="entry-optional" open={!!saved && !pi.supported}><summary>Google Sheets link</summary>
    {!pi.supported && <p className="hint">{item.connected ? 'This Pi program does not support it yet. It can still be saved now.' : 'Waiting for the Pi. You can save the link now.'}</p>}
    <form data-update-blocked={url !== saved} onSubmit={save}><label className="field"><span>Apps Script web app link</span><input maxLength={400} placeholder="https://script.google.com/macros/s/…/exec" value={url} onChange={e => { setUrl(e.target.value); setError(''); }}/><small className="hint">Leave empty to use the link built into the Pi program.</small></label>
      <button className="btn primary" disabled={busy || url.trim() === saved}><Save size={17}/>{busy ? 'Saving…' : 'Save link'}</button></form>
    <dl>{[['Pi is using', pi.supported ? using : '—'], ['Pi answer', pi.result ? `${pi.result.status === 'applied' ? 'Applied' : 'Refused'}${pi.result.message ? ' · ' + pi.result.message : ''} · ${time(pi.result.at)}` : '—'], ['Rows waiting to send', pi.queue ?? '—'], ['Saved by', item.piSettings ? `${item.piSettings.updatedBy} · ${time(item.piSettings.updatedAt)}` : '—']].map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>
    {error && <p className="form-error" role="alert">{error}</p>}{message && <p className="hint" role="status">{message}</p>}
  </details>;
}
// Developer page: add a line, connect it to its own Pi broker and download the Pi relay installer. Nothing here needs a file edit or restart.
function PiForm({ item, done, cancel }) {
  const s = item.settings || {};
  const [form, setForm] = useState({ host: s.host || '', port: s.port || 1883, username: s.username || '', password: '', productionLine: s.productionLine || item.line });
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const set = (key, value) => { setForm(f => ({ ...f, [key]: value })); setError(''); };
  async function save(e) {
    e.preventDefault(); if (busy) return; setBusy(true); setError('');
    try { await api(`/admin/lines/${encodeURIComponent(item.line)}/machine`, { ...form, port: Number(form.port) }, 'PUT'); done(item.settings ? 'Saved. Reconnecting to the Pi.' : 'Connected. Now install the relay on the Pi.'); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return <form className="pi-form" data-update-blocked onSubmit={save}>
    <div className="form-grid">
      <label className="field"><span>Pi address</span><input required autoFocus maxLength={253} placeholder="192.168.1.50" value={form.host} onChange={e => set('host', e.target.value.trim())}/></label>
      <label className="field"><span>Broker port</span><input type="number" min={1} max={65535} required value={form.port} onChange={e => set('port', e.target.value)}/></label>
      <label className="field"><span>Broker username</span><input required maxLength={100} autoComplete="off" value={form.username} onChange={e => set('username', e.target.value)}/></label>
      <label className="field"><span>Broker password</span><input type="password" required={!item.settings} maxLength={200} autoComplete="new-password" placeholder={item.settings ? 'Leave empty to keep the saved one' : ''} value={form.password} onChange={e => set('password', e.target.value)}/></label>
      <label className="field"><span>Line label in shift IDs</span><input required maxLength={20} pattern="[A-Za-z0-9][A-Za-z0-9 _\-]{0,19}" placeholder="MF" value={form.productionLine} onChange={e => set('productionLine', e.target.value)}/><small className="hint">From the Pi’s shift IDs: 20261106-Day-MF → MF</small></label>
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="script-actions"><button type="button" className="btn secondary" disabled={busy} onClick={cancel}><X size={17}/>Cancel</button><button className="btn primary" disabled={busy}><Save size={17}/>{busy ? 'Saving…' : item.settings ? 'Save' : 'Connect Pi'}</button></div>
  </form>;
}
// The Pi relay reports once a minute; silence or a queue means records (rejects, conditions, hourly rows, shift end) are not arriving.
function relayText(relay) {
  if (!relay?.seenAt) return 'Not heard from. Install or update the relay on the Pi.';
  return `${relay.healthy ? 'Running' : 'Silent'} · last report ${time(relay.seenAt)} · ${relay.waiting} waiting${relay.refused ? ` · ${relay.refused} set aside` : ''}`;
}
function LineCard({ item, canConnect, changed, piServerUrl }) {
  const [editing, setEditing] = useState(false), [busy, setBusy] = useState(''), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [server, setServer] = useState(piServerUrl || '');
  const app = item.settings?.source === 'app';
  async function run(kind) {
    if (busy) return;
    if (kind === 'disconnect' && !window.confirm(`Disconnect ${item.line} from its Pi? The line goes back to manual recording.`)) return;
    if (kind === 'remove' && !window.confirm(`Remove ${item.line} from this site? Records already saved are kept.`)) return;
    setBusy(kind); setError(''); setMessage('');
    try {
      if (kind === 'disconnect') { await api(`/admin/lines/${encodeURIComponent(item.line)}/machine`, {}, 'DELETE'); changed(); }
      if (kind === 'remove') { await api(`/admin/lines/${encodeURIComponent(item.line)}`, {}, 'DELETE'); changed(); }
      if (kind === 'installer') {
        const response = await fetch(`/api/admin/lines/${encodeURIComponent(item.line)}/pi-installer?server=${encodeURIComponent(server.trim())}`, { credentials: 'same-origin', cache: 'no-store' });
        if (!response.ok) await readApiResponse(response);
        const link = document.createElement('a'); link.href = URL.createObjectURL(await response.blob()); link.download = `install-pi-${item.line}.sh`; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000);
        setMessage(`Copy the file to the ${item.line} Pi and run: sudo bash install-pi-${item.line}.sh — then delete the file.`);
      }
    } catch (err) { setError(err.message); } finally { setBusy(''); }
  }
  return <section className="panel connection-card" aria-busy={!!busy}><header><h2><Radio size={22}/>{item.line}</h2><span className={`badge ${item.connected ? 'success' : item.status === 'manual' ? 'neutral' : 'amber'}`}><i/>{item.connected ? 'Machine connected' : item.status === 'manual' ? 'Manual recording' : 'Machine disconnected'}</span></header><p>{item.reason}</p>
    {editing ? <PiForm item={item} cancel={() => setEditing(false)} done={text => { setEditing(false); setMessage(text); changed(); }}/> : <>
      <dl>{[['Plant', item.plant || 'Not set · Executive workspace → Production group setup'], ['Recording mode', item.configured ? 'Live / Python' : 'Manual'], ['Pi broker', item.broker || (item.settings ? item.settings.host + ':' + item.settings.port : '—')], ['Line label', item.settings?.productionLine || '—'], ['MQTT broker', item.configured ? item.brokerConnected ? 'Connected' : 'Disconnected' : 'Not configured'], ['Last received', time(item.lastTelemetryAt)], ...(item.configured ? [['Pi relay', relayText(item.relay)], ['Last record delivered', item.relay?.lastEventAt ? time(item.relay.lastEventAt) : '—']] : []), ['Set up by', item.settings?.source === 'file' ? 'Site settings file (machines.json)' : app ? `${item.settings.updatedBy} · ${time(item.settings.updatedAt)}` : '—']].map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>
      {item.configured && !item.relay?.healthy && <p className="form-error" role="alert">Pi relay is not reporting. Rejects, conditions and hourly records from {item.line} are not reaching this PC.{item.relay?.lastError ? ` Last error: ${item.relay.lastError}` : ''}</p>}
      {item.configured && item.relay?.healthy && item.relay.lastError && <p className="hint">Relay last error: {item.relay.lastError}</p>}
      {canConnect && item.settings?.source !== 'file' && <div className="script-actions">
        <button className="btn secondary" disabled={!!busy} onClick={() => { setEditing(true); setMessage(''); }}><Radio size={17}/>{app ? 'Edit Pi' : 'Connect Pi'}</button>
        {app && <button className="btn secondary" disabled={!!busy} onClick={() => run('disconnect')}><Unplug size={17}/>{busy === 'disconnect' ? 'Disconnecting…' : 'Disconnect'}</button>}
        {item.removable && <button className="btn secondary" disabled={!!busy} onClick={() => run('remove')}><Trash2 size={17}/>Remove line</button>}
      </div>}
      {canConnect && item.configured && <SheetsLink item={item}/>}
      {app && item.settings.readable && <details className="entry-optional"><summary>Pi relay installer</summary><label className="field"><span>This PC’s Tailscale address as the Pi sees it</span><input value={server} maxLength={300} onChange={e => setServer(e.target.value)} placeholder="http://100.64.0.5:3700"/><small className="hint">Not the public HTTPS address: Cloudflare blocks the Pi there.</small></label><button className="btn primary" disabled={!!busy || !server.trim()} onClick={() => run('installer')}><Download size={17}/>{busy === 'installer' ? 'Preparing…' : 'Download installer'}</button><p className="hint">The file holds this line’s private relay token. Keep it off shared folders and delete it after installing.</p></details>}
    </>}
    {error && <p className="form-error" role="alert">{error}</p>}{message && <p className="hint" role="status">{message}</p>}
  </section>;
}
export default function MachineConnections() {
  const [data, setData] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [attempt, retry] = useState(0);
  const [newLine, setNewLine] = useState(''), [newGroup, setNewGroup] = useState(''), [adding, setAdding] = useState(false), [addError, setAddError] = useState(''), [added, setAdded] = useState('');
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
  async function addLine(e) {
    e.preventDefault(); if (adding) return; setAdding(true); setAddError(''); setAdded('');
    try { const { line } = await api('/admin/lines', { line: newLine.trim().toUpperCase(), groupId: newGroup }); setNewLine(''); setNewGroup(''); setAdded(`${line} added. Create its tablet account in User Management. It records manually until you connect a Pi below. Reload the app to see ${line} in the line menu.`); retry(v => v + 1); }
    catch (err) { setAddError(err.message); } finally { setAdding(false); }
  }
  return <div className="machine-connections"><div className="page-intro"><div><h1>Lines & machines</h1><p>Each line, and the Raspberry Pi it is connected to.</p></div><button className="btn secondary" disabled={busy} onClick={() => retry(v => v + 1)}><RefreshCw size={17}/>{busy ? 'Checking…' : 'Refresh'}</button></div>
    <div className="notice">Each tablet account is given one line; that line reads only its own Pi. Changes here apply at once—no restart.</div>
    {data?.canConnect && <form className="panel add-line-form" data-update-blocked={!!newLine || !!newGroup} onSubmit={addLine}><label className="field"><span>New line code</span><input required maxLength={8} pattern="[A-Za-z][A-Za-z0-9]{1,7}" placeholder="ABB4" value={newLine} onChange={e => { setNewLine(e.target.value.toUpperCase()); setAddError(''); }}/></label><label className="field"><span>Plant</span><select required value={newGroup} onChange={e => { setNewGroup(e.target.value); setAddError(''); }}><option value="">Choose plant</option>{productionGroups.map(group => <option key={group.id} value={group.id}>{group.label}</option>)}</select></label><button className="btn primary" disabled={adding || !newLine.trim() || !newGroup}><Plus size={17}/>{adding ? 'Adding…' : 'Add line'}</button>{addError && <p className="form-error" role="alert">{addError}</p>}{added && <p className="hint" role="status">{added}</p>}</form>}
    {error && <p className="form-error" role="alert">{error}{data && ' Displayed status may be outdated.'}</p>}
    {!data && !error && <PageSkeleton variant="grid" label="Checking connections"/>}
    <div className="connection-cards">{data?.lines.map(item => <LineCard key={item.line} item={item} canConnect={data.canConnect} piServerUrl={data.piServerUrl} changed={() => retry(v => v + 1)}/>)}</div>
    {data && <p className="hint">Server mode: {data.mode} · Refreshes every 15 seconds</p>}
  </div>;
}
