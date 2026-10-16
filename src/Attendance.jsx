import { useEffect, useRef, useState } from 'react';
import { RefreshCw, Users } from 'lucide-react';
import './attendance.css';

const time = value => new Date(value).toLocaleTimeString('en-MY', { timeZone: 'Asia/Kuala_Lumpur', hour: '2-digit', minute: '2-digit', second: '2-digit' });

export default function Attendance() {
  const [group, setGroup] = useState('');
  const [data, setData] = useState(null);
  const [groups, setGroups] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const generation = useRef(0);
  useEffect(() => {
    const current = ++generation.current;
    let disposed = false, timer, controller;
    async function load() {
      controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      setBusy(true);
      try {
        const response = await fetch(`/api/attendance${group ? `?group=${encodeURIComponent(group)}` : ''}`, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
        const result = await response.json();
        if (disposed || current !== generation.current) return;
        if (result.groups) setGroups(result.groups);
        if (!response.ok) throw new Error(result.error || 'Attendance could not be loaded.');
        setData(result); setError('');
      } catch (e) {
        if (!disposed && current === generation.current) setError(e.name === 'AbortError' ? 'Attendance request timed out.' : e.message === 'Failed to fetch' ? 'Attendance connection lost.' : e.message);
      } finally {
        clearTimeout(timeout);
        if (!disposed && current === generation.current) { setBusy(false); timer = setTimeout(load, 15000); }
      }
    }
    load();
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => { disposed = true; clearTimeout(timer); clearInterval(tick); controller?.abort(); };
  }, [group, attempt]);
  const outdated = data && (Boolean(error) || now - Date.parse(data.updatedAt) > 30000);
  function select(value) { setData(null); setError(''); setGroup(value); }
  return <section className="attendance-page">
    <div className="section-head"><div><span className="eyebrow">SMART ATTENDANCE</span><h1>Attendance</h1><p>Current clock-in status for your production group. Refreshes every 15 seconds.</p></div><button className="btn secondary" disabled={busy} onClick={() => setAttempt(v => v + 1)}><RefreshCw size={18}/>{busy ? 'Refreshing…' : 'Refresh'}</button></div>
    {groups.length > 1 && <label className="field attendance-group"><span>Production group</span><select value={group || data?.group.id || groups[0].id} onChange={e => select(e.target.value)}>{groups.map(g => <option key={g.id} value={g.id}>{g.label}</option>)}</select></label>}
    {error && <div className="connection-banner" role="alert">{error}{data && ' Showing the last successful update; these counts may be outdated.'}</div>}
    {!data && !error && <p role="status">Loading attendance…</p>}
    {data && <><div className="attendance-caption"><strong><Users size={20}/>{data.group.label}</strong><span role="status">{outdated ? 'Outdated · ' : ''}Updated {time(data.updatedAt)} MYT</span></div>
      <div className={`attendance-stats ${outdated ? 'attendance-outdated' : ''}`}>{[['in', 'IN'], ['out', 'OUT'], ['review', 'Needs review'], ['total', 'Total employees']].map(([key, label]) => <article key={key} className={`attendance-stat attendance-${key}`}><span>{label}</span><strong>{data[key]}</strong></article>)}</div>
      <p className="hint">OUT means currently clocked out, including other shifts and rest days. It does not mean absent. Needs review means an old clock-in has not been closed.</p>
      {!data.total ? <div className="notice">No active production employees match this attendance group. Ask your administrator to check the line mapping.</div> : <div className="attendance-people">{data.employees.map(e => <article className="attendance-person" key={e.id}><div><strong>{e.name}</strong><small>{e.team ? `Team ${e.team}` : 'Team unassigned'} · {e.line}</small>{e.clockedInAt && <small>Clocked in {new Date(e.clockedInAt).toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' })}</small>}</div><span className={`attendance-status attendance-${e.status.toLowerCase()}`}>{e.status === 'REVIEW' ? 'Needs review' : e.status}</span></article>)}</div>}
    </>}
  </section>;
}
