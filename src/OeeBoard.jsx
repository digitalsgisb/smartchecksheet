import { useEffect, useState } from 'react';
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

function Tile({ title, x, y, w, h, color, value, unit, fit = 20, flat = false, className = '' }) {
  const dark = lightBackgrounds.includes(color);
  return <section className={`oee-g ${className}`} style={at(x, y, w, h)}>
    {title && <h3>{title}</h3>}
    <div className={`oee-g-body ${flat ? 'flat' : ''}`} style={{ '--bg': flat ? 'transparent' : color, '--fg': flat ? color : dark ? '#111217' : '#fff', '--fit': fit }}><strong>{value}{unit && <small> {unit}</small>}</strong></div>
  </section>;
}
function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const timer = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(timer); }, []);
  const part = options => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kuala_Lumpur', ...options }).format(now);
  return <><span>{part({ day: '2-digit', month: '2-digit', year: 'numeric' }).replaceAll('/', '-')}</span><strong>{part({ hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })}</strong></>;
}
function Progress({ value }) {
  const cells = 120, filled = Math.round(Math.max(0, Math.min(1, value / 100)) * cells);
  return <div className="oee-lcd">{Array.from({ length: cells }, (_, i) => { const at = (i + 1) / cells * 100; const color = at <= 50 ? C.darkRed : at <= 80 ? '#E0B400' : C.darkGreen; return <i key={i} style={{ background: color, opacity: i < filled ? 1 : .18 }}/>; })}</div>;
}
function History({ rows = [] }) {
  if (!rows.length) return null;
  const shiftLabel = id => { const [date, shift] = String(id || '').split('-'); return date?.length === 8 ? `${date.slice(6, 8)}/${date.slice(4, 6)} ${shift || ''}` : id; };
  return <section className="oee-history" aria-label="Recent shifts"><h3>Recent shifts</h3><div className="oee-history-rows">{rows.map(row => <div key={row.shiftId} className="oee-history-row"><span>{shiftLabel(row.shiftId)}</span><strong style={{ color: oeeColor(Math.round(row.oee * 100)) }}>{Math.round(row.oee * 100)}%</strong><em>A {Math.round(row.availability * 100)} · P {Math.round(row.performance * 100)} · Q {Math.round(row.quality * 100)}</em><em>{row.output} pcs{row.rejects ? ` · ${row.rejects} NG` : ''}</em></div>)}</div></section>;
}

export default function OeeBoard({ state, history = true }) {
  const live = state.live || {}, k = live.oee, t = live.timers;
  if (state.mode !== 'live' || !state.machineConnected || !k || !t) return <div className="oee-board">
    <div className="tv-live-empty"><strong>{state.mode === 'live' ? 'No live machine data' : 'OEE needs a machine connection'}</strong><span>{state.mode === 'live' ? `Waiting for ${state.line || 'the line'} to send data.` : 'This line is not connected to a machine.'}</span></div>
    {history && <History rows={state.oeeHistory}/>}
  </div>;
  const [statusText, statusColor] = statuses[live.statusCode] || ['', C.darkRed];
  const pct = v => Math.round(v * 100), progress = Math.round(k.progress * 1000) / 10, oee = pct(k.oee);
  return <div className="oee-board">
    <div className="oee-grid">
      <section className="oee-g oee-progress" style={at(0, 0, 21, 3)}><h3>Progress (%)</h3><div className="oee-progress-row"><Progress value={progress}/><strong>{progress}<small>%</small></strong></div></section>
      <Tile title="Daily Target" x={21} y={0} w={3} h={3} color="#ccccdc" value={live.hourTarget || 0} flat fit={30}/>
      <Tile x={0} y={3} w={12} h={7} color={statusColor} value={statusText ? `${state.line} ${statusText}` : ''} fit={13} className="oee-status"/>
      <section className="oee-g oee-model" style={at(12, 3, 6, 7)}><strong>{state.setup?.model || '—'}</strong></section>
      <section className="oee-g oee-title" style={at(18, 3, 6, 3)}><strong>OEE</strong></section>
      <Tile x={18} y={6} w={6} h={9} color={oeeColor(oee)} value={oee} unit="%" fit={46} className="oee-main"/>
      <Tile title="Machine Run Time" x={0} y={10} w={4} h={7} color={C.darkGreen} value={seconds(t.run)[0]} unit={seconds(t.run)[1]} fit={19}/>
      <Tile title="Machine Loading Time" x={4} y={10} w={4} h={7} color={C.semiDarkOrange} value={seconds(t.loading)[0]} unit={seconds(t.loading)[1]} fit={19}/>
      <Tile title="Waiting" x={8} y={10} w={4} h={7} color={C.darkRed} value={seconds(t.delay)[0]} unit={seconds(t.delay)[1]} fit={19}/>
      <Tile title="Product Count" x={12} y={10} w={3} h={5} color={C.darkBlue} value={live.modelActual ?? 0} fit={42}/>
      <Tile title="Total Product Count" x={15} y={10} w={3} h={5} color={C.darkBlue} value={live.shiftActual ?? 0} fit={42}/>
      <Tile title="Cycle Time" x={12} y={15} w={6} h={4} color={C.white} value={(Number(live.cycle) || 0).toFixed(2)} unit="min/pcs" fit={15}/>
      <Tile title="Availability" x={18} y={15} w={2} h={6} color={C.darkGreen} value={pct(k.availability)} unit="%" fit={30}/>
      <Tile title="Performance" x={20} y={15} w={2} h={6} color={C.darkYellow} value={pct(k.performance)} unit="%" fit={30}/>
      <Tile title="Quality" x={22} y={15} w={2} h={6} color={C.darkBlue} value={pct(k.quality)} unit="%" fit={30}/>
      <Tile title="Machine Down Time" x={0} y={17} w={3} h={5} color={C.darkRed} value={seconds(t.downtime)[0]} unit={seconds(t.downtime)[1]} fit={19}/>
      <Tile title="Rest Time" x={3} y={17} w={3} h={5} color={C.orange} value={seconds(t.rest)[0]} unit={seconds(t.rest)[1]} fit={19}/>
      <Tile title="Planned Stop Time" x={6} y={17} w={3} h={5} color={C.darkBlue} value={seconds(t.plannedStop)[0]} unit={seconds(t.plannedStop)[1]} fit={19}/>
      <Tile title="Model Change Time" x={9} y={17} w={3} h={5} color={C.superLightBlue} value={seconds(t.modelChange)[0]} unit={seconds(t.modelChange)[1]} fit={19}/>
      <Tile title="Standard Cycle Time" x={12} y={19} w={6} h={3} color={C.white} value={(Number(live.standardCycle) || 0).toFixed(2)} unit="min/pcs" flat fit={9}/>
      <section className="oee-g oee-clock" style={at(18, 21, 6, 5)}><h3>Time</h3><div><Clock/></div></section>
      <Tile title="Total Real Operating Time" x={0} y={22} w={4} h={4} color={C.darkGreen} value={seconds(t.totalRealOperating)[0]} unit={seconds(t.totalRealOperating)[1]} fit={19}/>
      <Tile title="Real Operating Time" x={4} y={22} w={4} h={4} color={C.lightGreen} value={seconds(t.realOperating)[0]} unit={seconds(t.realOperating)[1]} fit={19}/>
      <Tile title="Real Time pcs" x={8} y={22} w={3} h={4} color={C.lightBlue} value={Math.round(k.realTimePcs)} fit={34}/>
      <Tile title="Short pcs" x={11} y={22} w={3} h={4} color={C.lightRed} value={Math.round(k.shortPcs)} fit={34}/>
      <Tile title="Total Reject" x={14} y={22} w={4} h={4} color={C.darkRed} value={live.totalReject ?? 0} fit={34}/>
    </div>
    {history && <History rows={state.oeeHistory}/>}
  </div>;
}
