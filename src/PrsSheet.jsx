import './prs-sheet.css';
import { useEffect, useState } from 'react';
import { CheckCheck, PenLine } from 'lucide-react';
import { splitReason } from '../shared/downtimeCodes.js';
import { prsLines, prsColumns, prsColumnFor, prsTotals, prsModelTotals } from './prsLines.js';

// Live Checksheet laid out like the paper PRS (FR-PR, REV1): shift header, one row per hour slot with model, lot,
// plan vs actual and that hour's downtime per category (code + minutes), SPV sign-off per hour, then shift verification.
const time = value => new Date(value).toLocaleTimeString('en-GB', { timeZone: 'Asia/Kuala_Lumpur', hour: '2-digit', minute: '2-digit' });
const slotLabel = slot => String(slot || '—').replace('-', ' – ');
const names = value => Array.isArray(value) ? value.join(', ') : value || '';
const signed = (value, prefix = '') => `${prefix}${value > 0 ? '+' : ''}${value}`;

function DowntimeCell({ items, rowSpan, className = '' }) {
  if (!items?.length) return <td className={`prs-dt prs-dt-none ${className}`} rowSpan={rowSpan}>—</td>;
  return <td className={`prs-dt ${className}`} rowSpan={rowSpan}>{items.map(item => { const { code, description } = splitReason(item); return <div key={item.id} title={`${item.category}: ${item.reason}${item.action ? ` · Action: ${item.action}` : ''}`}><b>{item.category === 'Planned Stop' ? 'PS' : code}</b><span>{code ? description : item.reason}</span><em>{item.duration}′</em></div>; })}</td>;
}

// SPV signs each hour: first tap arms the button, the second tap within 4 s signs with the signed-in name and time.
function SignCell({ slot, record, sign, rowSpan }) {
  const [armed, setArmed] = useState(false), [busy, setBusy] = useState(false);
  useEffect(() => { if (!armed) return; const timer = setTimeout(() => setArmed(false), 4000); return () => clearTimeout(timer); }, [armed]);
  if (record) return <td className="prs-sign signed" rowSpan={rowSpan}><strong>✓ {record.actor}</strong><small>{time(record.createdAt)}</small></td>;
  if (!sign) return <td className="prs-sign" rowSpan={rowSpan}><span className="prs-unsigned">Not signed</span></td>;
  return <td className="prs-sign" rowSpan={rowSpan}><button type="button" className={`prs-sign-btn ${armed ? 'armed' : ''}`} disabled={busy} onClick={async () => { if (!armed) return setArmed(true); setBusy(true); try { await sign(slot); } finally { setBusy(false); setArmed(false); } }}><PenLine size={18}/>{busy ? 'Signing…' : armed ? 'Tap to confirm' : 'Sign'}</button></td>;
}

// The PRS hour table, used as is by the Live Checksheet and the TV board. One row per hour like the paper form: when an
// hour has several lots (or models), lot, plan, actual and +/− are stacked inside that row; a model that does not change
// is shown once.
export function PrsTable({ lines, totals, sign, className = '' }) {
  const hours = lines.reduce((list, line) => { const last = list.at(-1); if (last?.[0].slot === line.slot) last.push(line); else list.push([line]); return list; }, []);
  const stack = (rows, render, cls = () => '') => rows.map(r => <div key={r.id} className={`prs-stack ${cls(r)}`}>{render(r)}</div>);
  const diff = r => Number(r.actual || 0) - Number(r.plan || 0);
  return <table className={`prs-table ${className}`}>
    <thead>
      <tr><th rowSpan={2}>No</th><th rowSpan={2}>Time</th><th rowSpan={2}>Model</th><th rowSpan={2}>Lot number</th><th colSpan={3} className="prs-group">Prod. qty (pcs)</th><th colSpan={4} className="prs-group">Downtime (code · min)</th><th rowSpan={2} className="prs-sign-head">SPV<br/>verification</th></tr>
      <tr><th>Plan</th><th>Actual</th><th>+/−</th>{prsColumns.map(key => <th key={key} className={`prs-dt-head dt-${key.toLowerCase()}`}>{key}</th>)}</tr>
    </thead>
    <tbody>{hours.map(rows => {
      const [r] = rows, live = rows.some(line => line.live), rest = rows.find(line => line.restMinutes > 0)?.restMinutes, oneModel = new Set(rows.map(line => line.model || '')).size === 1;
      return <tr key={r.slot} className={live ? 'live-row' : ''}>
      <td className="prs-no">{r.no}</td>
      <td className="prs-time"><strong>{slotLabel(r.slot)}</strong>{live ? <span className="prs-live">LIVE</span> : rest > 0 ? <small>Break {rest}′</small> : null}</td>
      <td className="prs-model">{oneModel ? r.model || '—' : stack(rows, line => line.model || '—')}</td><td className="mono">{stack(rows, line => line.lot || '—')}</td>
      <td className="num">{stack(rows, line => line.empty ? '—' : line.plan)}</td><td className="num strong">{stack(rows, line => line.empty ? '—' : line.actual)}</td><td className="num">{stack(rows, line => line.empty ? '—' : signed(diff(line)), line => line.empty ? '' : diff(line) >= 0 ? 'positive' : 'negative')}</td>
      {prsColumns.map(key => <DowntimeCell key={key} items={rows.flatMap(line => line.downtime).filter(d => prsColumnFor(d.category) === key)}/>)}
      <SignCell slot={r.slot} record={rows.find(line => line.signed)?.signed} sign={sign}/>
    </tr>; })}</tbody>
    {totals && <tfoot><tr><td colSpan={4}>Total</td><td className="num">{totals.plan}</td><td className="num">{totals.actual}</td><td className={`num ${totals.actual >= totals.plan ? 'positive' : 'negative'}`}>{signed(totals.actual - totals.plan)}</td>{prsColumns.map(key => <td key={key} className="num">{totals.minutes[key] ? `${totals.minutes[key]} min` : '—'}</td>)}<td className="num">{totals.signed} / {totals.hours}</td></tr></tfoot>}
  </table>;
}

// Total output of each model this shift, under the hour table.
function ModelTotals({ models }) {
  if (!models.length) return null;
  return <div className="prs-models"><h3>Output by model</h3><div className="table-scroll"><table className="prs-table prs-model-table">
    <thead><tr><th>Model</th><th>Lot number</th><th>Plan</th><th>Actual</th><th>+/−</th></tr></thead>
    <tbody>{models.map(m => { const diff = m.actual - m.plan; return <tr key={m.model}><td className="prs-model">{m.model}</td><td className="mono">{m.lots.join(', ') || '—'}</td><td className="num">{m.plan}</td><td className="num strong">{m.actual}</td><td className={`num ${diff >= 0 ? 'positive' : 'negative'}`}>{signed(diff)}</td></tr>; })}</tbody>
  </table></div></div>;
}

export default function PrsSheet({ state, rows, manage, tv, open, action }) {
  const shift = state.shift;
  const lines = prsLines(state, rows);
  const shiftChecks = state.verification.filter(v => !v.hour);
  const sign = !tv && manage && shift && action ? slot => action('verify', { hour: slot }) : null;
  const latest = shiftChecks.at(-1);
  return <div className="prs">
    <div className="prs-header">
      {[['Prod line', state.line], ['Shift', shift ? `${shift.shift}${shift.overtime ? ' · OT' : ''}` : ''], ['Date', shift?.date], ['Working time', shift?.workingTime], ['SPV', shift?.supervisor], ['Leader', shift?.leader], ['Forming opt', names(shift?.forming)], ['Waterjet opt', names(shift?.waterjet)], ['Assembly opt', names(shift?.assembly)], ['Quality inspector', names(shift?.quality)]].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value || '—'}</strong></div>)}
    </div>
    <div className="table-scroll"><PrsTable lines={lines} totals={lines.length ? prsTotals(lines) : null} sign={sign}/></div>
    <ModelTotals models={prsModelTotals(lines)}/>
    {!lines.length && <p className="prs-empty">No hours recorded yet. Rows appear here as each hour is recorded.</p>}
    <div className={`prs-verify ${latest ? latest.status === 'verified' ? 'ok' : 'issue' : 'pending'}`}>
      <div><span>Shift verification</span><strong>{latest ? latest.status === 'verified' ? 'Verified' : 'Issue raised' : 'Pending'}</strong><small>{latest ? `${latest.actor} · ${time(latest.createdAt)}${latest.remarks ? ` · ${latest.remarks}` : ''}` : 'A supervisor checks and verifies this record before the shift closes.'}</small></div>
      {!tv && manage && <button className="btn secondary" disabled={!shift} onClick={() => open('verify')}><CheckCheck size={18}/>Verify record</button>}
    </div>
    {shiftChecks.length > 1 && <ul className="prs-verify-history">{shiftChecks.slice(0, -1).reverse().map(v => <li key={v.id}>{v.status === 'verified' ? 'Verified' : 'Issue'} · {v.actor} · {time(v.createdAt)}{v.remarks ? ` · ${v.remarks}` : ''}</li>)}</ul>}
  </div>;
}
