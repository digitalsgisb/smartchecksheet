import { useEffect, useState } from 'react';
import { api } from './api.js';
import SmoothSelect from './SmoothSelect.jsx';

export default function ShiftBoardFields({ form, set, line }) {
  const [data, setData] = useState(null), [error, setError] = useState('');
  useEffect(() => {
    let disposed = false;
    api('/shift-board/options').then(result => { if (!disposed) setData(result); }).catch(e => { if (!disposed) setError(e.message); });
    return () => { disposed = true; };
  }, [line]);
  const selected = form.attendanceEmployeeIds || [];
  return <fieldset><legend>Attendance shift board</legend><p className="hint">Selected employees follow this shift’s OT and finish time. Their cards turn grey after the grace period. Clock-in/out records stay separate.</p>
    <label className="field"><span>Turn grey after shift ends</span><SmoothSelect ariaLabel="Shift board grace period" items={[{ value: 15, label: '15 minutes after' }, { value: 30, label: '30 minutes after (default)' }]} value={form.boardGraceMinutes || 30} onChange={value => set('boardGraceMinutes', Number(value))}/></label>
    {error && <p className="form-error" role="status">{error} Production shift entry is still available; employee links cannot be changed until Attendance returns.</p>}
    {data && !data.feedEnabled && <p className="hint">Configure the shift-feed connection on both servers to enable board updates. Demo shifts are never sent to Attendance.</p>}
    {data && <><p className="hint">Choose the Attendance employees actually working this shift. Names and IDs come from this line’s division and site.</p><div className="operator-picker">{data.employees.map(person => <label key={person.id}><input type="checkbox" checked={selected.includes(person.id)} onChange={e => { set('attendanceEmployeeIds', e.target.checked ? [...selected, person.id] : selected.filter(id => id !== person.id)); if (form.boardGraceMinutes === undefined) set('boardGraceMinutes', 30); }}/>{person.name} · {person.id} · {person.group}</label>)}</div>{!data.employees.length && <p>No active employees match this line, site and division. Check Attendance employee profiles and the production group mapping.</p>}</>}
    {!!selected.length && <p className="hint">{selected.length} employees linked to this shift.</p>}
    {data && selected.filter(id => !data.employees.some(person => person.id === id)).map(id => <label className="checkbox" key={id}><input type="checkbox" checked onChange={() => set('attendanceEmployeeIds', selected.filter(value => value !== id))}/>Employee {id} is no longer available in this group. Uncheck to remove the link.</label>)}
  </fieldset>;
}
