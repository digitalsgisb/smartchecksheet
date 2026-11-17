import './prs-sheet.css';
import { CheckCheck } from 'lucide-react';
import { splitReason } from '../shared/downtimeCodes.js';

// Live Checksheet laid out like the paper PRS (FR-PR, REV1): shift header, one row per hour slot with model, lot,
// plan vs actual and that hour's downtime per category (code + minutes), then SPV verification.
const time = value => new Date(value).toLocaleTimeString('en-GB', { timeZone: 'Asia/Kuala_Lumpur', hour: '2-digit', minute: '2-digit' });
const slotLabel = slot => String(slot || '—').replace('-', ' – ');
const slotStart = slot => { const h = Number(String(slot).match(/^(\d{1,2})/)?.[1]); return Number.isFinite(h) ? h : 99; };
const columns = [['Schedule', 'Schedule'], ['Production', 'Production'], ['Machine', 'Machine'], ['Quality', 'Quality']];
const columnFor = category => category === 'Planned Stop' ? 'Schedule' : category;
const names = value => Array.isArray(value) ? value.join(', ') : value || '';

function DowntimeCell({ items }) {
  if (!items?.length) return <td className="prs-dt prs-dt-none">—</td>;
  return <td className="prs-dt">{items.map(item => { const { code, description } = splitReason(item); return <div key={item.id} title={`${item.category}: ${item.reason}${item.action ? ` · Action: ${item.action}` : ''}`}><b>{item.category === 'Planned Stop' ? 'PS' : code}</b><span>{code ? description : item.reason}</span><em>{item.duration}′</em></div>; })}</td>;
}

export default function PrsSheet({ state, rows, manage, tv, open }) {
  const shift = state.shift;
  // Shift hours run from the shift start (8.00 or 20.00 / 16.15) through midnight, so order slots by hours since 08:00.
  const order = slot => (slotStart(slot) - 8 + 24) % 24;
  const slots = [...new Set([...rows.map(r => r.slot), ...state.downtime.map(d => d.slot)].filter(Boolean))].sort((a, b) => order(a) - order(b));
  // Downtime sits on the last model segment of its hour (a model change splits an hour into segments).
  const lines = slots.flatMap(slot => { const segments = rows.filter(r => r.slot === slot); return (segments.length ? segments : [{ id: `slot-${slot}`, slot, empty: true }]).map((row, index, all) => ({ ...row, downtime: index === all.length - 1 ? state.downtime.filter(d => d.slot === slot) : [] })); });
  const byColumn = (items, key) => items.filter(d => columnFor(d.category) === key);
  const totals = { plan: rows.reduce((n, r) => n + Number(r.plan || 0), 0), actual: rows.reduce((n, r) => n + Number(r.actual || 0), 0) };
  const minutes = key => byColumn(state.downtime, key).reduce((n, d) => n + Number(d.duration || 0), 0);
  const latest = state.verification.at(-1);
  return <div className="prs">
    <div className="prs-header">
      {[['Prod line', state.line], ['Shift', shift ? `${shift.shift}${shift.overtime ? ' · OT' : ''}` : ''], ['Date', shift?.date], ['Working time', shift?.workingTime], ['SPV', shift?.supervisor], ['Leader', shift?.leader], ['Forming opt', names(shift?.forming)], ['Waterjet opt', names(shift?.waterjet)], ['Assembly opt', names(shift?.assembly)], ['Quality inspector', names(shift?.quality)]].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value || '—'}</strong></div>)}
    </div>
    <div className="table-scroll"><table className="prs-table">
      <thead>
        <tr><th rowSpan={2}>No</th><th rowSpan={2}>Time</th><th rowSpan={2}>Model</th><th rowSpan={2}>Lot number</th><th colSpan={3} className="prs-group">Prod. qty (pcs)</th><th colSpan={4} className="prs-group">Downtime (code · min)</th></tr>
        <tr><th>Plan</th><th>Actual</th><th>+/−</th>{columns.map(([key, label]) => <th key={key} className={`prs-dt-head dt-${key.toLowerCase()}`}>{label}</th>)}</tr>
      </thead>
      <tbody>{lines.map((r, i) => { const diff = Number(r.actual || 0) - Number(r.plan || 0); return <tr key={r.id} className={r.live ? 'live-row' : ''}>
        <td className="prs-no">{i + 1}</td>
        <td className="prs-time"><strong>{slotLabel(r.slot)}</strong>{r.live ? <span className="prs-live">LIVE</span> : r.restMinutes > 0 ? <small>Break {r.restMinutes}′</small> : null}</td>
        <td className="prs-model">{r.model || '—'}</td><td className="mono">{r.lot || '—'}</td>
        <td className="num">{r.empty ? '—' : r.plan}</td><td className="num strong">{r.empty ? '—' : r.actual}</td><td className={`num ${r.empty ? '' : diff >= 0 ? 'positive' : 'negative'}`}>{r.empty ? '—' : `${diff > 0 ? '+' : ''}${diff}`}</td>
        {columns.map(([key]) => <DowntimeCell key={key} items={byColumn(r.downtime, key)}/>)}
      </tr>; })}</tbody>
      {lines.length > 0 && <tfoot><tr><td colSpan={4}>Total</td><td className="num">{totals.plan}</td><td className="num">{totals.actual}</td><td className={`num ${totals.actual >= totals.plan ? 'positive' : 'negative'}`}>{totals.actual - totals.plan > 0 ? '+' : ''}{totals.actual - totals.plan}</td>{columns.map(([key]) => <td key={key} className="num">{minutes(key) ? `${minutes(key)} min` : '—'}</td>)}</tr></tfoot>}
    </table></div>
    {!lines.length && <p className="prs-empty">No hours recorded yet. Rows appear here as each hour is recorded.</p>}
    <div className={`prs-verify ${latest ? latest.status === 'verified' ? 'ok' : 'issue' : 'pending'}`}>
      <div><span>SPV verification</span><strong>{latest ? latest.status === 'verified' ? 'Verified' : 'Issue raised' : 'Pending'}</strong><small>{latest ? `${latest.actor} · ${time(latest.createdAt)}${latest.remarks ? ` · ${latest.remarks}` : ''}` : 'A supervisor checks and verifies this record before the shift closes.'}</small></div>
      {!tv && manage && <button className="btn secondary" disabled={!shift} onClick={() => open('verify')}><CheckCheck size={18}/>Verify record</button>}
    </div>
    {state.verification.length > 1 && <ul className="prs-verify-history">{state.verification.slice(0, -1).reverse().map(v => <li key={v.id}>{v.status === 'verified' ? 'Verified' : 'Issue'} · {v.actor} · {time(v.createdAt)}{v.remarks ? ` · ${v.remarks}` : ''}</li>)}</ul>}
  </div>;
}
