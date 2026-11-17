import { useEffect, useMemo, useState } from 'react';
import './tv-prs.css';
import { tvChecksheet } from './tvChecksheet.js';
import { prsLines, prsPages, prsTotals } from './prsLines.js';
import { PrsTable } from './PrsSheet.jsx';

const PER_PAGE = 7; // lines shown at once; the rows stretch to fill the screen
// The live checksheet for a TV: big totals on top, then the same PRS table as the Live Checksheet, paged so nothing needs scrolling.
export default function TvLive({ state, seconds = 60 }) {
  const serverOffset = useMemo(() => Number.isFinite(state.serverTime) ? state.serverTime - Date.now() : 0, [state.serverTime]);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const { shift, setup, rows, output, rejects, downtime, previous } = tvChecksheet(state, now + serverOffset);
  const lines = prsLines({ ...state, shift }, [...rows].reverse()), pages = prsPages(lines, PER_PAGE), pageCount = pages.length;
  const [page, setPage] = useState(0);
  const current = Math.min(page, pageCount - 1);
  useEffect(() => setPage(0), [shift?.id, rows[0]?.id, rows[0]?.slot, lines.length]);
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
    {lines.length ? <div className="tv-prs" key={current}><PrsTable lines={shown} totals={prsTotals(lines)} className="tv"/></div> : <div className="tv-live-empty" role="status"><strong>NO PROD</strong><span>No checksheet entered for the current shift.</span></div>}
    {pageCount > 1 && <p className="tv-live-pages" role="status">Page {current + 1} of {pageCount} · {lines.length} hourly records</p>}
  </div>;
}
