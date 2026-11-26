// Rows of the PRS sheet, shared by the Live Checksheet and the TV board: one line per hour and model segment, in shift
// order, each carrying that hour's downtime (on its last segment) and the SPV sign-off for the hour.
const slotStart = slot => { const h = Number(String(slot).match(/^(\d{1,2})/)?.[1]); return Number.isFinite(h) ? h : 99; };
// Shift hours run from 08:00 (day) or 16:15 / 20:00 (night) past midnight, so order slots by hours since 08:00.
const order = slot => (slotStart(slot) - 8 + 24) % 24;

export function prsLines(state, rows) {
  const shiftId = state.shift?.id;
  const downtime = (state.downtime || []).filter(d => !shiftId || !d.shiftId || d.shiftId === shiftId);
  const signs = (state.verification || []).filter(v => v.hour && (!shiftId || v.shiftId === shiftId));
  const slots = [...new Set([...rows.map(r => r.slot), ...downtime.map(d => d.slot)].filter(Boolean))].sort((a, b) => order(a) - order(b));
  // No counts hours, not model segments: the sheet shows one numbered, merged row per hour like the paper form.
  return slots.flatMap((slot, hour) => {
    const segments = rows.filter(r => r.slot === slot);
    return (segments.length ? segments : [{ id: `slot-${slot}`, slot, empty: true }]).map((row, index, all) => ({ ...row, no: hour + 1, downtime: index === all.length - 1 ? downtime.filter(d => d.slot === slot) : [], signed: signs.find(v => v.hour === slot) || null }));
  });
}

export const prsColumns = ['Schedule', 'Production', 'Machine', 'Quality'];
export const prsColumnFor = category => category === 'Planned Stop' ? 'Schedule' : category;

export function prsTotals(lines) {
  const minutes = Object.fromEntries(prsColumns.map(key => [key, 0]));
  for (const line of lines) for (const d of line.downtime) if (prsColumnFor(d.category) in minutes) minutes[prsColumnFor(d.category)] += Number(d.duration || 0);
  const slots = [...new Set(lines.map(line => line.slot))];
  return { plan: lines.reduce((n, r) => n + Number(r.empty ? 0 : r.plan || 0), 0), actual: lines.reduce((n, r) => n + Number(r.empty ? 0 : r.actual || 0), 0), minutes, signed: slots.filter(slot => lines.some(line => line.slot === slot && line.signed)).length, hours: slots.length };
}

// Shift output per model, in the order the models were first run: plan, actual and the lots run.
export function prsModelTotals(lines) {
  const models = new Map();
  for (const line of lines) {
    if (line.empty || !line.model) continue;
    const m = models.get(line.model) || { model: line.model, plan: 0, actual: 0, lots: [] };
    m.plan += Number(line.plan || 0); m.actual += Number(line.actual || 0); if (line.lot && !m.lots.includes(line.lot)) m.lots.push(line.lot);
    models.set(line.model, m);
  }
  return [...models.values()];
}

// The TV shows a fixed number of lines: the live hour stays at the bottom of every page, older hours page above it, newest page first.
export function prsPages(lines, perPage) {
  const live = lines.filter(line => line.live), saved = lines.filter(line => !line.live), capacity = Math.max(1, perPage - live.length);
  const count = Math.max(1, Math.ceil(saved.length / capacity));
  return Array.from({ length: count }, (_, index) => { const end = saved.length - index * capacity; return [...saved.slice(Math.max(0, end - capacity), Math.max(0, end)), ...live]; });
}
