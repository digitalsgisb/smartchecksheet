// OEE from one Python live payload (smartchecksheet/live). Same formula as the Node-RED "oee calculator" it replaces.
// Times arrive in seconds; standard_cycle_time is in minutes per piece. Every ratio is 0..1, and a zero divisor gives 0.
const num = v => typeof v === 'number' && Number.isFinite(v) ? v : 0;
const ratio = (n, d) => d > 0 ? Math.max(0, Math.min(1, n / d)) : 0;
const round = (v, places) => Math.round(v * 10 ** places) / 10 ** places;

export function oeeFromLive(p = {}) {
  const planned = Math.max(0, num(p.total_machine_time) - num(p.total_rest_time) - num(p.planned_stop_time) - num(p.model_change_time));
  const cycle = num(p.standard_cycle_time), count = num(p.product_count), rejects = num(p.total_reject);
  const realTimePcs = cycle > 0 ? num(p.real_operating_time) / 60 / cycle : 0;
  const availability = ratio(planned - num(p.downtime), planned), performance = ratio(count, realTimePcs), quality = ratio(count - rejects, count);
  // Progress as on the Grafana board: product_count / hourly_plan (shown there as "Daily Target"). Not clamped.
  const target = num(p.hourly_plan);
  return { availability: round(availability, 4), performance: round(performance, 4), quality: round(quality, 4), oee: round(availability * performance * quality, 4), realTimePcs: round(realTimePcs, 2), shortPcs: round(count - realTimePcs, 2), progress: target > 0 ? round(count / target, 4) : 0 };
}

// Machine timers from the same payload, in seconds, under names the screens use.
export function timersFromLive(p = {}) {
  return { run: num(p.run_time), loading: num(p.loading_time), delay: num(p.delay_time), downtime: num(p.downtime), rest: num(p.total_rest_time), plannedStop: num(p.planned_stop_time), modelChange: num(p.model_change_time), machine: num(p.total_machine_time), realOperating: num(p.real_operating_time), totalRealOperating: num(p.total_real_operating_time) };
}

// Python machine_status codes, in order (Grafana's mapping). Unknown codes read as Waiting.
export const machineStatusNames = ['Running', 'Loading', 'Delay', 'Rest', 'Downtime', 'Planned stop', 'Model change', 'Fill shift'];
