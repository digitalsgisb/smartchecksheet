import SmoothSelect from './SmoothSelect.jsx';
import { useState } from 'react';

export default function ManualShiftFields({ form, set }) {
  const [names, setNames] = useState(() => Object.fromEntries(['forming', 'waterjet', 'assembly'].map(key => [key, (form[key] || []).join(', ')])));
  function operatorNames(key, value) {
    setNames(current => ({ ...current, [key]: value }));
    set(key, value.split(/[,;\n]+/).map(name => name.trim()).filter(Boolean));
  }
  return <><div className="notice">Enter the actual people assigned to this line. Separate multiple operator names with commas.</div><div className="form-grid">
    <label className="field"><span>Production date</span><input type="date" required value={form.date} onChange={event => set('date', event.target.value)}/></label>
    <label className="field"><span>Shift</span><SmoothSelect ariaLabel="Shift" items={['Day','Night']} value={form.shift} onChange={value => set('shift', value)}/></label>
    <label className="checkbox"><input type="checkbox" checked={form.overtime} onChange={event => set('overtime', event.target.checked)}/>Overtime (OT)</label>
    <div className="working-preview">{form.shift === 'Day' ? form.overtime ? '08:00 – 20:00' : '08:00 – 16:15' : form.overtime ? '20:00 – 08:00 (+1 day)' : '16:15 – 00:30 (+1 day)'}</div>
    {[['supervisor', 'Supervisor'], ['leader', 'Line leader']].map(([key, label]) => <label className="field" key={key}><span>{label}</span><input required maxLength={80} value={form[key]} onChange={event => set(key, event.target.value)}/></label>)}
    {['forming', 'waterjet', 'assembly'].map(key => <label className="field" key={key}><span>{key[0].toUpperCase() + key.slice(1)} operators</span><input required maxLength={500} value={names[key]} onChange={event => operatorNames(key, event.target.value)} placeholder="Enter names separated by commas"/></label>)}
    <label className="field"><span>Quality inspector</span><input required maxLength={80} value={form.quality} onChange={event => set('quality', event.target.value)}/></label>
  </div></>;
}
