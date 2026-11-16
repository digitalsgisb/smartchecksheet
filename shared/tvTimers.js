// How long each TV Board panel stays on screen, per line. Developers set these on the TV Board page;
// 0 switches a panel off. OEE only exists on live lines.
export const tvPanels = [{ id: 'henkaten', label: '4M Board', seconds: 30 }, { id: 'live', label: 'Live Checksheet', seconds: 60 }, { id: 'oee', label: 'OEE', seconds: 60, liveOnly: true }];
export const TV_MIN_SECONDS = 5, TV_MAX_SECONDS = 900;

// Saved values over the defaults; anything missing or invalid falls back to the default.
export function tvTimers(saved = {}) {
  return Object.fromEntries(tvPanels.map(panel => { const value = saved?.[panel.id]; return [panel.id, Number.isInteger(value) && (value === 0 || value >= TV_MIN_SECONDS && value <= TV_MAX_SECONDS) ? value : panel.seconds]; }));
}

export function validateTvTimers(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Send a time for each panel.');
  const result = {};
  for (const panel of tvPanels) {
    const value = Number(body[panel.id]);
    if (!Number.isInteger(value) || value !== 0 && (value < TV_MIN_SECONDS || value > TV_MAX_SECONDS)) throw new Error(`${panel.label}: use whole seconds from ${TV_MIN_SECONDS} to ${TV_MAX_SECONDS}, or 0 to turn it off.`);
    result[panel.id] = value;
  }
  if (!tvPanels.some(panel => !panel.liveOnly && result[panel.id] > 0)) throw new Error('Keep the 4M Board or the Live Checksheet on, so every line still has something to show.');
  return result;
}

// The panels a TV rotates through, in order, with their times.
export function tvRotation(saved, live) {
  const timers = tvTimers(saved);
  return tvPanels.filter(panel => timers[panel.id] > 0 && (live || !panel.liveOnly)).map(panel => ({ id: panel.id, label: panel.label, seconds: timers[panel.id] }));
}
