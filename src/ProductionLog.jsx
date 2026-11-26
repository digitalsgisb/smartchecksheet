import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, ArrowRight, ChevronLeft, ChevronRight, Download, RefreshCw } from 'lucide-react';
import { api, lineUrl } from './api.js';
import { PageSkeleton } from './ui.jsx';
import './production-log.css';

// Production log: when each piece came out, as hourly bars and a running-total line per counter, with stops (gaps) shaded and listed.
// Tapping an hour filters the page to that hour. Time the server received nothing is hatched grey ("No data"), never shown as a stop.
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(new Date(Date.now() - 8 * 3600000));
const clock = (ms, seconds = true) => new Date(ms).toLocaleTimeString('en-GB', { timeZone: 'Asia/Kuala_Lumpur', hour: '2-digit', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}), hourCycle: 'h23' });
const minutes = s => s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.round(s % 3600 / 60)} min` : s >= 60 ? `${Math.round(s / 60)} min` : `${s} s`;
const colors = { output: '#3987e5', forming: '#d95926', waterjet: '#199e70' };
// Same rule as the server (productionLog.js gapRule): 3 x the standard cycle (minutes per piece), else 5 minutes.
const limitFor = (cycle, rule) => Number(cycle) > 0 ? Math.round(cycle * 60 * rule.cycleMultiple) : rule.fallbackSeconds;
const ends = { piece: 'Production restarted', now: 'Still stopped', 'no data': 'No data after this' };
const ago = s => s < 60 ? 'under a minute ago' : s < 3600 ? `${Math.floor(s / 60)} min ago` : `${minutes(s)} ago`;
const hourLabel = h => `${clock(h.from, false)} – ${clock(h.to, false)}`;
// Piece times to the second: "45 s", "3 min 40 s"; longer ones in whole minutes.
const dur = s => s < 60 ? `${s} s` : s < 600 ? `${Math.floor(s / 60)} min${s % 60 ? ` ${s % 60} s` : ''}` : minutes(s);
const cycleText = c => `${Number(c.toFixed(2))} min`;
// Slow pieces: the time from the previous piece to this one is longer than the model's standard cycle time (minutes per piece).
// A piece right after a no-data stretch has no reliable start, so it is not judged.
function slowPieces(ticks, fallbackCycle) {
  const slow = []; let prev = null;
  for (const t of ticks) {
    if (t.catchup) { prev = null; continue; }
    if (t.qty <= 0) continue;
    const cycle = Number(t.cycle ?? fallbackCycle);
    if (prev && cycle > 0) { const seconds = Math.round((t.at - prev) / 1000); if (seconds > cycle * 60) slow.push({ from: prev, to: t.at, seconds, cycle, over: seconds - Math.round(cycle * 60) }); }
    prev = t.at;
  }
  return slow;
}

function Chart({ log, shown, focus, range }) {
  const box = useRef(null), [width, setWidth] = useState(800), [hover, setHover] = useState(null);
  useLayoutEffect(() => { const el = box.current; if (!el) return; const ro = new ResizeObserver(([e]) => setWidth(Math.max(300, e.contentRect.width))); ro.observe(el); return () => ro.disconnect(); }, []);
  const series = Object.entries(log.counters).filter(([key]) => shown.includes(key));
  const firstCover = log.coverage[0]?.from, lastCover = log.coverage.at(-1)?.to;
  const x0 = range ? range.from : Math.min(...[Date.parse(log.shift.startAt), firstCover].filter(Number.isFinite)), x1 = range ? range.to : log.live ? Date.now() : Math.max(...[lastCover, ...series.map(([, c]) => c.ticks.at(-1)?.at)].filter(Number.isFinite));
  // Whole shift: the shift's running total; a line starts where its data starts (catch-up pieces are a starting level, not a jump from 0).
  // One hour: pieces in that hour counted up from 0, so the line ends at the hour's bar.
  const lines = series.map(([key, c]) => {
    const slow = slowPieces(c.ticks, log.shift.cycle);
    if (range) { let sum = 0; return { key, label: c.label, slow, from: x0, start: 0, pts: c.ticks.filter(t => !t.catchup && t.at >= x0 && t.at <= x1).map(t => ({ at: t.at, qty: t.qty, total: sum += t.qty })) }; }
    return { key, label: c.label, slow, from: c.ticks[0]?.catchup ? c.ticks[0].at : x0, start: c.ticks[0]?.catchup ? c.ticks[0].total : (c.ticks[0]?.total || 0) - (c.ticks[0]?.qty || 0), pts: c.ticks };
  });
  const yMax = Math.max(1, ...lines.flatMap(l => [l.start, ...l.pts.map(p => p.total)])), lowest = range ? 0 : Math.min(...lines.map(l => l.start));
  const h = 300, m = { l: 48, r: 16, t: 12, b: 28 }, iw = width - m.l - m.r, ih = h - m.t - m.b;
  const step = Math.max(1, Math.ceil((yMax - Math.min(lowest, yMax - 1)) / 4)), yMin = Math.floor(Math.max(0, lowest) / step) * step;
  const sx = t => m.l + (t - x0) / Math.max(1, x1 - x0) * iw, sy = v => m.t + ih - (v - yMin) / Math.max(1, yMax - yMin) * ih;
  const yTicks = Array.from({ length: Math.floor((yMax - yMin) / step) + 1 }, (_, i) => yMin + i * step);
  // Time labels every 5 min … 2 h, whichever gives at most about 8 (Malaysia has no DST, so whole steps from the epoch land on round times).
  const every = [5, 10, 15, 30, 60, 120].map(n => n * 60000).find(n => (x1 - x0) / n <= 8) || 7200000, xTicks = []; for (let t = Math.ceil(x0 / every) * every; t <= x1; t += every) xTicks.push(t);
  const edges = xTicks.length < 2;
  const running = log.live && Date.now() - x1 < 15000;
  const holes = []; let at = x0; for (const c of log.coverage) { if (c.to < x0) continue; if (c.from - at > 15000) holes.push([at, Math.min(c.from, x1)]); at = Math.max(at, c.to); } if (!running && x1 - at > 15000) holes.push([at, x1]);
  const clip = ([a, b]) => [Math.max(a, x0), Math.min(b, x1)];
  const path = l => `M${sx(l.from).toFixed(1)},${sy(l.start).toFixed(1)}` + l.pts.map(p => `H${sx(p.at).toFixed(1)}V${sy(p.total).toFixed(1)}`).join('') + `H${sx(x1).toFixed(1)}`;
  const gaps = log.gaps.filter(g => shown.includes(g.counter) && g.to > x0 && g.from < x1);
  // Each slow piece (one-hour view only; across a whole shift it would paint most of the line): the wait before it is drawn amber.
  const slows = !range ? [] : lines.flatMap(l => l.slow.filter(s => s.to >= x0 && s.to <= x1).map(s => { const p = l.pts.find(q => q.at === s.to); return p ? { ...s, key: l.key, level: p.total - p.qty, a: Math.max(s.from, x0) } : null; }).filter(Boolean));
  function move(event) {
    const rect = event.currentTarget.getBoundingClientRect(), px = event.clientX - rect.left; if (px < m.l || px > m.l + iw) return setHover(null);
    const t = x0 + (px - m.l) / iw * (x1 - x0);
    setHover({ px, t, totals: lines.map(l => [l.key, l.label, l.pts.filter(p => p.at <= t).at(-1)?.total ?? l.start]), gap: gaps.find(g => g.from <= t && g.to >= t), hole: holes.some(([a, b]) => a <= t && b >= t), slow: slows.find(s => s.a <= t && s.to >= t) });
  }
  return <div className="production-chart" ref={box}>
    <svg width={width} height={h} role="img" aria-label={`${range ? 'Pieces in this hour' : 'Running total of pieces'} from ${clock(x0, false)} to ${clock(x1, false)}`} onPointerMove={move} onPointerDown={move} onPointerLeave={event => { if (event.pointerType === 'mouse') setHover(null); }}>
      <defs><pattern id="nodata-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="var(--text-3)" strokeOpacity=".35" strokeWidth="2"/></pattern></defs>
      {yTicks.map(v => <g key={v}><line x1={m.l} x2={m.l + iw} y1={sy(v)} y2={sy(v)} className="grid"/><text x={m.l - 8} y={sy(v) + 4} textAnchor="end" className="axis">{v}</text></g>)}
      {(edges ? [x0, x1] : xTicks).map((t, i) => <text key={t} x={sx(t)} y={h - 8} textAnchor={edges ? (i ? 'end' : 'start') : 'middle'} className="axis">{clock(t, false)}</text>)}
      {holes.map(clip).filter(([a, b]) => b > a).map(([a, b]) => <rect key={a} x={sx(a)} y={m.t} width={Math.max(1, sx(b) - sx(a))} height={ih} fill="url(#nodata-hatch)"/>)}
      {gaps.map(g => { const [a, b] = clip([g.from, g.to]); return <rect key={g.counter + g.from} x={sx(a)} y={m.t} width={Math.max(2, sx(b) - sx(a))} height={ih} className={`gap${focus === g.counter + g.from ? ' focused' : ''}`}/>; })}
      {lines.map(l => <path key={l.key} d={path(l)} fill="none" stroke={colors[l.key]} strokeWidth="2" strokeLinejoin="round"/>)}
      {slows.map(s => <line key={s.key + s.to} x1={sx(s.a)} x2={sx(s.to)} y1={sy(s.level)} y2={sy(s.level)} className="slow-run"/>)}
      {range && slows.filter(s => sx(s.to) - sx(s.a) > 58).map(s => <text key={'t' + s.key + s.to} x={(sx(s.a) + sx(s.to)) / 2} y={sy(s.level) - 7} textAnchor="middle" className="slow-label">{dur(s.seconds)}</text>)}
      {hover && <line x1={hover.px} x2={hover.px} y1={m.t} y2={m.t + ih} className="crosshair"/>}
    </svg>
    {hover && <div className="production-tooltip" style={{ left: Math.min(hover.px + 12, width - 190) }}><strong>{clock(hover.t)}</strong>{hover.totals.map(([key, label, total]) => <span key={key}><i style={{ background: colors[key] }}/>{label}: {total} pcs</span>)}{hover.gap && <em className="gap-text">Stopped {minutes(hover.gap.seconds)} ({clock(hover.gap.from, false)} – {clock(hover.gap.to, false)})</em>}{hover.slow && <em className="gap-text">This piece took {dur(hover.slow.seconds)}, cycle {cycleText(hover.slow.cycle)}</em>}{hover.hole && <em>No data received</em>}</div>}
  </div>;
}

// One column per clock hour: a bar per counter, the hour's target as a line, and what was logged against that hour.
// With a mouse (or keyboard focus) a box shows the hour's details; a tap or click opens the hour below.
function HourBars({ log, shown, selected, pick }) {
  const wrap = useRef(null), scroller = useRef(null), [tip, setTip] = useState(null);
  // Scale to what was made and the finished hours' targets. The running hour's targets can be far above that (a slow line,
  // or only minutes into the hour) and would flatten every bar, so its target is pinned to the top with its number instead.
  const max = Math.max(1, ...log.hours.flatMap(h => [...shown.map(k => h.counts[k] || 0), h.inProgress ? 0 : h.plan || 0])) * 1.25;
  const main = shown.includes('output') ? 'output' : shown[0];
  // The box sits beside the column (right, or left near the right edge) so the hour's own numbers stay visible.
  const show = (h, el) => { const box = wrap.current?.getBoundingClientRect(), col = el.getBoundingClientRect(); if (!box) return; const right = col.right - box.left + 8 + 240 <= box.width; setTip({ h, x: right ? col.right - box.left + 8 : col.left - box.left - 8, side: right ? 'right' : 'left' }); };
  const hover = tip && log.hours.find(h => h.from === tip.h.from);
  return <div className="hour-chart" ref={wrap}>
    <div className="hour-bars" ref={scroller} onScroll={() => setTip(null)} role="group" aria-label="Output per hour. Tap an hour to see its log.">{log.hours.map(h => {
      const mark = h.inProgress ? h.target : h.plan, count = h.counts[main] || 0, short = !h.inProgress && h.plan != null && !h.noData && count < h.plan ? count - h.plan : 0;
      return <button key={h.from} type="button" className={`hour-col${selected === h.from ? ' selected' : ''}${h.noData ? ' no-data' : ''}`} aria-pressed={selected === h.from} onClick={() => { setTip(null); pick(selected === h.from ? null : h.from); }}
        onPointerEnter={event => { if (event.pointerType === 'mouse') show(h, event.currentTarget); }} onPointerLeave={() => setTip(null)} onFocus={event => { if (event.currentTarget.matches(':focus-visible')) show(h, event.currentTarget); }} onBlur={() => setTip(null)}
        aria-label={`${hourLabel(h)}: ${h.noData ? 'no data' : `${count} pieces`}${mark ? `, target ${mark}` : ''}${h.inProgress ? ', in progress' : ''}`}>
        <span className="hour-count">{h.noData ? 'No data' : count}</span>
        <span className={`hour-short${short < 0 && count < h.plan * 0.85 ? ' far' : ''}`}>{short < 0 ? short : ''}</span>
        <span className="hour-plot">
          {h.noData ? <span className="hour-hatch"/> : shown.map(k => <span key={k} className="hour-bar" style={{ height: `${Math.min((h.counts[k] || 0) / max, 1) * 100}%`, background: colors[k] }}/>)}
          {mark > 0 && !h.noData && <span className={`hour-target${h.inProgress ? ' faded' : ''}`} style={{ bottom: `${Math.min(mark / max, 1) * 100}%` }}>{mark > max && <span className="hour-target-over">{mark}</span>}</span>}
        </span>
        <span className="hour-time">{clock(h.from, false)}</span>
        {h.inProgress && <span className="hour-note">in progress</span>}
        {h.partData && <span className="hour-note">part no data</span>}
        {h.downtimeMinutes > 0 && <span className="hour-note">Downtime {h.downtimeMinutes} min</span>}
        {h.rejectCount > 0 && <span className="hour-note">Rejects {h.rejectCount}</span>}
      </button>;
    })}</div>
    {hover && (() => { const h = hover, count = h.counts[main] || 0, plan = h.inProgress ? null : h.plan; return <div className={`hour-tip ${tip.side}`} role="tooltip" style={{ left: tip.x }}>
      <strong>{hourLabel(h)}{h.inProgress ? ', in progress' : ''}</strong>
      {h.noData ? <span>No data received in this hour</span> : shown.map(k => <span key={k}><i style={{ background: colors[k] }}/>{log.counters[k].label}: {h.counts[k] || 0} pcs</span>)}
      {plan != null && !h.noData && <span>Target {plan}: {count >= plan ? 'reached' : `${plan - count} short`}</span>}
      {h.inProgress && h.target > 0 && <span>Target {h.target} for a full hour</span>}
      {h.partData && <span>Part of this hour has no data</span>}
      {h.downtimeMinutes > 0 && <span>Downtime {h.downtimeMinutes} min</span>}
      {h.rejectCount > 0 && <span>Rejects {h.rejectCount} pcs</span>}
      {h.piActual != null && h.piActual !== (h.counts.output ?? h.piActual) && <span>The Pi recorded {h.piActual}</span>}
      <em>Click to see this hour</em>
    </div>; })()}
  </div>;
}

// The Overview opens the log on one shift and hour; the choice travels in sessionStorage (same tab, read once).
const openKey = 'production-log-open';
export function openProductionLog(go, line, shift, from = null) { try { sessionStorage.setItem(openKey, JSON.stringify({ line, shift, from })); } catch { /* the page still opens on today */ } go('production-log'); }
const takeOpen = line => { try { const v = JSON.parse(sessionStorage.getItem(openKey) || 'null'); sessionStorage.removeItem(openKey); return v?.line === line ? v : null; } catch { return null; } };
const shiftDate = id => { const m = /^(\d{4})(\d{2})(\d{2})-/.exec(id || ''); return m ? `${m[1]}-${m[2]}-${m[3]}` : null; };

// Overview: the current shift's output per hour and running total, read-only, with a way into the full log.
export function ProductionSummary({ line, shiftId, go }) {
  const [log, setLog] = useState(null), [missing, setMissing] = useState(false);
  useEffect(() => { let off = false; setLog(null); setMissing(false); if (!shiftId) { setMissing(true); return; } const load = () => api(`/production-log?shift=${encodeURIComponent(shiftId)}`).then(next => { if (!off) setLog(next); }).catch(() => { if (!off) setMissing(true); }); load(); const timer = setInterval(load, 20000); return () => { off = true; clearInterval(timer); }; }, [line, shiftId]);
  const shown = log ? Object.keys(log.counters) : [];
  const open = from => openProductionLog(go, line, shiftId, from);
  const head = <div className="summary-head"><div><h2>Production log</h2><p>{log ? `Pieces made each hour on this shift${log.live ? '. Updates by itself' : ''}. Tap an hour to see its full log.` : 'When each piece came out on this shift.'}</p></div><button className="btn secondary" onClick={() => open(null)}>Open production log<ArrowRight size={17}/></button></div>;
  if (missing || log && !shown.length) return <section className="panel production-summary">{head}<p className="hint">No pieces recorded for this shift yet.</p></section>;
  if (!log) return <section className="panel production-summary">{head}<PageSkeleton variant="table" label="Loading production log"/></section>;
  return <section className="panel production-summary">{head}
    <div className="summary-block"><h3>Output per hour</h3><HourBars log={log} shown={shown} selected={null} pick={from => from != null && open(from)}/></div>
    <div className="summary-block"><div className="summary-sub"><h3>Running total</h3><div className="production-legend">{shown.length > 1 && shown.map(key => <span key={key}><i style={{ background: colors[key] }}/>{log.counters[key].label}</span>)}<span><i className="legend-gap"/>Stopped</span><span><i className="legend-nodata"/>No data</span></div></div>{Object.values(log.counters).some(c => c.ticks.some(t => !t.catchup && t.qty > 0)) ? <Chart log={log} shown={shown}/> : <p className="hint">The line appears when the first piece of this shift comes out.</p>}</div>
  </section>;
}

export default function ProductionLog({ line }) {
  const [opening] = useState(() => takeOpen(line));
  const [date, setDate] = useState(() => shiftDate(opening?.shift) || today()), [list, setList] = useState(null), [shift, setShift] = useState(''), [log, setLog] = useState(null), [error, setError] = useState(''), [attempt, retry] = useState(0);
  const [shown, setShown] = useState(null), [gapSort, setGapSort] = useState('time'), [pieceSort, setPieceSort] = useState('newest'), [limit, setLimit] = useState(200), [hourFrom, setHourFrom] = useState(null);
  useEffect(() => { let off = false; setList(null); setError(''); api(`/production-log/shifts?date=${encodeURIComponent(date)}`).then(next => { if (off) return; setList(next); setShift(current => next.shifts.some(s => s.id === current) ? current : next.shifts.some(s => s.id === opening?.shift) ? opening.shift : next.shifts.at(-1)?.id || ''); }).catch(e => !off && setError(e.message)); return () => { off = true; }; }, [line, date, attempt]);
  useEffect(() => { let off = false; setLog(null); setHourFrom(null); if (!shift) return; api(`/production-log?shift=${encodeURIComponent(shift)}`).then(next => { if (off) return; setLog(next); if (opening?.shift === shift && opening.from != null && next.hours?.some(h => h.from === opening.from)) { setHourFrom(opening.from); opening.from = null; setTimeout(() => hourRef.current?.scrollIntoView({ block: 'start' }), 50); } setShown(current => current?.filter(k => next.counters[k])?.length ? current : Object.keys(next.counters)); }).catch(e => !off && setError(e.message)); return () => { off = true; }; }, [line, shift, attempt]);
  // While the shift is running, fetch again every 20 s without blanking the page, so a stop shows up as it happens. The chosen hour stays.
  useEffect(() => { if (!log?.live) return; const timer = setInterval(() => api(`/production-log?shift=${encodeURIComponent(shift)}`).then(setLog).catch(() => {}), 20000); return () => clearInterval(timer); }, [log?.live, shift, line]);
  const [focus, setFocus] = useState(''), chartRef = useRef(null), hourRef = useRef(null);
  const hours = log?.hours || [], hourIndex = hours.findIndex(h => h.from === hourFrom), hour = hourIndex >= 0 ? hours[hourIndex] : null;
  const inHour = at => !hour || at >= hour.from && (at < hour.to || hour === hours.at(-1) && at <= hour.to);
  const pieces = useMemo(() => {
    if (!log) return [];
    const rows = Object.entries(log.counters).filter(([key]) => shown?.includes(key)).flatMap(([key, c]) => { let prev = null; return c.ticks.map(t => { const row = { ...t, key, label: c.label, since: prev && t.qty > 0 && !t.catchup ? Math.round((t.at - prev) / 1000) : null }; if (t.catchup) prev = null; else if (t.qty > 0) prev = t.at; return row; }); });
    return rows.filter(r => inHour(r.at)).sort((a, b) => pieceSort === 'newest' ? b.at - a.at : a.at - b.at);
  }, [log, shown, pieceSort, hourFrom]); // eslint-disable-line react-hooks/exhaustive-deps
  const allGaps = (log?.gaps || []).filter(g => shown?.includes(g.counter));
  const gaps = allGaps.filter(g => !hour || g.to > hour.from && g.from < hour.to).sort((a, b) => gapSort === 'time' ? a.from - b.from : b.seconds - a.seconds);
  const keys = log ? Object.keys(log.counters) : [];
  const toggle = key => setShown(current => current.includes(key) ? current.length > 1 ? current.filter(k => k !== key) : current : keys.filter(k => k === key || current.includes(k)));
  const stopped = allGaps.reduce((sum, g) => sum + g.seconds, 0), longest = allGaps.reduce((a, g) => g.seconds > (a?.seconds || 0) ? g : a, null);
  const stopLimit = log ? limitFor(log.shift.cycle, log.gapRule) : 0;
  const last = log && shown ? Math.max(0, ...Object.entries(log.counters).filter(([key]) => shown.includes(key)).flatMap(([, c]) => c.ticks.filter(t => t.qty > 0 && !t.catchup).map(t => t.at))) : 0;
  const idle = last ? Math.round(((log.live ? Date.now() : log.coverage.at(-1)?.to || last) - last) / 1000) : 0, halted = log?.live && last && idle > stopLimit;
  const showStop = g => { setFocus(g.counter + g.from); chartRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  const pickHour = from => { setHourFrom(from); setFocus(''); if (from != null) setTimeout(() => hourRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0); };
  const main = shown?.includes('output') ? 'output' : shown?.[0];
  const hourDowntime = hour ? (log.downtime || []).filter(d => d.hour === hour.hour) : [], hourRejects = hour ? (log.rejects || []).filter(r => r.hour === hour.hour) : [];
  const catchupTotal = Object.entries(log?.catchup || {}).filter(([k]) => shown?.includes(k)).reduce((sum, [, n]) => sum + n, 0);
  const counted = pieces.filter(p => !p.catchup).reduce((s, p) => s + p.qty, 0);
  const hourSlow = hour && log.counters[main] ? slowPieces(log.counters[main].ticks, log.shift.cycle).filter(s => s.to >= hour.from && s.to <= hour.to) : [];
  const hourCycle = hourSlow[0]?.cycle ?? Number(log?.shift.cycle);
  return <div className="production-log"><div className="page-intro"><div><h1>Production log</h1><p>When each piece came out on {line}. Tap an hour to see its full log.</p></div>
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
        <div className="panel"><span>Stops</span><strong>{allGaps.length}</strong><small>{allGaps.length ? `${minutes(stopped)} in total` : 'none'}</small></div>
        <div className="panel"><span>Longest stop</span><strong>{longest ? minutes(longest.seconds) : '—'}</strong><small>{longest ? `from ${clock(longest.from, false)}` : 'none'}</small></div></div>
      {hours.length > 0 && <section className="panel production-chart-panel"><header><div><h2>Output per hour</h2><p className="hint">Tap an hour to see its full log below.</p></div><div className="production-legend">{shown.length > 1 && shown.map(key => <span key={key}><i style={{ background: colors[key] }}/>{log.counters[key].label}</span>)}<span><i className="legend-target"/>Target</span><span><i className="legend-nodata"/>No data</span></div></header>
        <HourBars log={log} shown={shown} selected={hourFrom} pick={pickHour}/>
        {catchupTotal > 0 && <p className="hint hour-catchup">+{catchupTotal} pcs were counted while no data was received, so they are not in any hour.</p>}</section>}
      {hour && <section className="panel hour-header" ref={hourRef}><div><span className="hint">Hour</span><h2>{hourLabel(hour)}{hour.inProgress && <span className="badge amber">In progress</span>}</h2>
          {hour.noData ? <p>No data was received in this hour.</p> : (() => { const count = hour.counts[main] || 0, plan = !hour.inProgress ? hour.plan : null; return <>
            <p className="hour-result"><strong>{count}</strong>{plan != null ? ` of ${plan} pcs` : ' pcs'}{plan != null && count < plan && <span className={`hour-gap${count < plan * 0.85 ? ' far' : ''}`}>{count - plan}</span>}</p>
            {!hour.noData && hourCycle > 0 && <p className={`hour-slow${hourSlow.length ? ' some' : ''}`}>{hourSlow.length ? `${hourSlow.length} of ${hour.counts[main] || 0} pieces took longer than the ${cycleText(hourCycle)} cycle time. The slowest took ${dur(Math.max(...hourSlow.map(s => s.seconds)))}.` : `Every piece was within the ${cycleText(hourCycle)} cycle time.`}</p>}
            {(hour.inProgress && hour.target || hour.piActual != null && hour.piActual !== (hour.counts.output ?? hour.piActual)) && <p className="hint">{hour.inProgress && hour.target ? `Target ${hour.target} for a full hour. ` : ''}{hour.piActual != null && hour.piActual !== (hour.counts.output ?? hour.piActual) ? `The Pi recorded ${hour.piActual} for this hour.` : ''}</p>}</>; })()}</div>
        <div className="hour-nav"><button className="btn secondary" aria-label="Previous hour" disabled={hourIndex <= 0} onClick={() => pickHour(hours[hourIndex - 1].from)}><ChevronLeft size={18}/></button><button className="btn secondary" aria-label="Next hour" disabled={hourIndex >= hours.length - 1} onClick={() => pickHour(hours[hourIndex + 1].from)}><ChevronRight size={18}/></button><button className="btn primary" onClick={() => { pickHour(null); window.scrollTo({ top: 0, behavior: 'smooth' }); }}><ArrowLeft size={17}/>Back to whole shift</button></div></section>}
      <section className="panel production-chart-panel" ref={chartRef}><header><h2>{hour ? 'Pieces in this hour' : 'Running total'}</h2><div className="production-legend">{shown.length > 1 && shown.map(key => <span key={key}><i style={{ background: colors[key] }}/>{log.counters[key].label}</span>)}{hour && <span><i className="legend-slow"/>Slower than cycle</span>}<span><i className="legend-gap"/>Stopped</span><span><i className="legend-nodata"/>No data</span></div></header><Chart key={hour ? hour.from : 'shift'} log={log} shown={shown} focus={focus} range={hour && { from: hour.from, to: hour.to }}/></section>
      <section className="panel production-table"><header><div><h2>Stops {hour ? 'in this hour' : ''} ({gaps.length})</h2><p className="hint">A stop is {minutes(stopLimit)} or more with no piece{log.shift.cycle ? ` (3 × the ${log.shift.cycle} min cycle time)` : ''}. Tap a stop to see it on the chart.</p></div><div className="production-sort" role="group" aria-label="Sort stops">{[['time', 'By time'], ['longest', 'Longest first']].map(([v, l]) => <button key={v} type="button" className={`btn ${gapSort === v ? 'primary' : 'secondary'}`} onClick={() => setGapSort(v)}>{l}</button>)}</div></header>
        {gaps.length ? <div className="table-wrap"><table><thead><tr><th>From</th><th>To</th><th>Stopped</th>{keys.length > 1 && <th>Counter</th>}<th>Ended by</th></tr></thead><tbody>{gaps.map(g => { const from = hour ? Math.max(g.from, hour.from) : g.from, to = hour ? Math.min(g.to, hour.to) : g.to; return <tr key={g.counter + g.from} tabIndex={0} className={`clickable ${focus === g.counter + g.from ? 'focused' : ''}`} onClick={() => showStop(g)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); showStop(g); } }}>
          <td>{clock(from)}{from > g.from && <small className="continues">continues from {clock(g.from, false)}</small>}</td><td>{clock(to)}{to < g.to && <small className="continues">continues to {clock(g.to, false)}</small>}</td><td><strong>{minutes(Math.round((to - from) / 1000))}</strong></td>{keys.length > 1 && <td>{log.counters[g.counter].label}</td>}<td>{to < g.to ? '—' : ends[g.until] || g.until}</td></tr>; })}</tbody></table></div> : <p className="hint">No stops {hour ? 'in this hour' : 'longer than the limit'}.</p>}</section>
      {hour && <section className="panel production-table"><header><h2>Downtime and rejects in this hour</h2></header>
        {hourDowntime.length + hourRejects.length === 0 ? <p className="hint">Nothing logged against this hour.</p> : <>
          {hourDowntime.length > 0 && <div className="table-wrap"><table><thead><tr><th>Logged</th><th>Downtime</th><th>Reason</th><th>Minutes</th><th>Action</th></tr></thead><tbody>{hourDowntime.map(d => <tr key={d.id || d.at}><td>{Number.isFinite(d.at) ? clock(d.at, false) : '—'}</td><td>{d.category}</td><td className="wrap">{d.reason || '—'}</td><td><strong>{d.minutes}</strong></td><td className="wrap">{d.action || '—'}</td></tr>)}</tbody></table></div>}
          {hourRejects.length > 0 && <div className="table-wrap"><table><thead><tr><th>Logged</th><th>Reject code</th><th>Slab</th><th>Return roll</th><th>NG</th><th>Loft</th></tr></thead><tbody>{hourRejects.map(r => <tr key={r.id || r.at}><td>{Number.isFinite(r.at) ? clock(r.at, false) : '—'}</td><td>{r.code || '—'}</td><td>{r.slab}</td><td>{r.returnRoll}</td><td>{r.ng}</td><td>{r.loft}</td></tr>)}</tbody></table></div>}
        </>}</section>}
      <section className="panel production-table"><header><h2>{hour ? `Pieces in this hour (${counted} pcs)` : `Every piece (${pieces.filter(p => p.qty > 0).reduce((s, p) => s + p.qty, 0)} pcs)`}</h2><div className="production-sort" role="group" aria-label="Sort pieces">{[['newest', 'Newest first'], ['oldest', 'Oldest first']].map(([v, l]) => <button key={v} type="button" className={`btn ${pieceSort === v ? 'primary' : 'secondary'}`} onClick={() => setPieceSort(v)}>{l}</button>)}</div></header>
        {pieces.length ? <div className="table-wrap"><table><thead><tr><th>Time</th>{keys.length > 1 && <th>Counter</th>}<th>Pieces</th><th>Total</th><th>Since last piece</th></tr></thead><tbody>{pieces.slice(0, limit).map(p => <tr key={p.key + p.at + p.total} className={p.since > limitFor(p.cycle ?? log.shift.cycle, log.gapRule) ? 'late' : ''} title={p.since > limitFor(p.cycle ?? log.shift.cycle, log.gapRule) ? 'Longer than a stop' : undefined}><td>{clock(p.at)}</td>{keys.length > 1 && <td>{p.label}</td>}<td>{p.qty > 0 ? `+${p.qty}` : p.qty}</td><td>{p.total}</td>{(() => { const cycle = Number(p.cycle ?? log.shift.cycle), over = cycle > 0 && p.since != null ? p.since - Math.round(cycle * 60) : 0; return <td className={over > 0 ? 'slow' : ''}>{p.catchup ? 'Counted while no data was received' : p.qty < 0 ? 'Count corrected' : p.since == null ? '—' : over > 0 ? `${dur(p.since)} (+${dur(over)})` : dur(p.since)}</td>; })()}</tr>)}</tbody></table></div> : <p className="hint">No pieces {hour ? 'in this hour' : 'yet'}.</p>}
        {pieces.length > limit && <button className="btn secondary production-more" onClick={() => setLimit(v => v + 500)}>Show more ({pieces.length - limit} left)</button>}</section>
    </>}
  </div>;
}
