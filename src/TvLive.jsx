import { useEffect, useMemo, useState } from 'react';
import { tvChecksheet, tvHourlyPages } from './tvChecksheet.js';

const PER_PAGE = 6; // hours shown at once; the rows stretch to fill the screen
// The live checksheet laid out for a TV: big totals on top, the hourly rows below, paged automatically so nothing needs scrolling.
export default function TvLive({ state, seconds = 60 }) {
  const serverOffset = useMemo(() => Number.isFinite(state.serverTime) ? state.serverTime - Date.now() : 0, [state.serverTime]);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const { shift, setup, rows, output, rejects, downtime, previous } = tvChecksheet(state, now + serverOffset);
  const pages = tvHourlyPages(rows, PER_PAGE), pageCount = pages.length;
  const [page, setPage] = useState(0);
  const current = Math.min(page, pageCount - 1);
  useEffect(() => setPage(0), [shift?.id, rows[0]?.id, rows[0]?.slot]);
  useEffect(() => {
    if (pageCount < 2) return;
    const timer = setInterval(() => setPage(value => (value + 1) % pageCount), Math.max(8, Math.floor(seconds / pageCount)) * 1000);
    return () => clearInterval(timer);
  }, [pageCount, seconds]);
  const shown = pages[current];
  const tiles = [
    { label: 'Model', value: setup?.model || '—', note: setup?.lot ? `Lot ${setup.lot}` : '', wide: true },
    { label: previous ? 'Previous shift' : 'Shift', value: shift ? shift.shift : '—', note: [shift?.date, shift?.workingTime].filter(Boolean).join(' · ') },
    { label: 'Shift output', value: output, unit: 'pcs' },
    { label: 'Rejects', value: rejects, unit: 'pcs', warn: rejects > 0 },
    { label: 'Downtime', value: downtime, unit: 'min' }
  ];
  return <div className="tv-live">
    <div className="tv-live-tiles">{tiles.map(tile => <div key={tile.label} className={`tv-live-tile ${tile.wide ? 'wide' : ''} ${tile.warn ? 'warn' : ''}`}><span>{tile.label}</span><strong>{tile.value}{tile.unit && <small> {tile.unit}</small>}</strong>{tile.note && <em>{tile.note}</em>}</div>)}</div>
    {rows.length ? <div className="tv-hours" style={{ '--rows': PER_PAGE }}>
      <div className="tv-hours-row head"><span>Hour</span><span>Model</span><span>Lot</span><span>Plan</span><span>Actual</span><span>Diff</span><span>Rest</span></div>
      <div className="tv-hours-page" key={current}>{Array.from({ length: PER_PAGE }, (_, index) => { const row = shown[index]; if (!row) return <div key={index} className="tv-hours-row blank"/>; const diff = row.actual - row.plan; return <div key={row.id} className={`tv-hours-row ${row.live ? 'live' : ''}`}><span className="strong tv-hours-slot"><span>{row.slot}</span>{row.live && <b><i/>Live</b>}</span><span>{row.model}</span><span className="mono">{row.lot}</span><span>{row.plan}</span><span className="strong">{row.actual}</span><span className={diff >= 0 ? 'positive' : 'negative'}>{diff > 0 ? '+' : ''}{diff}</span><span>{row.restMinutes}</span></div>; })}</div>
    </div> : <div className="tv-live-empty" role="status"><strong>NO PROD</strong><span>No checksheet entered for the current shift.</span></div>}
    {pageCount > 1 && <p className="tv-live-pages" role="status">Page {current + 1} of {pageCount} · {rows.length} hourly records</p>}
  </div>;
}
