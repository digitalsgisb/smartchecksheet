import { shiftSchedule } from '../shared/shiftSchedule.js';

const malaysiaDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit' });
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
  const rows = state.hourly.filter(record => record.shiftId === shift.id);
  if (!previous && state.setup) rows.push({ id: 'live', slot: state.live.slot, model: state.setup.model, lot: state.setup.lot, plan: state.live.plan, actual: state.live.actual, restMinutes: '—', live: true });
  const rejects = state.rejects.filter(record => record.shiftId === shift.id).reduce((sum, record) => sum + Number(record.ng || 0) + Number(record.loft || 0), 0);
  const downtime = state.downtime.filter(record => record.shiftId === shift.id).reduce((sum, record) => sum + Number(record.duration || 0), 0);
  return { shift, setup: state.setup, rows, output: state.live.shiftActual, rejects, downtime, previous };
}
