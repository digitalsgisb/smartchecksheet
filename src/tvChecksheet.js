import { shiftSchedule } from '../shared/shiftSchedule.js';

const malaysiaDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit' });
const malaysiaHour = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kuala_Lumpur', hour: '2-digit', hourCycle: 'h23' });
function hourOrder(slot, startHour) {
  const time = String(slot || '').match(/^(\d{1,2})[.:](\d{2})/);
  return time ? (Number(time[1]) * 60 + Number(time[2]) - startHour * 60 + 1440) % 1440 : -1;
}
// Scope only the TV view; saved checksheets and reports remain available in the workspace.
export function tvChecksheet(state, now = Date.now()) {
  const empty = { shift: null, setup: null, rows: [], output: 0, rejects: 0, downtime: 0, previous: false };
  const shift = state.shift;
  if (!shift?.id || shift.id === 'NO PROD' || !['active', 'ended'].includes(shift.status)) return empty;
  // The line retains its latest shift. Allow that one fallback for today or yesterday only.
  if (![malaysiaDate.format(now), malaysiaDate.format(now - 86400000)].includes(shift.date)) return empty;
  let schedule;
  try { schedule = shiftSchedule(shift.date, shift.shift, shift.overtime); } catch { return empty; }
  const start = Date.parse(shift.startAt || schedule.startAt), end = Date.parse(shift.endAt || schedule.endAt);
  if (!Number.isFinite(end) || !(now >= start && end > start)) return empty;
  const previous = shift.status === 'ended' || now >= end;
  const startHour = Number(malaysiaHour.format(start));
  const rows = state.hourly.filter(record => record.shiftId === shift.id).reverse().sort((a, b) => hourOrder(b.slot, startHour) - hourOrder(a.slot, startHour));
  if (!previous && state.setup) rows.unshift({ id: 'live', slot: state.live.slot, model: state.setup.model, lot: state.setup.lot, plan: state.live.plan, actual: state.live.actual, restMinutes: '—', live: true });
  const rejects = state.rejects.filter(record => record.shiftId === shift.id).reduce((sum, record) => sum + Number(record.ng || 0) + Number(record.loft || 0), 0);
  const downtime = state.downtime.filter(record => record.shiftId === shift.id).reduce((sum, record) => sum + Number(record.duration || 0), 0);
  return { shift, setup: state.setup, rows, output: state.live.shiftActual, rejects, downtime, previous };
}

// Keep the current hour visible while older hours rotate below it.
export function tvHourlyPages(rows, perPage = 6) {
  const live = rows.find(row => row.live), saved = rows.filter(row => !row.live);
  const capacity = perPage - (live ? 1 : 0);
  return Array.from({ length: Math.max(1, Math.ceil(saved.length / capacity)) }, (_, index) => [...(live ? [live] : []), ...saved.slice(index * capacity, (index + 1) * capacity)]);
}
