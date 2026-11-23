import { useEffect, useState } from 'react';
import { Monitor } from 'lucide-react';
import { api } from './api.js';
import { C, Progress, Tile, at, oeeColor, seconds, statuses } from './OeeBoard.jsx';
import { SlideGroup } from './ui.jsx';
import './oee-wall.css';

// Every line the account may see, on one screen. Each running line is a small copy of its own OEE board (same Grafana
// tiles and colours), and each plant is one row. Executive, management and developer only (the server checks too).
// Plant choice: the route (#tv/oee-wall/sendayan) wins, otherwise the last choice on this screen.
const PLANTS = [{ id: 'all', label: 'All plants' }, { id: 'port-klang', label: 'Port Klang', site: 'Port Klang' }, { id: 'sendayan', label: 'Sendayan', site: 'Sendayan' }];
const COUNT_LINES = new Set(['SDY1', 'SDY2']);
const remembered = () => { try { return localStorage.getItem('oee-wall-plant') || 'all'; } catch { return 'all'; } };
const mean = values => values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;

// One line: the main OEE board cut down to the tiles that matter at a glance, on a 12 x 16 grid.
function LinePanel({ item }) {
  const fresh = item.machine && item.connected;
  const [statusText, statusColor] = !item.machine ? ['Manual', '#464c54'] : !fresh ? ['No Data', '#464c54'] : statuses[item.statusCode] || ['Waiting', C.darkRed];
  const oee = fresh ? Math.round(item.oee) : 0, label = `${item.line} ${statusText}`;
  const counts = COUNT_LINES.has(item.line) || item.forming != null || item.waterjet != null;
  const time = value => seconds(fresh ? value : 0);
  const shift = item.shift ? `${item.shift.shift}${item.shift.overtime ? ' + OT' : ''}` : '';
  return <article className="oee-board wall-panel" style={{ '--status': statusColor, '--oee': oeeColor(oee) }} aria-label={`${item.line}: ${statusText}, OEE ${fresh ? `${oee} percent` : 'not available'}`}>
    <div className="oee-grid wall-grid">
      <Tile x={0} y={0} w={12} h={3} color={statusColor} value={label} fit={Math.min(13, 158 / Math.max(1, label.length))} className="oee-status"/>
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

function PlantRow({ name, lines, columns }) {
  const running = lines.filter(item => item.running), idle = lines.filter(item => !item.running);
  const average = mean(running.filter(item => item.machine && item.connected).map(item => item.oee));
  return <section className="wall-plant" aria-label={name}>
    <header className="wall-plant-head">
      <h2>{name}</h2>
      <span className="wall-average" style={{ '--avg': average === null ? '#464c54' : oeeColor(average) }}>{average === null ? 'No OEE yet' : `${average}% average OEE`}</span>
      <span>{running.length} of {lines.length} running</span>
      {idle.length > 0 && <span className="wall-idle">Not running: {idle.map(item => item.line).join(', ')}</span>}
    </header>
    {running.length ? <div className="wall-lines" style={{ '--cols': columns }}>{running.map(item => <LinePanel key={item.line} item={item}/>)}</div>
      : <div className="wall-empty" role="status"><strong>NO PROD</strong><span>No line in {name} has a shift running.</span></div>}
  </section>;
}

export default function OeeWall({ tv, plant: routePlant, go }) {
  const [data, setData] = useState(null), [error, setError] = useState('');
  const [chosen, setChosen] = useState(remembered);
  const plantId = PLANTS.some(item => item.id === routePlant) ? routePlant : chosen;
  useEffect(() => {
    let disposed = false, timer;
    async function load() {
      if (document.visibilityState !== 'hidden') {
        try { const next = await api('/oee-wall'); if (!disposed) { setData(next); setError(''); } }
        catch (failure) { if (!disposed) setError(failure.status === 403 ? 'forbidden' : failure.message); }
      }
      if (!disposed) timer = setTimeout(load, 3000);
    }
    load();
    return () => { disposed = true; clearTimeout(timer); };
  }, []);
  function choose(id) { setChosen(id); try { localStorage.setItem('oee-wall-plant', id); } catch { /* per-screen convenience only */ } if (routePlant) go(`${tv ? 'tv/' : ''}oee-wall/${id}`); }
  if (error === 'forbidden') return <div className="wall-empty" role="status"><strong>Executive access needed</strong><span>Ask a manager to open the OEE wall for you.</span></div>;
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
      <h1>Line OEE</h1>
      {plants.length > 2 && <SlideGroup className="wall-plants" role="group" aria-label="Plant" selector="[aria-pressed=true]">{plants.map(item => <button key={item.id} type="button" aria-pressed={item.id === current.id} onClick={() => choose(item.id)}>{item.label}</button>)}</SlideGroup>}
      {!tv && <button type="button" className="btn secondary wall-tv" onClick={() => go(`tv/oee-wall/${current.id}`)}><Monitor size={18}/>Open on TV</button>}
    </div>
    {error && <div className="notice" role="status">{error} Showing the last figures received.</div>}
    {!data ? !error && <div className="wall-empty" role="status"><strong>Loading lines</strong></div>
      : !lines.length ? <div className="wall-empty" role="status"><strong>No lines</strong><span>Your account has no production lines yet.</span></div>
      : <div className="wall-rows">{groups.map(([name, items]) => <PlantRow key={name} name={name} lines={items} columns={columns}/>)}</div>}
  </div>;
}
