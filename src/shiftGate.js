// Which state the "no active shift" popup is in. After Start new shift the line (Python) has to confirm,
// so the popup follows the request: waiting, then success once the shift is active, or failed if the line does not answer.
export function shiftGateMode({ request, active, pendingShift, command, timedOut }) {
  if (!request || pendingShift) return 'idle'; // nothing requested, or the shift is scheduled for later
  if (active) return 'success';
  if (timedOut || ['failed', 'rejected', 'unconfirmed'].includes(command?.status)) return 'failed';
  return 'waiting';
}
