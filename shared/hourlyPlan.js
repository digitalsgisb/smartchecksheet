// Fixed hourly plan, the same rule the Pi trackers use (<line>_hourly_plan.py):
// minutes of the hour (or of the part one model/lot ran) inside the shift, less planned time only
// (rest, Schedule, Planned Stop), times the hourly target. Machine, quality and production downtime never lower it.
// Times are epoch milliseconds; Malaysia has no daylight saving, so whole hours line up with UTC hours.
export const HOUR = 3600000;
export const planLoweringCategories = ['Schedule', 'Planned Stop'];
const floorHour = t => t - t % HOUR;
const finite = value => Number.isFinite(value);

// standard: the hh:00 close of the hour that just ended; closing: a model/lot change or shift end closes it now; otherwise the running segment.
export function segmentWindow(now, { segmentStart, shiftStart, shiftEnd, closing = false, standard = false } = {}) {
  let start, end;
  if (standard) { end = floorHour(now); start = end - HOUR; }
  else if (closing) { end = finite(shiftEnd) ? Math.min(now, shiftEnd) : now; start = floorHour(end - 1); }
  else { start = floorHour(now); end = start + HOUR; if (finite(shiftEnd)) end = Math.min(end, shiftEnd); }
  start = Math.max(start, ...[segmentStart, shiftStart].filter(finite));
  return { start, end: Math.max(start, end) };
}
export function fixedPlan({ start, end }, plannedLostSeconds, perHour) {
  const rate = Number(perHour); if (!(rate > 0)) return 0;
  const minutes = Math.max(0, (end - start) / 60000 - Math.max(0, Number(plannedLostSeconds) || 0) / 60);
  return Math.floor(minutes * rate / 60 + 1e-9);
}
