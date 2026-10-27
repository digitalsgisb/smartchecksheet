import { useEffect, useState } from 'react';

const format = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kuala_Lumpur', hour: '2-digit', minute: '2-digit'
});

// Clock ticks stay inside the clock instead of rendering every form and dropdown.
export default function HeaderClock() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return <span className="desktop-clock">{format.format(now)} <small>MYT</small></span>;
}
