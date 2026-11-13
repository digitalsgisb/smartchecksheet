import { useEffect, useState } from 'react';

const PER_PAGE = 6; // hours shown at once; the rows stretch to fill the screen
// The live checksheet laid out for a TV: big totals on top, the hourly rows below, paged automatically so nothing needs scrolling.
export default function TvLive({ state, seconds = 60 }) {
  const rows = [...state.hourly, ...(state.shift?.status === 'active' && state.setup ? [{ id: 'live', slot: state.live.slot, model: state.setup.model, lot: state.setup.lot, plan: state.live.plan, actual: state.live.actual, restMinutes: '—', live: true }] : [])];
  const pages = Math.max(1, Math.ceil(rows.length / PER_PAGE));
  const [page, setPage] = useState(Math.max(0, pages - 1)); // open on the page with the current hour
  const current = Math.min(page, pages - 1);
  useEffect(() => {
    if (pages < 2) return;
    const timer = setInterval(() => setPage(value => (value + 1) % pages), Math.max(8, Math.floor(seconds / pages)) * 1000);
    return () => clearInterval(timer);
  }, [pages, seconds]);
  const shown = rows.slice(current * PER_PAGE, (current + 1) * PER_PAGE);
  const rejects = state.rejects.reduce((sum, record) => sum + Number(record.ng || 0) + Number(record.loft || 0), 0);
  const downtime = state.downtime.reduce((sum, record) => sum + Number(record.duration || 0), 0);
  const tiles = [
    { label: 'Model', value: state.setup?.model || '—', note: state.setup?.lot ? `Lot ${state.setup.lot}` : '', wide: true },
    { label: 'Shift', value: state.shift ? state.shift.shift : '—', note: state.shift?.workingTime || '' },
    { label: 'Shift output', value: state.live.shiftActual, unit: 'pcs' },
    { label: 'Rejects', value: rejects, unit: 'pcs', warn: rejects > 0 },
    { label: 'Downtime', value: downtime, unit: 'min' }
  ];
  return <div className="tv-live">
    <div className="tv-live-tiles">{tiles.map(tile => <div key={tile.label} className={`tv-live-tile ${tile.wide ? 'wide' : ''} ${tile.warn ? 'warn' : ''}`}><span>{tile.label}</span><strong>{tile.value}{tile.unit && <small> {tile.unit}</small>}</strong>{tile.note && <em>{tile.note}</em>}</div>)}</div>
    <div className="tv-hours" style={{ '--rows': PER_PAGE }}>
      <div className="tv-hours-row head"><span>Hour</span><span>Model</span><span>Lot</span><span>Plan</span><span>Actual</span><span>Diff</span><span>Rest</span></div>
      <div className="tv-hours-page" key={current}>{Array.from({ length: PER_PAGE }, (_, index) => { const row = shown[index]; if (!row) return <div key={index} className="tv-hours-row blank"/>; const diff = row.actual - row.plan; return <div key={row.id} className={`tv-hours-row ${row.live ? 'live' : ''}`}><span className="strong">{row.slot}{row.live && <b><i/>Live</b>}</span><span>{row.model}</span><span className="mono">{row.lot}</span><span>{row.plan}</span><span className="strong">{row.actual}</span><span className={diff >= 0 ? 'positive' : 'negative'}>{diff > 0 ? '+' : ''}{diff}</span><span>{row.restMinutes}</span></div>; })}</div>
    </div>
    {pages > 1 && <p className="tv-live-pages" role="status">Hours {current * PER_PAGE + 1}–{Math.min(rows.length, (current + 1) * PER_PAGE)} of {rows.length}</p>}
    {!rows.length && <p className="tv-live-pages">No hourly records yet.</p>}
  </div>;
}
