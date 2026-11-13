import { useEffect, useState } from 'react';

const zone = 'Asia/Kuala_Lumpur';
const format = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit' });
const dateFormat = new Intl.DateTimeFormat('en-GB', { timeZone: zone, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

// Clock ticks stay inside the clock instead of rendering every form and dropdown.
// On the TV board it is large and shows the date too, so it can be read from across the floor.
export default function HeaderClock({ tv = false }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  if (tv) return <span className="tv-clock" role="timer" aria-label={`${dateFormat.format(now)}, ${format.format(now)} Malaysia time`}><strong>{format.format(now)}</strong><small>{dateFormat.format(now)}</small></span>;
  return <span className="desktop-clock">{format.format(now)} <small>MYT</small></span>;
}
