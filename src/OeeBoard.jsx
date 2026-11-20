import { memo, useEffect, useState } from 'react';
import './oee-board.css';

// Live OEE for one line: a one-to-one copy of the Grafana "ABB2 Smart Dashboard" (same 24-column grid positions,
// colours, titles and units), fed by the Python payload the server already receives. Formula in shared/oee.js.
const C = { green: '#73BF69', yellow: '#FADE2A', red: '#F2495C', orange: '#FF9830', blue: '#5794F2', darkRed: '#C4162A', semiDarkRed: '#E02F44', darkGreen: '#37872D', darkBlue: '#1F60C4', darkYellow: '#E0B400', lightGreen: '#96D98D', lightBlue: '#8AB8FF', lightRed: '#FF7383', superLightBlue: '#C0D8FF', semiDarkOrange: '#FF780A', white: '#FFFFFF' };
const statuses = [['Running', C.green], ['Loading', C.yellow], ['Waiting', C.red], ['Rest', C.orange], ['Down', C.darkRed], ['Planned Stop', C.semiDarkRed], ['Model Change', C.blue], ['Fill Shift', C.darkRed]];
const oeeColor = v => v >= 100 ? C.darkGreen : v >= 80 ? '#EF843C' : v >= 70 ? '#6ED0E0' : v >= 50 ? '#EAB839' : C.darkRed;
const lightBackgrounds = [C.yellow, C.white, C.superLightBlue, '#6ED0E0', '#EAB839', '#EF843C', C.orange];
const trim = text => text.replace(/\.0+$/, '');
// Grafana's "s" unit with 1 decimal: 0 s, 45.3 s, 38.2 mins, 1.6 hours.
function seconds(value) {
  const v = Number(value) || 0;
  if (Math.abs(v) < 60) return [trim(v.toFixed(1)), 's'];
  if (Math.abs(v) < 3600) return [trim((v / 60).toFixed(1)), 'mins'];
  return [trim((v / 3600).toFixed(1)), 'hours'];
}
const at = (x, y, w, h) => ({ '--gc': `${x + 1} / span ${w}`, '--gr': `${y + 1} / span ${h}` });

// Memoised: a fresh snapshot arrives every second, but only tiles whose value or colour changed re-render.
// Numbers size to their tile like Grafana's auto size: the tile's width over the text's width in em (digits ~0.6em, the unit is drawn at 0.4em). Height caps it in oee-board.css.
const autoFit = (value, unit) => 95 / (String(value).length * 0.5 + (unit ? (unit.length + 1) * 0.6 * 0.4 : 0) + 0.25);
const Tile = memo(function Tile({ title, x, y, w, h, color, value, unit, fit = autoFit(value, unit), flat = false, className = '' }) {
  const dark = lightBackgrounds.includes(color);
  return <section className={`oee-g ${className}`} style={at(x, y, w, h)}>
    {title && <h3>{title}</h3>}
    {/* Keyed on the value so a change eases in instead of snapping. */}
    <div className={`oee-g-body ${flat ? 'flat' : 'glass'}`} style={{ '--bg': flat ? 'transparent' : color, '--fg': flat ? color : dark ? '#111217' : '#fff', '--fit': fit }}><strong key={`${value} ${unit || ''}`}>{value}{unit && <small> {unit}</small>}</strong></div>
  </section>;
});
// Formatters built once; the clock ticks every second.
const clockDate = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kuala_Lumpur', day: '2-digit', month: '2-digit', year: 'numeric' });
const clockTime = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kuala_Lumpur', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const timer = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(timer); }, []);
  return <><span>{clockDate.format(now).replaceAll('/', '-')}</span><strong>{clockTime.format(now)}</strong></>;
}
// Grafana LCD bar gauge as two layers: a dim track and a lit fill clipped to the value (CSS draws the cells and zones).
const Progress = memo(function Progress({ value }) {
  return <div className="oee-lcd" style={{ '--fill': `${Math.max(0, Math.min(100, value))}%` }}><div className="oee-lcd-fill"/></div>;
});
function History({ rows = [] }) {
  if (!rows.length) return null;
  const shiftLabel = id => { const [date, shift] = String(id || '').split('-'); return date?.length === 8 ? `${date.slice(6, 8)}/${date.slice(4, 6)} ${shift || ''}` : id; };
  return <section className="oee-history" aria-label="Recent shifts"><h3>Recent shifts</h3><div className="oee-history-rows">{rows.map(row => <div key={row.shiftId} className="oee-history-row"><span>{shiftLabel(row.shiftId)}</span><strong style={{ color: oeeColor(Math.round(row.oee * 100)) }}>{Math.round(row.oee * 100)}%</strong><em>A {Math.round(row.availability * 100)} · P {Math.round(row.performance * 100)} · Q {Math.round(row.quality * 100)}</em><em>{row.output} pcs{row.rejects ? ` · ${row.rejects} NG` : ''}</em></div>)}</div></section>;
}

const COUNT_LINES = new Set(['SDY1', 'SDY2']);
// Name on the big status tile, as on each line's old Grafana board ("Line 1 Running").
const STATUS_NAMES = { SDY1: 'Line 1', SDY2: 'Line 2' };
const EMPTY_OEE ={ availability: 0, performance: 0, quality: 0, oee: 0, realTimePcs: 0, shortPcs: 0, progress: 0 };
const EMPTY_TIMERS = { run: 0, loading: 0, delay: 0, downtime: 0, rest: 0, plannedStop: 0, modelChange: 0, machine: 0, realOperating: 0, totalRealOperating: 0 };

export default function OeeBoard({ state, history = true }) {
  if (state.mode !== 'live') return <div className="oee-board">
    <div className="tv-live-empty"><strong>OEE needs a machine connection</strong><span>This line is not connected to a machine.</span></div>
    {history && <History rows={state.oeeHistory}/>}
  </div>;
  // No fresh data yet (new line, Pi offline): draw the same board with zeros, never stale numbers, so the layout is visible.
  const fresh = !!(state.machineConnected && state.live?.oee && state.live?.timers);
  const live = fresh ? state.live : {}, k = fresh ? live.oee : EMPTY_OEE, t = fresh ? live.timers : EMPTY_TIMERS;
  const [statusText, statusColor] = fresh ? statuses[live.statusCode] || ['', C.darkRed] : ['No Data', '#464c54'];
  // Longer states ("ABB2 Planned Stop", "ABB2 Model Change") shrink to fit instead of being cut off.
  const statusLabel = statusText ? `${STATUS_NAMES[state.line] || state.line} ${statusText}` : '';
  // Lines that count forming and waterjet separately (Sendayan) use their own Grafana board: a count row under the
  // product counts. Known by line so the layout shows before the first data; any line sending the counts gets it too.
  const counts = COUNT_LINES.has(state.line) || live.forming != null || live.waterjet != null;
  const pct = v => Math.round(v * 100), progress = Math.round(k.progress * 1000) / 10, oee = pct(k.oee);
  return <div className="oee-board" style={{ '--status': statusColor, '--oee': oeeColor(oee) }}>
    {!fresh && <div className="oee-waiting" role="status"><strong>No live machine data</strong><span>Waiting for {state.line || 'the line'} to send data. The board shows zeros until it does.</span></div>}
    <div className="oee-grid">
      <section className="oee-g oee-progress" style={at(0, 0, 21, 3)}><h3>Progress (%)</h3><div className="oee-progress-row"><Progress value={progress}/><strong>{progress}<small>%</small></strong></div></section>
      <Tile title="Daily Target" x={21} y={0} w={3} h={3} color="#ccccdc" value={live.hourTarget || 0} flat/>
      <Tile x={0} y={3} w={12} h={7} color={statusColor} value={statusLabel} fit={Math.min(13, 158 / Math.max(1, statusLabel.length))} className="oee-status"/>
      <section className="oee-g oee-model" style={at(12, 3, 6, 7)}><strong key={state.setup?.model || ''}>{state.setup?.model || '—'}</strong></section>
      <section className="oee-g oee-title" style={at(18, 3, 6, 3)}><strong>OEE</strong></section>
      <Tile x={18} y={6} w={6} h={9} color={oeeColor(oee)} value={oee} unit="%" className="oee-main"/>
      <Tile title="Machine Run Time" x={0} y={10} w={4} h={7} color={C.darkGreen} value={seconds(t.run)[0]} unit={seconds(t.run)[1]}/>
      <Tile title="Machine Loading Time" x={4} y={10} w={4} h={7} color={C.semiDarkOrange} value={seconds(t.loading)[0]} unit={seconds(t.loading)[1]}/>
      <Tile title={counts ? 'Machine Delay Time' : 'Waiting'} x={8} y={10} w={4} h={7} color={C.darkRed} value={seconds(t.delay)[0]} unit={seconds(t.delay)[1]}/>
      <Tile title="Product Count" x={12} y={10} w={3} h={counts ? 3 : 5} color={C.darkBlue} value={live.modelActual ?? 0}/>
      <Tile title="Total Product Count" x={15} y={10} w={3} h={counts ? 3 : 5} color={C.darkBlue} value={live.shiftActual ?? 0}/>
      {counts && <Tile title="Forming Output" x={12} y={13} w={3} h={3} color={C.lightBlue} value={live.forming ?? 0}/>}
      {counts && <Tile title="Waterjet Output" x={15} y={13} w={3} h={3} color={C.lightBlue} value={live.waterjet ?? 0}/>}
      <Tile title="Cycle Time" x={12} y={counts ? 16 : 15} w={6} h={counts ? 3 : 4} color={C.white} value={(Number(live.cycle) || 0).toFixed(2)} unit="min/pcs"/>
      <Tile title="Availability" x={18} y={15} w={2} h={counts ? 8 : 6} color={C.darkGreen} value={pct(k.availability)} unit="%"/>
      <Tile title="Performance" x={20} y={15} w={2} h={counts ? 8 : 6} color={C.darkYellow} value={pct(k.performance)} unit="%"/>
      <Tile title="Quality" x={22} y={15} w={2} h={counts ? 8 : 6} color={C.darkBlue} value={pct(k.quality)} unit="%"/>
      <Tile title="Machine Down Time" x={0} y={17} w={3} h={5} color={C.darkRed} value={seconds(t.downtime)[0]} unit={seconds(t.downtime)[1]}/>
      <Tile title="Rest Time" x={3} y={17} w={3} h={5} color={C.orange} value={seconds(t.rest)[0]} unit={seconds(t.rest)[1]}/>
      <Tile title="Planned Stop Time" x={6} y={17} w={3} h={5} color={C.darkBlue} value={seconds(t.plannedStop)[0]} unit={seconds(t.plannedStop)[1]}/>
      <Tile title="Model Change Time" x={9} y={17} w={3} h={5} color={C.superLightBlue} value={seconds(t.modelChange)[0]} unit={seconds(t.modelChange)[1]}/>
      <Tile title="Standard Cycle Time" x={12} y={19} w={6} h={3} color={C.white} value={(Number(live.standardCycle) || 0).toFixed(2)} unit="min/pcs" flat/>
      <section className="oee-g oee-clock" style={counts ? at(18, 23, 6, 3) : at(18, 21, 6, 5)}><h3>Time</h3><div><Clock/></div></section>
      <Tile title="Total Real Operating Time" x={0} y={22} w={4} h={4} color={C.darkGreen} value={seconds(t.totalRealOperating)[0]} unit={seconds(t.totalRealOperating)[1]}/>
      <Tile title="Real Operating Time" x={4} y={22} w={4} h={4} color={C.lightGreen} value={seconds(t.realOperating)[0]} unit={seconds(t.realOperating)[1]}/>
      <Tile title="Real Time pcs" x={8} y={22} w={3} h={4} color={C.lightBlue} value={Math.round(k.realTimePcs)}/>
      <Tile title="Short pcs" x={11} y={22} w={3} h={4} color={C.lightRed} value={Math.round(k.shortPcs)}/>
      <Tile title="Total Reject" x={14} y={22} w={4} h={4} color={C.darkRed} value={live.totalReject ?? 0}/>
    </div>
    {history && <History rows={state.oeeHistory}/>}
  </div>;
}
