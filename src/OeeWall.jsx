import { useEffect, useState } from 'react';
import { Monitor } from 'lucide-react';
import { api } from './api.js';
import { C, Progress, Tile, at, oeeColor, seconds, statuses } from './OeeBoard.jsx';
import { tvChecksheet } from './tvChecksheet.js';
import { SlideGroup } from './ui.jsx';
import './oee-wall.css';

// Overall Wall: every line the account may see, on one screen, looping OEE -> 4M -> checksheet every 20 s (tapping a view
// jumps to it and restarts the loop). Each running line is a panel in the OEE board's Grafana tiles and colours, under
// the same status bar in every view, and each plant is one row. Executive, management and developer only (the server checks too).
// Plant choice: the route (#tv/oee-wall/sendayan) wins, otherwise the last choice on this screen.
const PLANTS = [{ id: 'all', label: 'All plants' }, { id: 'port-klang', label: 'Port Klang', site: 'Port Klang' }, { id: 'sendayan', label: 'Sendayan', site: 'Sendayan' }];
const COUNT_LINES = new Set(['SDY1', 'SDY2']);
const remembered = () => { try { return localStorage.getItem('oee-wall-plant') || 'all'; } catch { return 'all'; } };
const VIEWS = [{ id: 'oee', label: 'OEE', title: 'Line OEE' }, { id: '4m', label: '4M', title: '4M board' }, { id: 'checksheet', label: 'Checksheet', title: 'Live checksheet' }];
const VIEW_SECONDS = 20;
const mean = values => values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;

// One line: the main OEE board cut down to the tiles that matter at a glance, on a 12 x 16 grid.
const lineStatus = item => !item.machine ? ['Manual', '#464c54'] : !(item.machine && item.connected) ? ['No Data', '#464c54'] : statuses[item.statusCode] || ['Waiting', C.darkRed];
// The line's name and machine state: the same bar on top of every view, so a line is easy to find as the views change.
const StatusBar = ({ item }) => { const [text, color] = lineStatus(item), label = `${item.line} ${text}`; return <Tile x={0} y={0} w={12} h={3} color={color} value={label} fit={Math.min(13, 158 / Math.max(1, label.length))} className="oee-status"/>; };
function LinePanel({ item }) {
  const fresh = item.machine && item.connected;
  const [statusText, statusColor] = lineStatus(item);
  const oee = fresh ? Math.round(item.oee) : 0;
  const counts = COUNT_LINES.has(item.line) || item.forming != null || item.waterjet != null;
  const time = value => seconds(fresh ? value : 0);
  const shift = item.shift ? `${item.shift.shift}${item.shift.overtime ? ' + OT' : ''}` : '';
  return <article className="oee-board wall-panel" style={{ '--status': statusColor, '--oee': oeeColor(oee) }} aria-label={`${item.line}: ${statusText}, OEE ${fresh ? `${oee} percent` : 'not available'}`}>
    <div className="oee-grid wall-grid">
      <StatusBar item={item}/>
      <section className="oee-g oee-model" style={at(0, 3, 8, 2)}><strong key={item.model}>{item.model || '—'}</strong></section>
      <Tile x={8} y={3} w={4} h={2} color="#ccccdc" value={shift ? `${shift} shift` : '—'} flat/>
      <Tile title="OEE" x={0} y={5} w={6} h={6} color={oeeColor(oee)} value={oee} unit="%" className="oee-main"/>
      <Tile title="Availability" x={6} y={5} w={2} h={6} color={C.darkGreen} value={fresh ? Math.round(item.availability) : 0} unit="%"/>
      <Tile title="Performance" x={8} y={5} w={2} h={6} color={C.darkYellow} value={fresh ? Math.round(item.performance) : 0} unit="%"/>
      <Tile title="Quality" x={10} y={5} w={2} h={6} color={C.darkBlue} value={fresh ? Math.round(item.quality) : 0} unit="%"/>
      {counts ? <>
        <Tile title="Forming Output" x={0} y={11} w={3} h={3} color={C.formingTeal} value={item.forming ?? 0}/>
        <Tile title="Waterjet Output" x={3} y={11} w={3} h={3} color={C.waterjetTeal} value={item.waterjet ?? 0}/>
      </> : <>
        <Tile title="Total Product Count" x={0} y={11} w={3} h={3} color={C.darkBlue} value={item.output}/>
        <Tile title="Machine Run Time" x={3} y={11} w={3} h={3} color={C.darkGreen} value={time(item.runTime)[0]} unit={time(item.runTime)[1]}/>
      </>}
      <Tile title="Machine Down Time" x={6} y={11} w={3} h={3} color={C.darkRed} value={time(item.downTime)[0]} unit={time(item.downTime)[1]}/>
      <Tile title="Total Reject" x={9} y={11} w={3} h={3} color={C.darkRed} value={item.rejects}/>
      <section className="oee-g oee-progress" style={at(0, 14, 12, 2)}><h3>Progress (%)</h3><div className="oee-progress-row"><Progress value={fresh ? item.progress : 0}/><strong>{fresh ? item.progress : 0}<small>%</small></strong></div></section>
    </div>
  </article>;
}

// 4M: one tile per category, green OK, red NG with the problem, grey when not checked yet this shift.
const FOUR_M = [['man', 'Man'], ['machine', 'Machine'], ['material', 'Material'], ['method', 'Method']];
const fourM = { OK: ['OK', C.darkGreen], NG: ['NG', C.darkRed] };
function HenkatenPanel({ item }) {
  const open = item.openIssues || 0;
  return <article className="oee-board wall-panel" aria-label={`${item.line} 4M: ${open} open ${open === 1 ? 'problem' : 'problems'}`}>
    <div className="oee-grid wall-grid">
      <StatusBar item={item}/>
      {FOUR_M.map(([key, name], index) => { const card = item.henkaten?.[key] || {}, [word, color] = fourM[card.status] || ['Wait', '#464c54'];
        return <section key={key} className="oee-g wall-4m" style={at(index % 2 * 6, 3 + Math.floor(index / 2) * 5, 6, 5)}><h3>{name}</h3>
          <div className="oee-g-body glass" style={{ '--bg': color, '--fg': '#fff' }}><strong key={word}>{word}</strong>{card.status === 'NG' ? card.issue && <p>{card.issue}</p> : card.status !== 'OK' && <p>Not checked yet</p>}</div></section>; })}
      <Tile title="Open problems" x={0} y={13} w={12} h={3} color={open ? C.darkRed : C.darkGreen} value={open}/>
    </div>
  </article>;
}

// Checksheet: the shift's totals, then the hours newest first (this hour on top while it runs). Actual under plan is red.
const hourLabel = slot => String(slot || '').split(/\s*[-–]\s*/)[0] || '—';
function ChecksheetPanel({ item, now }) {
  const { rows, output, rejects, downtime } = item.checksheet ? tvChecksheet(item.checksheet, now) : { rows: [], output: 0, rejects: 0, downtime: 0 };
  return <article className="oee-board wall-panel" aria-label={`${item.line} checksheet: ${output} pieces`}>
    <div className="oee-grid wall-grid">
      <StatusBar item={item}/>
      <Tile title="Shift Output" x={0} y={3} w={4} h={3} color={C.darkBlue} value={output}/>
      <Tile title="Rejects" x={4} y={3} w={4} h={3} color={C.darkRed} value={rejects}/>
      <Tile title="Downtime" x={8} y={3} w={4} h={3} color={C.darkRed} value={downtime} unit="min"/>
      <section className="oee-g wall-hours" style={at(0, 6, 12, 10)}><h3>Hourly checksheet</h3>
        {rows.length ? <table><thead><tr><th>Hour</th><th>Model</th><th>Plan</th><th>Actual</th></tr></thead>
          <tbody>{rows.map(row => { const plan = Number(row.plan), actual = Number(row.actual), short = !row.live && plan > 0 && Number.isFinite(actual) && actual < plan;
            return <tr key={row.id} className={row.live ? 'now' : undefined}><td>{hourLabel(row.slot)}{row.live && <i title="This hour"/>}</td><td>{row.model || '—'}</td><td>{row.plan ?? '—'}</td><td className={row.live ? undefined : short ? 'short' : 'met'}>{row.actual ?? '—'}</td></tr>; })}</tbody></table>
          : <p className="wall-hours-empty">No hour entered yet.</p>}</section>
    </div>
  </article>;
}

const PANELS = { oee: LinePanel, '4m': HenkatenPanel, checksheet: ChecksheetPanel };
function PlantRow({ name, lines, columns, view, now }) {
  const running = lines.filter(item => item.running), idle = lines.filter(item => !item.running);
  const average = mean(running.filter(item => item.machine && item.connected).map(item => item.oee)), open = running.reduce((sum, item) => sum + (item.openIssues || 0), 0), Panel = PANELS[view];
  return <section className="wall-plant" aria-label={name}>
    <header className="wall-plant-head">
      <h2>{name}</h2>
      {view === '4m' ? <span className="wall-average" style={{ '--avg': open ? C.lightRed : C.lightGreen }}>{open ? `${open} open ${open === 1 ? 'problem' : 'problems'}` : 'No open problems'}</span>
        : <span className="wall-average" style={{ '--avg': average === null ? '#464c54' : oeeColor(average) }}>{average === null ? 'No OEE yet' : `${average}% average OEE`}</span>}
      <span>{running.length} of {lines.length} running</span>
      {idle.length > 0 && <span className="wall-idle">Not running: {idle.map(item => item.line).join(', ')}</span>}
    </header>
    {running.length ? <div className="wall-lines" style={{ '--cols': columns }}>{running.map(item => <Panel key={item.line} item={item} now={now}/>)}</div>
      : <div className="wall-empty" role="status"><strong>NO PROD</strong><span>No line in {name} has a shift running.</span></div>}
  </section>;
}

export default function OeeWall({ tv, plant: routePlant, go }) {
  const [data, setData] = useState(null), [error, setError] = useState('');
  const [chosen, setChosen] = useState(remembered);
  const [view, setView] = useState(() => ({ id: 'oee', at: Date.now() }));
  useEffect(() => { const timer = setTimeout(() => setView(({ id }) => ({ id: VIEWS[(VIEWS.findIndex(item => item.id === id) + 1) % VIEWS.length].id, at: Date.now() })), VIEW_SECONDS * 1000); return () => clearTimeout(timer); }, [view]);
  const plantId = PLANTS.some(item => item.id === routePlant) ? routePlant : chosen;
  useEffect(() => {
    let disposed = false, timer;
    async function load() {
      if (document.visibilityState !== 'hidden') {
        try { const next = await api('/oee-wall'); if (!disposed) { setData({ ...next, receivedAt: Date.now() }); setError(''); } }
        catch (failure) { if (!disposed) setError(failure.status === 403 ? 'forbidden' : failure.message); }
      }
      if (!disposed) timer = setTimeout(load, 3000);
    }
    load();
    return () => { disposed = true; clearTimeout(timer); };
  }, []);
  function choose(id) { setChosen(id); try { localStorage.setItem('oee-wall-plant', id); } catch { /* per-screen convenience only */ } if (routePlant) go(`${tv ? 'tv/' : ''}oee-wall/${id}`); }
  if (error === 'forbidden') return <div className="wall-empty" role="status"><strong>Executive access needed</strong><span>Ask a manager to open the Overall Wall for you.</span></div>;
  const lines = data?.lines || [];
  // Only offer plants this account actually has lines in.
  const plants = PLANTS.filter(item => !item.site || lines.some(line => line.plant === item.site));
  const current = plants.find(item => item.id === plantId) || PLANTS[0];
  const groups = current.site ? [[current.label, lines.filter(line => line.plant === current.site)]]
    : [...new Set(lines.map(line => line.plant))].sort((a, b) => !a - !b).map(site => [site || 'Other lines', lines.filter(line => line.plant === site)]);
  // Every plant row uses the same column count, so panels are the same size and line up between rows.
  const columns = Math.max(1, ...groups.map(([, items]) => items.filter(item => item.running).length));
  return <div className="wall">
    <div className="wall-bar">
      <h1>{VIEWS.find(item => item.id === view.id).title}</h1>
      {/* The loop: the current view's pill fills over its 20 s, so the floor can see what comes next. */}
      <div className="wall-views" role="group" aria-label="View">{VIEWS.map(item => <button key={item.id} type="button" aria-pressed={item.id === view.id} onClick={() => setView({ id: item.id, at: Date.now() })}>{item.id === view.id && <i key={view.at} style={{ '--view-s': `${VIEW_SECONDS}s` }}/>}<span>{item.label}</span></button>)}</div>
      {plants.length > 2 && <SlideGroup className="wall-plants" role="group" aria-label="Plant" selector="[aria-pressed=true]">{plants.map(item => <button key={item.id} type="button" aria-pressed={item.id === current.id} onClick={() => choose(item.id)}>{item.label}</button>)}</SlideGroup>}
      {!tv && <button type="button" className="btn secondary wall-tv" onClick={() => go(`tv/oee-wall/${current.id}`)}><Monitor size={18}/>Open on TV</button>}
    </div>
    {error && <div className="notice" role="status">{error} Showing the last figures received.</div>}
    {!data ? !error && <div className="wall-empty" role="status"><strong>Loading lines</strong></div>
      : !lines.length ? <div className="wall-empty" role="status"><strong>No lines</strong><span>Your account has no production lines yet.</span></div>
      : <div className="wall-rows">{groups.map(([name, items]) => <PlantRow key={name} name={name} lines={items} columns={columns} view={view.id} now={Date.now() + (data.serverTime ? data.serverTime - data.receivedAt : 0)}/>)}</div>}
  </div>;
}
