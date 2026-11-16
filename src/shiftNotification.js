export function finishedShift(previous, current) {
  if (current?.status === 'ended') return current;
  if (previous?.status === 'active' && current?.id && previous.id !== current.id) return previous;
  return null;
}

// What the line TV announces when a shift starts or its model/lot setup is confirmed. Takes the previous and current
// { shift, setup } from the line state; the first state seen (TV just opened, line switched) announces nothing.
export function setupNotice(previous, current) {
  if (!previous || !current) return null;
  const shift = current.shift, setup = current.setup, before = previous.shift;
  if (shift?.status !== 'active') return null;
  const setupText = setup?.model ? [setup.model, setup.lot && `Lot ${setup.lot}`].filter(Boolean).join(' · ') : '';
  if (before?.id !== shift.id || before?.status !== 'active') return { kind: 'shift', title: `${shift.shift} shift started`, text: setupText || 'Waiting for model setup', detail: [shift.leader && `Leader ${shift.leader}`, shift.workingTime].filter(Boolean).join(' · ') };
  const old = previous.setup;
  if (!setup?.model || old?.model === setup.model && old?.lot === setup.lot && old?.plan === setup.plan) return null;
  return { kind: 'setup', title: old?.model && old.model !== setup.model ? 'Model changed' : 'Setup confirmed', text: setupText, detail: setup.plan ? `Target ${setup.plan} pcs/hr` : '' };
}
