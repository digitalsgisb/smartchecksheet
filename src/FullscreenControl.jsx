import { useEffect, useState } from 'react';
import { Expand, Minimize } from 'lucide-react';

export default function FullscreenControl({ notify }) {
  const [active, setActive] = useState(false), [installedFullscreen, setInstalledFullscreen] = useState(false);
  useEffect(() => {
    const mode = window.matchMedia('(display-mode: fullscreen)');
    const update = () => { setActive(!!document.fullscreenElement); setInstalledFullscreen(mode.matches); };
    update(); document.addEventListener('fullscreenchange', update); mode.addEventListener('change', update);
    return () => { document.removeEventListener('fullscreenchange', update); mode.removeEventListener('change', update); };
  }, []);
  async function toggle() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      else notify('Fullscreen is unavailable in this browser. Open the installed app.', true);
    } catch { notify('Fullscreen could not open. Try again from the installed app.', true); }
  }
  // A manifest-launched fullscreen app has no Fullscreen API element to exit.
  if (installedFullscreen && !active) return null;
  const label = active ? 'Exit fullscreen' : 'Fullscreen';
  return <button className="icon-btn fullscreen-control" type="button" title={label} aria-label={label} aria-pressed={active} onClick={toggle}>{active ? <Minimize size={20}/> : <Expand size={20}/>}</button>;
}
