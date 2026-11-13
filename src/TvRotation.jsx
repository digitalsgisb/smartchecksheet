import { useEffect, useState } from 'react';

// Shows its panels one at a time on a timer, for a screen nobody touches (the TV on the line).
// Each panel has its own time. A small strip at the bottom names the panels; the current one fills as its time runs out.
export default function TvRotation({ panels, seconds = 30 }) {
  const [index, setIndex] = useState(0);
  const current = panels[index % panels.length];
  const duration = current.seconds ?? seconds;
  useEffect(() => {
    const timer = setTimeout(() => setIndex(value => (value + 1) % panels.length), duration * 1000);
    return () => clearTimeout(timer);
  }, [index, duration, panels.length]);
  return <div className="tv-rotation">
    <div className="tv-rotation-panel" key={current.id} role="tabpanel">{current.node}</div>
    <div className="tv-rotation-strip" role="tablist" aria-label="TV board panels">{panels.map((panel, position) => <button key={panel.id} role="tab" aria-selected={panel.id === current.id} className={panel.id === current.id ? 'active' : ''} onClick={() => setIndex(position)}>{panel.label}{panel.id === current.id && <i key={index} style={{ animationDuration: `${duration}s` }}/>}</button>)}</div>
  </div>;
}
