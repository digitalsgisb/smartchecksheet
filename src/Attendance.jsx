import SmoothSelect from './SmoothSelect.jsx';
import { useEffect, useRef, useState } from 'react';
import { RefreshCw, Search, Users } from 'lucide-react';
import './attendance.css';
import { api, readApiResponse } from './api.js';
import { Num, PageSkeleton, SlideGroup, Swap } from './ui.jsx';

const time = value => new Date(value).toLocaleTimeString('en-MY', { timeZone: 'Asia/Kuala_Lumpur', hour: '2-digit', minute: '2-digit', second: '2-digit' });

function Portrait({ employee, updatedAt }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [employee.id, employee.photoUrl, updatedAt]);
  return <div className="attendance-portrait">{employee.photoUrl && !failed
    ? <img src={employee.photoUrl} alt={employee.name} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)}/>
    : <span aria-label="Photo unavailable">{employee.name.split(/\s+/).slice(0, 2).map(part => part[0]).join('')}<small>{employee.photoUrl ? 'Photo unavailable' : 'No photo'}</small></span>}</div>;
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
  // Optimistic shift A/B: id -> { team, seq, savedAt }. Kept on top of polled data until a poll started after the save confirms it.
  const overrides = useRef(new Map()), queues = useRef(new Map()), seq = useRef(0);
  const [, rerender] = useState(0);
  const [saveError, setSaveError] = useState('');
  useEffect(() => {
    const current = ++generation.current;
    let disposed = false, timer, controller;
    async function load() {
      controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      setBusy(true);
      const started = Date.now();
      try {
        const response = await fetch(`/api/attendance?line=${encodeURIComponent(line || '')}${group ? `&group=${encodeURIComponent(group)}` : ''}`, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
        const result = await readApiResponse(response);
        if (disposed || current !== generation.current) return;
        for (const [id, item] of overrides.current) if (item.savedAt && item.savedAt < started) overrides.current.delete(id);
        if (result.groups) setGroups(result.groups);
        setData(result); setError('');
      } catch (e) {
        if (!disposed && current === generation.current) {
          if ([401, 403].includes(e.status)) setData(null);
          if (Array.isArray(e.data?.groups)) setGroups(e.data.groups);
          setError(e.name === 'AbortError' ? 'Attendance request timed out.' : e.message === 'Failed to fetch' ? 'Attendance connection lost.' : e.message);
        }
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
  const people = (data?.employees || []).map(e => overrides.current.has(String(e.id)) ? { ...e, shiftTeam: overrides.current.get(String(e.id)).team } : e);
  const visible = people.filter(e => (filter === 'ALL' || e.status === filter) && `${e.name} ${e.team} ${e.line} ${e.attendanceGroup || ''} ${e.shiftTeam ? `shift ${e.shiftTeam}` : ''}`.toLowerCase().includes(search.trim().toLowerCase()));
  const byShift = (a, b) => (a.shiftTeam || 'Z').localeCompare(b.shiftTeam || 'Z');
  const sections = [['IN', 'Present', visible.filter(e => e.status === 'IN').sort(byShift)], ['OUT', 'Absent', visible.filter(e => e.status !== 'IN').sort(byShift)]].filter(([, , list]) => list.length);
  function select(value) { setData(null); setError(''); setGroup(value); }
  function setShiftTeam(person, team) {
    const id = String(person.id), next = person.shiftTeam === team ? null : team, mine = ++seq.current;
    overrides.current.set(id, { team: next, seq: mine, savedAt: 0 }); setSaveError(''); rerender(v => v + 1);
    // Saves for one person go out in order, so the last tap is what the server keeps.
    const run = (queues.current.get(id) || Promise.resolve()).then(() => api('/attendance/shift-team', { employeeId: id, team: next || '' }, 'PUT')).then(() => {
      if (overrides.current.get(id)?.seq === mine) overrides.current.set(id, { team: next, seq: mine, savedAt: Date.now() });
    }, e => {
      if (overrides.current.get(id)?.seq !== mine) return;
      overrides.current.delete(id); setSaveError(`${person.name}: shift not saved. ${e.message}`); rerender(v => v + 1);
    });
    queues.current.set(id, run);
  }
  const card = e => <article className={`attendance-person person-${e.status.toLowerCase()} ${e.checksheetShift?.state === 'finished' ? 'shift-finished' : ''}`} key={e.id}><Portrait employee={e} updatedAt={data.updatedAt}/><div className="attendance-person-details"><strong>{e.name}</strong>{!data.canSetShiftTeam && e.shiftTeam && <small>Shift {e.shiftTeam}</small>}{data.group.id === 'all' && e.attendanceGroup && <small>{e.attendanceGroup}</small>}{e.checksheetShift && <small>{e.checksheetShift.state === 'finished' ? 'Shift finished' : e.checksheetShift.state === 'grace' ? 'Shift ending' : 'On shift'} · {e.checksheetShift.line} · {e.checksheetShift.overtime ? 'WITH OT' : 'NO OT'}</small>}<small>{e.productionGroup?.label || 'Production group not assigned'}</small>{e.assignment && <small>Planned: {e.assignment.line} · {e.assignment.shift_name}</small>}<small>{e.team ? `Team ${e.team}` : 'Team unassigned'} · {e.line}</small>{e.clockedInAt && <small>Clocked in {new Date(e.clockedInAt).toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' })}</small>}{data.canSetShiftTeam && <div className="attendance-shift-setup" role="group" aria-label={`Shift for ${e.name}`}><span>Shift</span>{['A', 'B'].map(team => <button key={team} type="button" aria-pressed={e.shiftTeam === team} onClick={() => setShiftTeam(e, team)}>{team}</button>)}</div>}</div></article>;
  return <section className="attendance-page" data-update-blocked={[...overrides.current.values()].some(item => !item.savedAt)}>
    <div className="section-head"><div><h1>Attendance</h1><p>Current clock-in status for your production group. Refreshes every 15 seconds.</p></div><button className="btn secondary" disabled={busy} onClick={() => setAttempt(v => v + 1)}><RefreshCw size={18}/><Swap id={busy}>{busy ? 'Refreshing…' : 'Refresh'}</Swap></button></div>
    {groups.length > 1 && <label className="field attendance-group"><span>Production group</span><SmoothSelect ariaLabel="Production group" items={groups.map(g => ({value:g.id,label:g.label}))} value={group || data?.group.id || groups[0].id} onChange={select}/></label>}
    {error && <div className="connection-banner" role="alert">{error}{data && ' Showing the last successful update; these counts may be outdated.'}</div>}
    {saveError && <div className="connection-banner" role="alert">{saveError}</div>}
    {!data && !error && <PageSkeleton variant="people" label="Loading attendance"/>}
    {data && <><div className="attendance-caption"><strong><Users size={20}/>{data.group.label}</strong><span role="status">{outdated ? 'Outdated · ' : ''}Updated {time(data.updatedAt)} MYT</span></div>
      <div className={`attendance-stats ${outdated ? 'attendance-outdated' : ''}`}>{[['in', 'Present'], ['out', 'Absent']].map(([key, label]) => <article key={key} className={`attendance-stat attendance-${key}`}><span>{label}</span><strong><Num value={data[key]}/></strong></article>)}</div>
      <p className="hint">Present = clocked in now (Smart Attendance). Absent includes people on the other shift or rest day.{data.canSetShiftTeam ? ' Tap A or B on a card to set that person’s shift; tap again to clear.' : ''}</p>
      <div className="attendance-tools"><label className="attendance-search"><Search size={18}/><input aria-label="Search employees" placeholder="Search name, team or shift…" value={search} onChange={e => setSearch(e.target.value)}/></label><SlideGroup className="attendance-filters" aria-label="Filter attendance" selector="[aria-pressed=true]">{[['ALL', 'Everyone'], ['IN', 'Present'], ['OUT', 'Absent']].map(([value, label]) => <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}</SlideGroup></div>
      <span className="attendance-result-count">{visible.length} of {data.total} employees</span>
      {!data.total ? <div className="notice">No active production employees match this attendance group. Ask your administrator to check the line mapping.</div> : !visible.length ? <div className="notice">No employees match this search and status.</div> : sections.map(([status, label, list]) => <section key={status} className={`attendance-section attendance-section-${status.toLowerCase()}`}><h2>{label} · {list.length}</h2><div className={`attendance-people ${outdated ? 'attendance-outdated' : ''}`}>{list.map(card)}</div></section>)}
    </>}
  </section>;
}
