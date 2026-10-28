import SmoothSelect from './SmoothSelect.jsx';
import { useEffect, useState } from 'react';
import { api } from './api.js';

export default function ManualShiftFields({ form, set, line }) {
  const [people, setPeople] = useState(null), [error, setError] = useState(''), [attempt, retry] = useState(0);
  useEffect(() => {
    let disposed = false;
    setPeople(null); setError('');
    api(`/manpower?line=${encodeURIComponent(line)}`).then(result => { if (!disposed) setPeople(result.people); }).catch(e => { if (!disposed) setError(e.message); });
    return () => { disposed = true; };
  }, [line, attempt]);
  const used = name => ['forming', 'waterjet', 'assembly'].some(key => form[key].includes(name)) || form.quality === name;
  return <><div className="notice" role="status">{error ? <>{error} <button type="button" className="text-btn" onClick={() => retry(v => v + 1)}>Retry</button></> : people ? 'Select your shift team.' : 'Loading names…'}</div><div className="form-grid">
    <label className="field"><span>Production date</span><input type="date" required value={form.date} onChange={event => set('date', event.target.value)}/></label>
    <label className="field"><span>Shift</span><SmoothSelect ariaLabel="Shift" items={['Day','Night']} value={form.shift} onChange={value => set('shift', value)}/></label>
    <label className="checkbox"><input type="checkbox" checked={form.overtime} onChange={event => set('overtime', event.target.checked)}/>Overtime (OT)</label>
    <div className="working-preview">{form.shift === 'Day' ? form.overtime ? '08:00 – 20:00' : '08:00 – 16:15' : form.overtime ? '20:00 – 08:00 (+1 day)' : '16:15 – 00:30 (+1 day)'}</div>
    {[['supervisor', 'Supervisor', 'supervisors'], ['leader', 'Line leader', 'leaders']].map(([key, label, source]) => <label className="field" key={key}><span>{label}</span><SmoothSelect ariaLabel={label} items={people?.[source] || []} value={form[key]} onChange={value => set(key, value)} placeholder="Select name"/></label>)}
    {['forming', 'waterjet', 'assembly'].map(key => <div className="field" key={key}><span>{key[0].toUpperCase() + key.slice(1)} operators</span><SmoothSelect ariaLabel={`${key} operators`} required={!form[key].length} items={(people?.[key] || []).filter(name => !used(name))} value="" onChange={name => set(key, [...form[key], name])} placeholder={form[key].length ? 'Add operator' : 'Select operator'}/><div className="shift-name-chips">{form[key].map(name => <button type="button" key={name} onClick={() => set(key, form[key].filter(n => n !== name))} aria-label={`Remove ${name}`}>{name}<span aria-hidden="true">×</span></button>)}</div></div>)}
    <label className="field"><span>Quality inspector</span><SmoothSelect ariaLabel="Quality inspector" items={(people?.quality || []).filter(name => !used(name) || form.quality === name)} value={form.quality} onChange={name => set('quality', name)} placeholder="Select name"/></label>
  </div></>;
}
