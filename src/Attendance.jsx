import { useEffect, useRef, useState } from 'react';
import { RefreshCw, Search, Users } from 'lucide-react';
import './attendance.css';

const time = value => new Date(value).toLocaleTimeString('en-MY', { timeZone: 'Asia/Kuala_Lumpur', hour: '2-digit', minute: '2-digit', second: '2-digit' });

function Portrait({ employee }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [employee.photoUrl]);
  return <div className="attendance-portrait">{employee.photoUrl && !failed
    ? <img src={employee.photoUrl} alt={employee.name} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)}/>
    : <span aria-label="Photo unavailable">{employee.name.split(/\s+/).slice(0, 2).map(part => part[0]).join('')}<small>No photo</small></span>}
    <i className={`portrait-dot attendance-${employee.status.toLowerCase()}`}/></div>;
}

export default function Attendance({ line }) {
  const [group, setGroup] = useState('');
  const [data, setData] = useState(null);
  const [groups, setGroups] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('ALL');
  const generation = useRef(0);
  useEffect(() => {
    const current = ++generation.current;
    let disposed = false, timer, controller;
    async function load() {
      controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      setBusy(true);
      try {
        const response = await fetch(`/api/attendance?line=${encodeURIComponent(line || '')}${group ? `&group=${encodeURIComponent(group)}` : ''}`, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
        const result = await response.json();
        if (disposed || current !== generation.current) return;
        if (result.groups) setGroups(result.groups);
        if (!response.ok) {
          if ([401, 403].includes(response.status)) setData(null);
          throw new Error(result.error || 'Attendance could not be loaded.');
        }
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
  }, [group, attempt, line]);
  const outdated = data && (Boolean(error) || now - Date.parse(data.updatedAt) > 30000);
  const visible = (data?.employees || []).filter(e => (filter === 'ALL' || e.status === filter) && `${e.name} ${e.team} ${e.line}`.toLowerCase().includes(search.trim().toLowerCase()));
  function select(value) { setData(null); setError(''); setGroup(value); }
  return <section className="attendance-page">
    <div className="section-head"><div><span className="eyebrow">SMART ATTENDANCE</span><h1>Attendance</h1><p>Current clock-in status for your production group. Refreshes every 15 seconds.</p></div><button className="btn secondary" disabled={busy} onClick={() => setAttempt(v => v + 1)}><RefreshCw size={18}/>{busy ? 'Refreshing…' : 'Refresh'}</button></div>
    {groups.length > 1 && <label className="field attendance-group"><span>Production group</span><select value={group || data?.group.id || groups[0].id} onChange={e => select(e.target.value)}>{groups.map(g => <option key={g.id} value={g.id}>{g.label}</option>)}</select></label>}
    {error && <div className="connection-banner" role="alert">{error}{data && ' Showing the last successful update; these counts may be outdated.'}</div>}
    {!data && !error && <p role="status">Loading attendance…</p>}
    {data && <><div className="attendance-caption"><strong><Users size={20}/>{data.group.label}</strong><span role="status">{outdated ? 'Outdated · ' : ''}Updated {time(data.updatedAt)} MYT</span></div>
      <div className={`attendance-stats ${outdated ? 'attendance-outdated' : ''}`}>{[['in', 'IN'], ['out', 'OUT'], ['review', 'Needs review'], ['total', 'Total employees']].map(([key, label]) => <article key={key} className={`attendance-stat attendance-${key}`}><span>{label}</span><strong>{data[key]}</strong></article>)}</div>
      <p className="hint">OUT means currently clocked out, including other shifts and rest days. It does not mean absent. Needs review means an old clock-in has not been closed.</p>
      <div className="attendance-tools"><label className="attendance-search"><Search size={18}/><input aria-label="Search employees" placeholder="Search name or team…" value={search} onChange={e => setSearch(e.target.value)}/></label><div className="attendance-filters" aria-label="Filter attendance">{[['ALL', 'Everyone'], ['IN', 'IN'], ['OUT', 'OUT'], ['REVIEW', 'Needs review']].map(([value, label]) => <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}</div></div>
      <span className="attendance-result-count">{visible.length} of {data.total} employees</span>
      {!data.total ? <div className="notice">No active production employees match this attendance group. Ask your administrator to check the line mapping.</div> : !visible.length ? <div className="notice">No employees match this search and status.</div> : <div className={`attendance-people ${outdated ? 'attendance-outdated' : ''}`}>{visible.map(e => <article className={`attendance-person person-${e.status.toLowerCase()}`} key={e.id}><Portrait employee={e}/><div className="attendance-person-details"><span className={`attendance-status attendance-${e.status.toLowerCase()}`}>{e.status === 'REVIEW' ? 'Needs review' : e.status === 'IN' ? 'Clocked in' : 'Clocked out'}</span><strong>{e.name}</strong><small>{e.team ? `Team ${e.team}` : 'Team unassigned'} · {e.line}</small>{e.clockedInAt && <small>Clocked in {new Date(e.clockedInAt).toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' })}</small>}</div></article>)}</div>}
    </>}
  </section>;
}
