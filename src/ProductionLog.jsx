import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Download, RefreshCw } from 'lucide-react';
import { api, lineUrl } from './api.js';
import { PageSkeleton } from './ui.jsx';
import './production-log.css';

// Production log: when each piece came out, as a running-total line per counter, with stops (gaps) shaded and listed.
// Time the server received nothing is hatched grey ("No data"), never shown as a stop.
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(new Date(Date.now() - 8 * 3600000));
const clock = (ms, seconds = true) => new Date(ms).toLocaleTimeString('en-GB', { timeZone: 'Asia/Kuala_Lumpur', hour: '2-digit', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}), hourCycle: 'h23' });
const minutes = s => s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.round(s % 3600 / 60)} min` : s >= 60 ? `${Math.round(s / 60)} min` : `${s} s`;
const colors = { output: '#3987e5', forming: '#d95926', waterjet: '#199e70' };
// Same rule as the server (productionLog.js gapRule): 3 x the standard cycle (minutes per piece), else 5 minutes.
const limitFor = (cycle, rule) => Number(cycle) > 0 ? Math.round(cycle * 60 * rule.cycleMultiple) : rule.fallbackSeconds;
const ends = { piece: 'Production restarted', now: 'Still stopped', 'no data': 'No data after this' };
const ago = s => s < 60 ? 'under a minute ago' : s < 3600 ? `${Math.floor(s / 60)} min ago` : `${minutes(s)} ago`;

function Chart({ log, shown, focus }) {
  const box = useRef(null), [width, setWidth] = useState(800), [hover, setHover] = useState(null);
  useLayoutEffect(() => { const el = box.current; if (!el) return; const ro = new ResizeObserver(([e]) => setWidth(Math.max(300, e.contentRect.width))); ro.observe(el); return () => ro.disconnect(); }, []);
  const series = Object.entries(log.counters).filter(([key]) => shown.includes(key));
  const firstCover = log.coverage[0]?.from, lastCover = log.coverage.at(-1)?.to;
  const x0 = Math.min(...[Date.parse(log.shift.startAt), firstCover].filter(Number.isFinite)), x1 = log.live ? Date.now() : Math.max(...[lastCover, ...series.map(([, c]) => c.ticks.at(-1)?.at)].filter(Number.isFinite));
  // A line starts where its data starts: pieces counted before the log began (catch-up) are a starting level, not a jump from 0.
  const startOf = ticks => ticks[0]?.catchup ? ticks[0].total : (ticks[0]?.total || 0) - (ticks[0]?.qty || 0);
  const yMax = Math.max(1, ...series.map(([, c]) => Math.max(...c.ticks.map(t => t.total)))), lowest = Math.min(...series.map(([, c]) => startOf(c.ticks)));
  const h = 300, m = { l: 48, r: 16, t: 12, b: 28 }, iw = width - m.l - m.r, ih = h - m.t - m.b;
  const step = Math.max(1, Math.ceil((yMax - Math.min(lowest, yMax - 1)) / 4)), yMin = Math.floor(Math.max(0, lowest) / step) * step;
  const sx = t => m.l + (t - x0) / Math.max(1, x1 - x0) * iw, sy = v => m.t + ih - (v - yMin) / Math.max(1, yMax - yMin) * ih;
  const yTicks = Array.from({ length: Math.floor((yMax - yMin) / step) + 1 }, (_, i) => yMin + i * step);
  // Time labels every 5 min … 2 h, whichever gives at most about 8 (Malaysia has no DST, so whole steps from the epoch land on round times).
  const every = [5, 10, 15, 30, 60, 120].map(n => n * 60000).find(n => (x1 - x0) / n <= 8) || 7200000, xTicks = []; for (let t = Math.ceil(x0 / every) * every; t <= x1; t += every) xTicks.push(t);
  const edges = xTicks.length < 2;
  const holes = []; let at = x0; for (const c of log.coverage) { if (c.from - at > 15000) holes.push([at, c.from]); at = Math.max(at, c.to); } if (!log.live && x1 - at > 15000) holes.push([at, x1]);
  const path = ticks => `M${sx(ticks[0]?.catchup ? ticks[0].at : x0).toFixed(1)},${sy(startOf(ticks)).toFixed(1)}` + ticks.map(t => `H${sx(t.at).toFixed(1)}V${sy(t.total).toFixed(1)}`).join('') + `H${sx(x1).toFixed(1)}`;
  const gaps = log.gaps.filter(g => shown.includes(g.counter));
  function move(event) {
    const rect = event.currentTarget.getBoundingClientRect(), px = event.clientX - rect.left; if (px < m.l || px > m.l + iw) return setHover(null);
    const t = x0 + (px - m.l) / iw * (x1 - x0);
    setHover({ px, t, totals: series.map(([key, c]) => [key, c.label, c.ticks.filter(k => k.at <= t).at(-1)?.total || 0]), gap: gaps.find(g => g.from <= t && g.to >= t), hole: holes.some(([a, b]) => a <= t && b >= t) });
  }
  return <div className="production-chart" ref={box}>
    <svg width={width} height={h} role="img" aria-label={`Running total of pieces from ${clock(x0, false)} to ${clock(x1, false)}`} onPointerMove={move} onPointerDown={move} onPointerLeave={event => { if (event.pointerType === 'mouse') setHover(null); }}>
      <defs><pattern id="nodata-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="var(--text-3)" strokeOpacity=".35" strokeWidth="2"/></pattern></defs>
      {yTicks.map(v => <g key={v}><line x1={m.l} x2={m.l + iw} y1={sy(v)} y2={sy(v)} className="grid"/><text x={m.l - 8} y={sy(v) + 4} textAnchor="end" className="axis">{v}</text></g>)}
      {(edges ? [x0, x1] : xTicks).map((t, i) => <text key={t} x={sx(t)} y={h - 8} textAnchor={edges ? (i ? 'end' : 'start') : 'middle'} className="axis">{clock(t, false)}</text>)}
      {holes.map(([a, b]) => <rect key={a} x={sx(a)} y={m.t} width={Math.max(1, sx(b) - sx(a))} height={ih} fill="url(#nodata-hatch)"/>)}
      {gaps.map(g => <rect key={g.counter + g.from} x={sx(g.from)} y={m.t} width={Math.max(2, sx(g.to) - sx(g.from))} height={ih} className={`gap${focus === g.counter + g.from ? ' focused' : ''}`}/>)}
      {series.map(([key, c]) => <path key={key} d={path(c.ticks)} fill="none" stroke={colors[key]} strokeWidth="2" strokeLinejoin="round"/>)}
      {hover && <line x1={hover.px} x2={hover.px} y1={m.t} y2={m.t + ih} className="crosshair"/>}
    </svg>
    {hover && <div className="production-tooltip" style={{ left: Math.min(hover.px + 12, width - 190) }}><strong>{clock(hover.t)}</strong>{hover.totals.map(([key, label, total]) => <span key={key}><i style={{ background: colors[key] }}/>{label}: {total} pcs</span>)}{hover.gap && <em className="gap-text">Stopped {minutes(hover.gap.seconds)} ({clock(hover.gap.from, false)} – {clock(hover.gap.to, false)})</em>}{hover.hole && <em>No data received</em>}</div>}
  </div>;
}

export default function ProductionLog({ line }) {
  const [date, setDate] = useState(today), [list, setList] = useState(null), [shift, setShift] = useState(''), [log, setLog] = useState(null), [error, setError] = useState(''), [attempt, retry] = useState(0);
  const [shown, setShown] = useState(null), [gapSort, setGapSort] = useState('time'), [pieceSort, setPieceSort] = useState('newest'), [limit, setLimit] = useState(200);
  useEffect(() => { let off = false; setList(null); setError(''); api(`/production-log/shifts?date=${encodeURIComponent(date)}`).then(next => { if (off) return; setList(next); setShift(current => next.shifts.some(s => s.id === current) ? current : next.shifts.at(-1)?.id || ''); }).catch(e => !off && setError(e.message)); return () => { off = true; }; }, [line, date, attempt]);
  useEffect(() => { let off = false; setLog(null); if (!shift) return; api(`/production-log?shift=${encodeURIComponent(shift)}`).then(next => { if (off) return; setLog(next); setShown(current => current?.filter(k => next.counters[k])?.length ? current : Object.keys(next.counters)); }).catch(e => !off && setError(e.message)); return () => { off = true; }; }, [line, shift, attempt]);
  // While the shift is running, fetch again every 20 s without blanking the page, so a stop shows up as it happens.
  useEffect(() => { if (!log?.live) return; const timer = setInterval(() => api(`/production-log?shift=${encodeURIComponent(shift)}`).then(setLog).catch(() => {}), 20000); return () => clearInterval(timer); }, [log?.live, shift, line]);
  const [focus, setFocus] = useState(''), chartRef = useRef(null);
  const pieces = useMemo(() => {
    if (!log) return [];
    const rows = Object.entries(log.counters).filter(([key]) => shown?.includes(key)).flatMap(([key, c]) => { let prev = null; return c.ticks.map(t => { const row = { ...t, key, label: c.label, since: prev && t.qty > 0 && !t.catchup ? Math.round((t.at - prev) / 1000) : null }; if (t.qty > 0 && !t.catchup) prev = t.at; return row; }); });
    return rows.sort((a, b) => pieceSort === 'newest' ? b.at - a.at : a.at - b.at);
  }, [log, shown, pieceSort]);
  const gaps = (log?.gaps || []).filter(g => shown?.includes(g.counter)).slice().sort((a, b) => gapSort === 'time' ? a.from - b.from : b.seconds - a.seconds);
  const keys = log ? Object.keys(log.counters) : [];
  const toggle = key => setShown(current => current.includes(key) ? current.length > 1 ? current.filter(k => k !== key) : current : keys.filter(k => k === key || current.includes(k)));
  const stopped = gaps.reduce((sum, g) => sum + g.seconds, 0), longest = gaps.reduce((a, g) => g.seconds > (a?.seconds || 0) ? g : a, null);
  const stopLimit = log ? limitFor(log.shift.cycle, log.gapRule) : 0;
  const last = log && shown ? Math.max(0, ...Object.entries(log.counters).filter(([key]) => shown.includes(key)).flatMap(([, c]) => c.ticks.filter(t => t.qty > 0 && !t.catchup).map(t => t.at))) : 0;
  const idle = last ? Math.round(((log.live ? Date.now() : log.coverage.at(-1)?.to || last) - last) / 1000) : 0, halted = log?.live && last && idle > stopLimit;
  const showStop = g => { setFocus(g.counter + g.from); chartRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  return <div className="production-log"><div className="page-intro"><div><h1>Production log</h1><p>When each piece came out on {line}. Shaded areas show where the line stopped.</p></div>
    <div className="production-actions">{log && <a className="btn secondary" href={lineUrl(`/production-log.csv?shift=${encodeURIComponent(shift)}`, line)} download><Download size={17}/>CSV</a>}<button className="btn secondary" onClick={() => retry(v => v + 1)}><RefreshCw size={17}/>Refresh</button></div></div>
    <div className="panel shift-history-filters"><label className="field"><span>Production date</span><input type="date" value={date} max={today()} onChange={e => e.target.value && setDate(e.target.value)}/></label>
      {list?.shifts.length > 0 && <label className="field"><span>Shift</span><select value={shift} onChange={e => setShift(e.target.value)}>{list.shifts.map(s => <option key={s.id} value={s.id}>{s.shift ? `${s.shift} shift` : s.id}{s.model ? `, ${s.model}` : ''}</option>)}</select></label>}
      {keys.length > 1 && <div className="field"><span>Counters</span><div className="production-counters" role="group" aria-label="Counters shown">{keys.map(key => <button key={key} type="button" aria-pressed={shown?.includes(key)} onClick={() => toggle(key)}><i style={{ background: colors[key] }}/>{log.counters[key].label}</button>)}</div></div>}</div>
    {error && <div className="notice" role="alert">{error}</div>}
    {list?.manual && !list.shifts.length && <p className="hint shift-history-empty">Not available. {line} has no sensor, so piece times are not recorded.</p>}
    {list && !list.manual && !list.shifts.length && <p className="hint shift-history-empty">No production recorded for {line} on this date.</p>}
    {(!list || shift && !log) && !error && <PageSkeleton variant="table" label="Loading production log"/>}
    {log && shown && <>
      <div className="production-stats"><div className={`panel production-last ${halted ? 'halted' : ''}`} role="status"><span>{halted && <AlertTriangle size={16}/>}{log.live ? halted ? 'Stopped' : 'Running' : 'Shift ended'}</span><strong>{last ? clock(last, false) : '—'}</strong><small>{!last ? 'No piece yet' : log.live ? `Last piece ${ago(idle)}` : 'Last piece of the shift'}</small></div>{keys.filter(k => shown.includes(k)).map(key => <div className="panel" key={key}><span><i style={{ background: colors[key] }}/>{log.counters[key].label}</span><strong>{log.counters[key].total}</strong><small>pcs{log.live ? ' so far' : ''}</small></div>)}
        <div className="panel"><span>Stops</span><strong>{gaps.length}</strong><small>{gaps.length ? `${minutes(stopped)} in total` : 'none'}</small></div>
        <div className="panel"><span>Longest stop</span><strong>{longest ? minutes(longest.seconds) : '—'}</strong><small>{longest ? `from ${clock(longest.from, false)}` : 'none'}</small></div></div>
      <section className="panel production-chart-panel" ref={chartRef}><header><h2>Running total</h2><div className="production-legend">{shown.length > 1 && shown.map(key => <span key={key}><i style={{ background: colors[key] }}/>{log.counters[key].label}</span>)}<span><i className="legend-gap"/>Stopped</span><span><i className="legend-nodata"/>No data</span></div></header><Chart log={log} shown={shown} focus={focus}/></section>
      <section className="panel production-table"><header><div><h2>Stops ({gaps.length})</h2><p className="hint">A stop is {minutes(stopLimit)} or more with no piece{log.shift.cycle ? ` (3 × the ${log.shift.cycle} min cycle time)` : ''}. Tap a stop to see it on the chart.</p></div><div className="production-sort" role="group" aria-label="Sort stops">{[['time', 'By time'], ['longest', 'Longest first']].map(([v, l]) => <button key={v} type="button" className={`btn ${gapSort === v ? 'primary' : 'secondary'}`} onClick={() => setGapSort(v)}>{l}</button>)}</div></header>
        {gaps.length ? <div className="table-wrap"><table><thead><tr><th>From</th><th>To</th><th>Stopped</th>{keys.length > 1 && <th>Counter</th>}<th>Ended by</th></tr></thead><tbody>{gaps.map(g => <tr key={g.counter + g.from} tabIndex={0} className={`clickable ${focus === g.counter + g.from ? 'focused' : ''}`} onClick={() => showStop(g)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); showStop(g); } }}><td>{clock(g.from)}</td><td>{clock(g.to)}</td><td><strong>{minutes(g.seconds)}</strong></td>{keys.length > 1 && <td>{log.counters[g.counter].label}</td>}<td>{ends[g.until] || g.until}</td></tr>)}</tbody></table></div> : <p className="hint">No stops longer than the limit.</p>}</section>
      <section className="panel production-table"><header><h2>Every piece ({pieces.filter(p => p.qty > 0).reduce((s, p) => s + p.qty, 0)} pcs)</h2><div className="production-sort" role="group" aria-label="Sort pieces">{[['newest', 'Newest first'], ['oldest', 'Oldest first']].map(([v, l]) => <button key={v} type="button" className={`btn ${pieceSort === v ? 'primary' : 'secondary'}`} onClick={() => setPieceSort(v)}>{l}</button>)}</div></header>
        <div className="table-wrap"><table><thead><tr><th>Time</th>{keys.length > 1 && <th>Counter</th>}<th>Pieces</th><th>Total</th><th>Since last piece</th></tr></thead><tbody>{pieces.slice(0, limit).map(p => <tr key={p.key + p.at + p.total} className={p.since > limitFor(p.cycle ?? log.shift.cycle, log.gapRule) ? 'late' : ''} title={p.since > limitFor(p.cycle ?? log.shift.cycle, log.gapRule) ? 'Longer than a stop' : undefined}><td>{clock(p.at)}</td>{keys.length > 1 && <td>{p.label}</td>}<td>{p.qty > 0 ? `+${p.qty}` : p.qty}</td><td>{p.total}</td><td>{p.catchup ? 'Counted while no data was received' : p.qty < 0 ? 'Count corrected' : p.since == null ? '—' : minutes(p.since)}</td></tr>)}</tbody></table></div>
        {pieces.length > limit && <button className="btn secondary production-more" onClick={() => setLimit(v => v + 500)}>Show more ({pieces.length - limit} left)</button>}</section>
    </>}
  </div>;
}
