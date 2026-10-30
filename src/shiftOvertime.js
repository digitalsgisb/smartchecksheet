export function shiftWorkingHours(shift, overtime) {
  if (typeof overtime !== 'boolean') return '';
  if (shift === 'Day') return overtime ? '08:00 – 20:00' : '08:00 – 16:15';
  return overtime ? '20:00 – 08:00 (+1 day)' : '16:15 – 00:30 (+1 day)';
}
export function shiftOvertimeSummary(shift, overtime) {
  if (typeof overtime !== 'boolean') return 'Choose NO OT or WITH OT to continue.';
  return `${shift} · ${overtime ? 'WITH OT' : 'NO OT'} · ${shiftWorkingHours(shift, overtime)}`;
}
