export const roles = ['operator', 'management', 'executive', 'developer', 'display'];
export const canWrite = user => ['operator', 'management', 'developer'].includes(user.role);
export const canManage = user => ['management', 'developer'].includes(user.role);
export const malaysiaDate = (date = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
export const malaysiaHour = (date = new Date()) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kuala_Lumpur', hour: '2-digit', hourCycle: 'h23' }).format(date));
export const slotNow = () => { const h = malaysiaHour(); return `${h}.00-${(h + 1) % 24}.00`; };
export const emptyTimer = (revision = 0) => ({ id: null, status: 'idle', revision, startedAt: null, stoppedAt: null, targetMinutes: 0, elapsedSeconds: 0, category: 'Machine', reason: '', action: '', remarks: '' });
export function requireText(value, name, max = 500) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${name} is required (maximum ${max} characters).`);
  return value.trim();
}
export function finiteNumber(value, name, min = 0, max = 100000) {
  const n = Number(value);
  if (value === '' || value == null || !Number.isFinite(n) || n < min || n > max) throw new Error(`${name} must be between ${min} and ${max}.`);
  return n;
}
export function aggregateHourly(rows) {
  // Keep source segments intact: a model or lot change can produce multiple rows in one slot.
  const grouped = new Map();
  for (const row of rows) {
    const key = `${row.shiftId}|${row.slot}|${row.model}|${row.lot}`;
    const old = grouped.get(key) || { ...row, plan: 0, actual: 0, restMinutes: 0 };
    old.plan += Number(row.plan) || 0; old.actual += Number(row.actual) || 0;
    old.restMinutes += Number(row.restMinutes) || 0;
    grouped.set(key, old);
  }
  return [...grouped.values()];
}
export function rejectTotals(rows) {
  return rows.reduce((sum, r) => ({ pieces: sum.pieces + Number(r.ng || 0) + Number(r.loft || 0), slab: sum.slab + Number(r.slab || 0), returnRoll: sum.returnRoll + Number(r.returnRoll || 0) }), { pieces: 0, slab: 0, returnRoll: 0 });
}
export function requireOvertime(value) {
  if (typeof value !== 'boolean') throw new Error('Choose NO OT or WITH OT for this shift.');
  return value;
}
export { shiftSchedule } from '../shared/shiftSchedule.js';
