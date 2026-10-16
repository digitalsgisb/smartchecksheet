export function finishedShift(previous, current) {
  if (current?.status === 'ended') return current;
  if (previous?.status === 'active' && current?.id && previous.id !== current.id) return previous;
  return null;
}
