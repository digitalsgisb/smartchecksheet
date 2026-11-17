import { useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { api } from './api.js';
import { useFlip } from './ui.jsx';

const SHIFTS = [['A', 'Shift A'], ['B', 'Shift B'], ['N', 'Normal (N)']];
const shiftLabel = team => SHIFTS.find(([value]) => value === team)?.[1] || (team ? `Team ${team}` : 'Not set');

// Shift (A/B/N) and line for each person, one table per line (like the paper attendance sheet).
// Both are saved in Smart Attendance. Changes show at once; a failed save puts the old value back.
export default function ShiftDesignation({ people, canEdit, lineOptions = [], onSaved = () => {} }) {
  const flip = useFlip();
  const [overrides, setOverrides] = useState({}); // id -> { team?, group?, pending }
  const [selected, setSelected] = useState(() => new Set());
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('ALL');
  const [error, setError] = useState('');
  const queue = useRef(Promise.resolve());
  const latest = useRef({});

  // Drop a confirmed change once the refreshed list shows it (or the person has moved out of this view).
  useEffect(() => {
    const byId = new Map(people.map(p => [p.id, p]));
    setOverrides(old => {
      const next = { ...old };
      for (const [id, item] of Object.entries(next)) {
        if (item.pending) continue;
        const person = byId.get(id);
        if (!person || (('team' in item ? (person.team || '') === item.team : true) && ('group' in item ? person.attendanceGroupId === item.group : true))) delete next[id];
      }
      return next;
    });
  }, [people]);

  const teamOf = p => (overrides[p.id] && 'team' in overrides[p.id] ? overrides[p.id].team : p.team) || '';
  const groupOf = p => (overrides[p.id] && 'group' in overrides[p.id] ? overrides[p.id].group : p.attendanceGroupId) || '';
  const groupLabel = id => lineOptions.find(o => o.id === id)?.label || people.find(p => p.attendanceGroupId === id)?.attendanceGroup || 'Other';
  const pending = Object.values(overrides).some(item => item.pending);
  const plants = new Set(lineOptions.map(o => o.plant)).size > 1;

  function apply(ids, change) {
    if (!ids.length) return;
    const stamp = {};
    for (const id of ids) { stamp[id] = (latest.current[id] || 0) + 1; latest.current[id] = stamp[id]; }
    setOverrides(old => ({ ...old, ...Object.fromEntries(ids.map(id => [id, { ...(old[id] || {}), ...change, pending: true }])) }));
    setError('');
    queue.current = queue.current.then(() => api('/executive/shift-teams', { changes: ids.map(employeeId => ({ employeeId, ...change })) }, 'PUT')).then(() => {
      setOverrides(old => {
        const next = { ...old };
        for (const id of ids) if (latest.current[id] === stamp[id] && next[id]) next[id] = { ...next[id], pending: false };
        return next;
      });
      onSaved();
    }, e => {
      setOverrides(old => {
        const next = { ...old };
        for (const id of ids) if (latest.current[id] === stamp[id]) delete next[id];
        return next;
      });
      setError(`Not saved. ${e.message}`);
    });
  }

  function toggle(person, team) { apply([person.id], { team: teamOf(person) === team ? '' : team }); }
  // Supervisors keep their Attendance line; only their shift is set here.
  function bulk(change) { apply([...selected].filter(id => !('group' in change) || !people.find(p => p.id === id)?.supervisor), change); setSelected(new Set()); }
  function pick(ids, on) { setSelected(old => { const next = new Set(old); for (const id of ids) on ? next.add(id) : next.delete(id); return next; }); }

  const term = search.trim().toLowerCase();
  const shown = people.filter(p => {
    const team = teamOf(p);
    return (filter === 'ALL' || (filter === 'NONE' ? !['A', 'B', 'N'].includes(team) : team === filter)) && `${p.id} ${p.name} ${p.line} ${p.position || ''} ${groupLabel(groupOf(p))}`.toLowerCase().includes(term);
  });
  const order = lineOptions.map(o => o.id);
  const supervisors = shown.filter(p => p.supervisor).sort((a, b) => a.name.localeCompare(b.name)), crew = shown.filter(p => !p.supervisor);
  const groups = [...new Set(crew.map(groupOf))].sort((a, b) => ((order.indexOf(a) + 1) || 999) - ((order.indexOf(b) + 1) || 999)).map(id => [id, crew.filter(p => groupOf(p) === id).sort((a, b) => a.name.localeCompare(b.name))]);
  const count = team => people.filter(p => team === null ? !['A', 'B', 'N'].includes(teamOf(p)) : teamOf(p) === team).length;
  const lineSelect = (value, onChange, label, placeholder = 'Choose line…') => <select className="shift-designation-line" aria-label={label} value={value} onChange={e => onChange(e.target.value)}>{!value && <option value="">{placeholder}</option>}{lineOptions.map(o => <option key={o.id} value={o.id}>{o.label}{plants && o.plant ? ` · ${o.plant}` : ''}</option>)}</select>;

  const table = (key, label, list, spv) => {
    const ids = list.map(p => p.id), all = ids.every(id => selected.has(id));
    return <div className={`shift-designation-group${spv ? ' shift-designation-supervisors' : ''}`} key={key}>
      <h3 data-flip={`h:${key}`}>{label} <span>· {list.length}</span></h3>
      <div className="table-scroll"><table>
        <thead><tr data-flip={`th:${key}`}>{canEdit && <th className="shift-designation-check"><input type="checkbox" aria-label={`Select all in ${label}`} checked={all} onChange={e => pick(ids, e.target.checked)}/></th>}<th>No.</th><th>Employee no.</th><th>Name</th><th>{spv ? 'Position' : 'Line'}</th><th>Now</th><th>Shift</th></tr></thead>
        <tbody>{list.map((p, i) => {
          const team = teamOf(p);
          return <tr key={p.id} data-flip={p.id} className={selected.has(p.id) ? 'selected' : ''}>
            {canEdit && <td className="shift-designation-check"><input type="checkbox" aria-label={`Select ${p.name}`} checked={selected.has(p.id)} onChange={e => pick([p.id], e.target.checked)}/></td>}
            <td>{i + 1}</td><td>{p.id}</td><td><strong>{p.name}</strong></td>
            <td>{spv ? p.position || 'Supervisor' : canEdit ? lineSelect(groupOf(p), group => group !== groupOf(p) && apply([p.id], { group }), `Line for ${p.name}`) : label}</td>
            <td className={p.status === 'IN' ? 'shift-designation-in' : 'shift-designation-out'}>{p.status === 'IN' ? 'Present' : 'Absent'}</td>
            <td>{canEdit
              ? <div className="shift-designation-choice" role="group" aria-label={`Shift for ${p.name}`}>{SHIFTS.map(([value, title]) => <button key={value} type="button" title={title} aria-pressed={team === value} onClick={() => toggle(p, value)}>{value}</button>)}</div>
              : shiftLabel(team)}</td>
          </tr>;
        })}</tbody>
      </table></div>
    </div>;
  };

  return <section ref={flip} className="panel shift-designation" data-update-blocked={pending}>
    <div className="section-head"><div><h2>Shift and line</h2><p>{canEdit ? 'Tap A, B or N (normal hours) and pick the line. Supervisors have their own table at the top. Saved straight into Smart Attendance. Tick several people to change them together.' : 'Shift and line for each person, from Smart Attendance. Only an executive or developer can change them.'}</p></div></div>
    <div className="shift-designation-summary">{[...SHIFTS, [null, 'Not set']].map(([team, label]) => <span key={label}><strong>{count(team)}</strong>{label}</span>)}</div>
    <div className="shift-designation-tools">
      <label className="shift-designation-search"><Search size={18}/><input aria-label="Search employees" placeholder="Search name or employee no.…" value={search} onChange={e => setSearch(e.target.value)}/></label>
      <div className="shift-designation-filter" role="group" aria-label="Show">{[['ALL', 'Everyone'], ['NONE', 'Not set'], ['A', 'A'], ['B', 'B'], ['N', 'N']].map(([value, label]) => <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}</div>
    </div>
    {error && <div className="connection-banner" role="alert">{error}</div>}
    {canEdit && selected.size > 0 && <div className="shift-designation-bulk" role="region" aria-label="Selected employees">
      <strong>{selected.size} selected</strong>
      {SHIFTS.map(([team]) => <button key={team} type="button" className="btn primary" onClick={() => bulk({ team })}>Set {team}</button>)}
      {lineSelect('', group => group && bulk({ group }), 'Move selected to line', 'Move to line…')}
      <button type="button" className="text-btn" onClick={() => setSelected(new Set())}>Cancel</button>
    </div>}
    {!shown.length && <p>{people.length ? 'No employees match this search.' : 'No employees in this group.'}</p>}
    {supervisors.length > 0 && table('supervisors', 'Supervisors', supervisors, true)}
    {groups.map(([groupId, list]) => table(groupId || 'none', groupLabel(groupId), list, false))}
  </section>;
}
