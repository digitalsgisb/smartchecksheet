import './tv-notice.css';
import { useEffect, useRef, useState } from 'react';
import { Bell, Package } from 'lucide-react';
import { setupNotice } from './shiftNotification.js';


const SHOW_MS = 12000, LEAVE_MS = 600;
// Glass banner on the line TV when a shift starts or the model/lot setup is confirmed. Nobody touches the TV,
// so it leaves by itself; a newer notice replaces an older one.
export default function TvShiftNotice({ line, shift, setup }) {
  const previous = useRef(null);
  const [notice, setNotice] = useState(null);
  const [leaving, setLeaving] = useState(false);
  const key = [line, shift?.id, shift?.status, setup?.model, setup?.lot, setup?.plan].join('|');
  useEffect(() => {
    const current = { line, shift, setup };
    const next = previous.current?.line === line ? setupNotice(previous.current, current) : null;
    previous.current = current;
    if (next) { setNotice({ ...next, id: key }); setLeaving(false); }
  }, [key]);
  useEffect(() => {
    if (!notice) return;
    const leave = setTimeout(() => setLeaving(true), SHOW_MS), gone = setTimeout(() => setNotice(null), SHOW_MS + LEAVE_MS);
    return () => { clearTimeout(leave); clearTimeout(gone); };
  }, [notice?.id]);
  if (!notice) return null;
  const Icon = notice.kind === 'shift' ? Bell : Package;
  return <aside key={notice.id} className={`tv-notice ${notice.kind} ${leaving ? 'leaving' : ''}`} role="status" aria-live="polite">
    <span className="tv-notice-icon"><Icon size={34}/></span>
    <div><strong>{notice.title}</strong><p>{notice.text}</p>{notice.detail && <em>{notice.detail}</em>}</div>
    <i className="tv-notice-timer"/>
  </aside>;
}
