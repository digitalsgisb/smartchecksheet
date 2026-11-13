// Production dates and working hours are always in Malaysia time, including overnight shifts.
export function shiftSchedule(date, shift, overtime) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00+08:00`))) throw new Error('A valid production date is required.');
  if (!['Day', 'Night'].includes(shift)) throw new Error('Choose Day or Night.');
  const start = shift === 'Day' ? '08:00' : overtime ? '20:00' : '16:15';
  const end = shift === 'Day' ? overtime ? '20:00' : '16:15' : overtime ? '08:00' : '00:30';
  let endAt = new Date(`${date}T${end}:00+08:00`);
  if (shift === 'Night') endAt = new Date(endAt.getTime() + 86400000);
  return { startAt: new Date(`${date}T${start}:00+08:00`).toISOString(), endAt: endAt.toISOString(), workingTime: `${start} – ${end}` };
}
