import { useEffect, useState } from 'react';
import { Check, CloudUpload, HardDrive, RefreshCw, AlertTriangle } from 'lucide-react';
import { api } from './api.js';
import { PageSkeleton } from './ui.jsx';
import './backups.css';

const when = value => new Date(value).toLocaleString('en-GB', { timeZone: 'Asia/Kuala_Lumpur', dateStyle: 'medium', timeStyle: 'short' });
const size = bytes => bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round((bytes || 0) / 1024))} KB`;

export default function Backups() {
  const [data, setData] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [attempt, retry] = useState(0);
  useEffect(() => { let disposed = false; setError(''); api('/admin/backups').then(next => { if (!disposed) setData(next); }).catch(e => { if (!disposed) setError(e.message); }); return () => { disposed = true; }; }, [attempt]);
  async function runNow() { if (busy) return; setBusy(true); setError(''); try { setData(await api('/admin/backups/run', {}, 'POST')); } catch (e) { setError(e.message); } finally { setBusy(false); } }
  const last = data?.runs[0];
  return <div className="backups-page"><div className="page-intro"><div><h1>Backups</h1><p>The database is copied every night at {String(data?.hour ?? 2).padStart(2, '0')}:00.</p></div><button className="btn primary" disabled={!data || busy} onClick={runNow}><CloudUpload size={18} className={busy ? 'backup-spin' : ''}/>{busy ? 'Backing up…' : 'Back up now'}</button></div>
    {error && <div className="notice" role="alert">{error}<button className="text-btn" onClick={() => retry(v => v + 1)}><RefreshCw size={16}/>Retry</button></div>}
    {!data && !error && <PageSkeleton variant="cards" label="Loading backups"/>}
    {data && <><div className="backup-cards">
      <section className="panel backup-card"><header><CloudUpload size={21}/><h2>Google Drive</h2></header>{data.drive ? (data.lastDrive ? <p className="backup-ok"><Check size={16}/>{when(data.lastDrive.at)} · {data.lastDrive.drive}</p> : <p className="hint">Connected. No copy sent yet—press Back up now to test.</p>) : <><p className="hint">{data.setupError || <>Not connected. On the AI PC run: <code>bash deploy/site.sh drive-backup</code></>}</p><a className="backup-download" href="/apps-script/DriveBackup.gs" download>Download the Drive backup Apps Script</a></>}{data.drive && <small>The newest {data.keepDrive} copies are kept in Drive; older ones go to the Drive Bin.</small>}</section>
      <section className="panel backup-card"><header><HardDrive size={21}/><h2>On the AI PC</h2></header>{data.lastOk ? <p className="backup-ok"><Check size={16}/>{when(data.lastOk.at)} · {data.lastOk.file} · {size(data.lastOk.size)}</p> : <p className="hint">No copy yet.</p>}<small>The newest {data.keepLocal} copies are kept. Sign-ins are not included, so after a restore everyone signs in again.</small></section>
    </div>
    {last?.error && <div className="notice backup-error" role="alert"><AlertTriangle size={18}/>Last backup failed ({when(last.at)}): {last.error}</div>}
    <section className="panel backup-history"><h2>Recent backups</h2>{data.runs.length ? <table><thead><tr><th>When</th><th>By</th><th>File</th><th>Drive</th></tr></thead><tbody>{data.runs.map((run, i) => <tr key={i}><td>{when(run.at)}</td><td>{run.actor}</td><td>{run.file ? `${run.file} · ${size(run.size)}` : '—'}</td><td className={run.error ? 'backup-failed' : ''}>{run.error ? 'Failed' : run.drive ? 'Sent' : data.drive ? (run.file ? '—' : 'Running…') : 'Off'}</td></tr>)}</tbody></table> : <p className="hint">Nothing yet.</p>}</section></>}
  </div>;
}
