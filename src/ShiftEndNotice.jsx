import { useEffect, useRef, useState } from 'react';
import { Bell, X } from 'lucide-react';
import { finishedShift } from './shiftNotification.js';

export default function ShiftEndNotice({ shift, pendingShift, writable, open, go }) {
  const previous = useRef(null);
  const [finished, setFinished] = useState(null);
  useEffect(() => {
    const old = previous.current;
    const ended = finishedShift(old, shift);
    if (ended) setFinished(ended);
    previous.current = shift;
  }, [shift?.id, shift?.status]);
  if (!finished) return null;
  const nextStarted = shift?.status === 'active' && shift.id !== finished.id;
  return <aside className="shift-end-notice" role="alert"><Bell size={30}/><div><strong>SHIFT FINISHED</strong><p>{finished.shift} shift · {finished.date}{nextStarted ? ' · Next shift has started.' : pendingShift ? ' · Next shift is scheduled.' : ''}</p></div>{!nextStarted && !pendingShift && writable ? <button className="btn" onClick={() => { setFinished(null); open('shift'); }}>START NEXT SHIFT</button> : <button className="btn" onClick={() => { setFinished(null); go('checksheet'); }}>OPEN CHECKSHEET</button>}<button type="button" className="icon-btn" aria-label="Dismiss shift finished notification" onClick={() => setFinished(null)}><X size={23}/></button></aside>;
}
