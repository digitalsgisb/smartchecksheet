import { useEffect, useState } from 'react';
import { ClipboardCheck, Cpu, RefreshCw, Server } from 'lucide-react';
import { api } from './api.js';
import { PageSkeleton } from './ui.jsx';
import './shift-history.css';
import SmoothSelect from './SmoothSelect.jsx';

// Shift History: what happened on one line on one production date (Day shift 08:00 to the end of its Night shift), in time order.
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(new Date(Date.now() - 8 * 3600000));
const clock = iso => new Date(iso).toLocaleTimeString('en-GB', { timeZone: 'Asia/Kuala_Lumpur', hour: '2-digit', minute: '2-digit' });
const day = iso => new Date(iso).toLocaleDateString('en-GB', { timeZone: 'Asia/Kuala_Lumpur', day: 'numeric', month: 'short' });
const sources = { tablet: { label: 'Tablet', icon: ClipboardCheck }, pi: { label: 'Pi', icon: Cpu }, server: { label: 'Checksheet', icon: Server } };
const badge = item => item.refused ? 'danger' : item.status === 'Accepted' ? 'success' : item.status ? 'amber' : '';

export default function ShiftHistory({ line }) {
  const [date, setDate] = useState(today), [data, setData] = useState(null), [error, setError] = useState(''), [shift, setShift] = useState(''), [attempt, retry] = useState(0);
  useEffect(() => {
    let disposed = false; setError(''); setData(null); setShift('');
    api(`/shift-history?date=${encodeURIComponent(date)}`).then(next => { if (!disposed) setData(next); }).catch(e => { if (!disposed) setError(e.message); });
    return () => { disposed = true; };
  }, [line, date, attempt]);
  const items = data?.items.filter(item => !shift || item.shiftId === shift) || [];
  return <div className="shift-history"><div className="page-intro"><div><h1>Shift history</h1><p>Everything sent to and reported by {line} for one production date, in time order.</p></div><button className="btn secondary" onClick={() => retry(v => v + 1)}><RefreshCw size={17}/>Refresh</button></div>
    <div className="panel shift-history-filters"><label className="field"><span>Production date</span><input type="date" value={date} max={today()} onChange={e => e.target.value && setDate(e.target.value)}/></label>
      {data?.shifts.length > 1 && <label className="field"><span>Shift</span><SmoothSelect required={false} ariaLabel="Shift" placeholder="All shifts" items={[{ value: '', label: 'All shifts' }, ...data.shifts]} value={shift} onChange={setShift}/></label>}</div>
    {error && <div className="notice" role="alert">{error}</div>}
    {!data && !error && <PageSkeleton variant="list" label="Loading shift history"/>}
    {data && !items.length && <p className="hint shift-history-empty">Nothing recorded for {line} on this date.</p>}
    {data && items.length > 0 && <ol className="panel shift-history-list">{items.map(item => { const Icon = sources[item.source]?.icon || Server; return <li key={item.source + item.id} className={item.refused ? 'refused' : ''}>
      <time dateTime={item.at}><strong>{clock(item.at)}</strong><small>{day(item.at)}</small></time>
      <span className="shift-history-source" title={sources[item.source]?.label}><Icon size={16}/>{sources[item.source]?.label}</span>
      <div><p className="shift-history-title">{item.title}{item.status && <span className={`badge ${badge(item)}`}>{item.status}</span>}</p>
        {(item.detail || item.note) && <p className="shift-history-detail">{[item.detail, item.note && `Pi: ${item.note}`].filter(Boolean).join(' · ')}</p>}
        {(item.actor || item.shiftId) && <small>{[item.actor, item.shiftId].filter(Boolean).join(' · ')}</small>}</div>
    </li>; })}</ol>}
  </div>;
}
