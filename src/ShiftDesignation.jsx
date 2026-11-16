import { useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { api } from './api.js';

// Shift A/B designation table, one table per attendance group (like the paper attendance sheet).
// Changes show at once and save in the background; a failed save puts the old value back.
export default function ShiftDesignation({ people, canEdit }) {
  const [overrides, setOverrides] = useState({}); // id -> { team, pending }
  const [selected, setSelected] = useState(() => new Set());
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('ALL');
  const [error, setError] = useState('');
  const queue = useRef(Promise.resolve());
  const latest = useRef({});

  // Drop a confirmed change once the refreshed list shows the same value.
  useEffect(() => {
    setOverrides(old => {
      const next = { ...old };
      for (const person of people) if (next[person.id] && !next[person.id].pending && (person.shiftTeam || null) === next[person.id].team) delete next[person.id];
      return next;
    });
  }, [people]);

  const teamOf = person => (person.id in overrides ? overrides[person.id].team : person.shiftTeam) || null;
  const pending = Object.values(overrides).some(item => item.pending);

  function apply(ids, team) {
    if (!ids.length) return;
    const stamp = {};
    for (const id of ids) { stamp[id] = (latest.current[id] || 0) + 1; latest.current[id] = stamp[id]; }
    setOverrides(old => ({ ...old, ...Object.fromEntries(ids.map(id => [id, { team, pending: true }])) }));
    setError('');
    queue.current = queue.current.then(() => api('/executive/shift-teams', { changes: ids.map(employeeId => ({ employeeId, team: team || '' })) }, 'PUT')).then(() => {
      setOverrides(old => {
        const next = { ...old };
        for (const id of ids) if (latest.current[id] === stamp[id]) next[id] = { team, pending: false };
        return next;
      });
    }, e => {
      setOverrides(old => {
        const next = { ...old };
        for (const id of ids) if (latest.current[id] === stamp[id]) delete next[id];
        return next;
      });
      setError(`Shift not saved. ${e.message}`);
    });
  }

  function toggle(person, team) { apply([person.id], teamOf(person) === team ? null : team); }
  function setSelectedTeam(team) { apply([...selected], team); setSelected(new Set()); }
  function pick(ids, on) { setSelected(old => { const next = new Set(old); for (const id of ids) on ? next.add(id) : next.delete(id); return next; }); }

  const term = search.trim().toLowerCase();
  const shown = people.filter(p => {
    const team = teamOf(p);
    return (filter === 'ALL' || (filter === 'NONE' ? !team : team === filter)) && `${p.id} ${p.name} ${p.line} ${p.attendanceGroup || ''}`.toLowerCase().includes(term);
  });
  const groups = [...new Set(shown.map(p => p.attendanceGroup || 'Other'))].sort().map(label => [label, shown.filter(p => (p.attendanceGroup || 'Other') === label).sort((a, b) => a.name.localeCompare(b.name))]);
  const count = team => people.filter(p => teamOf(p) === team).length;

  return <section className="panel shift-designation" data-update-blocked={pending}>
    <div className="section-head"><div><h2>Shift designation</h2><p>{canEdit ? 'Tap A or B for each person. It saves straight away. Tick several people to set them together.' : 'Shift A or B for each person. Only an executive can change it.'}</p></div></div>
    <div className="shift-designation-summary">{[['A', 'Shift A'], ['B', 'Shift B'], [null, 'Not set']].map(([team, label]) => <span key={label}><strong>{count(team)}</strong>{label}</span>)}</div>
    <div className="shift-designation-tools">
      <label className="shift-designation-search"><Search size={18}/><input aria-label="Search employees" placeholder="Search name or employee no.…" value={search} onChange={e => setSearch(e.target.value)}/></label>
      <div className="shift-designation-filter" role="group" aria-label="Show">{[['ALL', 'Everyone'], ['NONE', 'Not set'], ['A', 'Shift A'], ['B', 'Shift B']].map(([value, label]) => <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}</div>
    </div>
    {error && <div className="connection-banner" role="alert">{error}</div>}
    {canEdit && selected.size > 0 && <div className="shift-designation-bulk" role="region" aria-label="Selected employees"><strong>{selected.size} selected</strong><button type="button" className="btn primary" onClick={() => setSelectedTeam('A')}>Set shift A</button><button type="button" className="btn primary" onClick={() => setSelectedTeam('B')}>Set shift B</button><button type="button" className="btn secondary" onClick={() => setSelectedTeam(null)}>Clear shift</button><button type="button" className="text-btn" onClick={() => setSelected(new Set())}>Cancel</button></div>}
    {!groups.length && <p>{people.length ? 'No employees match this search.' : 'No employees in this group.'}</p>}
    {groups.map(([label, list]) => {
      const ids = list.map(p => p.id), all = ids.every(id => selected.has(id));
      return <div className="shift-designation-group" key={label}>
        <h3>{label} <span>· {list.length}</span></h3>
        <div className="table-scroll"><table>
          <thead><tr>{canEdit && <th className="shift-designation-check"><input type="checkbox" aria-label={`Select all in ${label}`} checked={all} onChange={e => pick(ids, e.target.checked)}/></th>}<th>No.</th><th>Employee no.</th><th>Name</th><th>Line</th><th>Now</th><th>Shift</th></tr></thead>
          <tbody>{list.map((p, i) => {
            const team = teamOf(p);
            return <tr key={p.id} className={selected.has(p.id) ? 'selected' : ''}>
              {canEdit && <td className="shift-designation-check"><input type="checkbox" aria-label={`Select ${p.name}`} checked={selected.has(p.id)} onChange={e => pick([p.id], e.target.checked)}/></td>}
              <td>{i + 1}</td><td>{p.id}</td><td><strong>{p.name}</strong></td><td>{p.line}</td>
              <td className={p.status === 'IN' ? 'shift-designation-in' : 'shift-designation-out'}>{p.status === 'IN' ? 'Present' : 'Absent'}</td>
              <td>{canEdit
                ? <div className="shift-designation-choice" role="group" aria-label={`Shift for ${p.name}`}>{['A', 'B'].map(value => <button key={value} type="button" aria-pressed={team === value} onClick={() => toggle(p, value)}>{value}</button>)}</div>
                : team ? `Shift ${team}` : 'Not set'}</td>
            </tr>;
          })}</tbody>
        </table></div>
      </div>;
    })}
  </section>;
}
