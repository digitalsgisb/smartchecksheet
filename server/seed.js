import { emptyTimer, malaysiaDate, slotNow } from './domain.js';

export const models = [
  { name: '0244 AT / MT', cycle: 0.82, pcsHr: 73, slabWidth: 1250, slabLength: 1800 },
  { name: '0251 RH / LH', cycle: 0.95, pcsHr: 63, slabWidth: 1200, slabLength: 1700 },
  { name: '0268 CTR', cycle: 1.1, pcsHr: 54, slabWidth: 1300, slabLength: 1800 }
];
export const people = {
  supervisors: ['Ahmad Faiz', 'Siti Aisyah', 'Lim Wei'], leaders: ['Muhammad Hakim', 'Nur Izzati'],
  operators: ['Amirul', 'Hafiz', 'Farhan', 'Azlan', 'Mei Ling', 'Nadia'], quality: ['Nur Syafiqah', 'Daniel']
};
export function seedState(demo) {
  const date = malaysiaDate(); const shiftId = `${date.replaceAll('-', '')}-Day-ABB2`;
  const henkaten = Object.fromEntries(['man', 'machine', 'material', 'method'].map(category => [category, { status: 'WAITING', issue: '', action: '', count: 0 }]));
  const base = { line: 'ABB2', revision: 0, updatedAt: new Date().toISOString(), shift: null, pendingShift: null,
    setup: null, live: { actual: 0, modelActual: 0, shiftActual: 0, plan: 0, cycle: 0, mode: 'NORMAL', status: 'Waiting', slot: slotNow(), timestamp: null },
    hourly: [], rejects: [], downtime: [], parameters: [], verification: [], henkaten, issues: [], timer: emptyTimer(), audit: [] };
  if (!demo) return base;
  return { ...base,
    shift: { id: shiftId, date, shift: 'Day', overtime: true, workingTime: '08:00 – 20:00', supervisor: 'Ahmad Faiz', leader: 'Muhammad Hakim', forming: ['Amirul', 'Hafiz'], waterjet: ['Farhan'], assembly: ['Azlan', 'Mei Ling'], quality: 'Nur Syafiqah', status: 'active' },
    setup: { model: models[0].name, lot: 'SG-2409-018', plan: 73, cycle: 0.82, configuredAt: new Date().toISOString() },
    live: { actual: 42, modelActual: 376, shiftActual: 376, plan: 48, cycle: 0.86, mode: 'NORMAL', status: 'Running', slot: slotNow(), timestamp: new Date().toISOString() },
    hourly: [
      { id: 'demo-hour-1', shiftId, slot: '8.00-9.00', model: models[0].name, lot: 'SG-2409-018', plan: 68, actual: 65, restMinutes: 0 },
      { id: 'demo-hour-2', shiftId, slot: '9.00-10.00', model: models[0].name, lot: 'SG-2409-018', plan: 73, actual: 71, restMinutes: 0 },
      { id: 'demo-hour-3', shiftId, slot: '10.00-11.00', model: models[0].name, lot: 'SG-2409-018', plan: 60, actual: 58, restMinutes: 10 },
      { id: 'demo-hour-4', shiftId, slot: '11.00-12.00', model: models[0].name, lot: 'SG-2409-018', plan: 73, actual: 72, restMinutes: 0 },
      { id: 'demo-hour-5', shiftId, slot: '12.00-13.00', model: models[0].name, lot: 'SG-2409-018', plan: 73, actual: 68, restMinutes: 0 }
    ],
    rejects: [{ id: 'demo-reject', shiftId, slot: '10.00-11.00', ng: 3, loft: 1, slab: 0, returnRoll: 0, code: 'Surface defect', remarks: 'Segregated for inspection', actor: 'Nur Syafiqah', createdAt: new Date().toISOString() }],
    downtime: [{ id: 'demo-down', shiftId, slot: '10.00-11.00', category: 'Machine', reason: 'Waterjet nozzle adjustment', duration: 8, action: 'Nozzle replaced and pressure verified', actor: 'Muhammad Hakim', createdAt: new Date().toISOString() }],
    parameters: [{ id: 'demo-param', shiftId, model: models[0].name, heating: 65, cooling: 30, shuttle: '2A', waterjet: 'WJ-02', rh: 168, ctr: 170, lh: 169, glueStd: 12, glueActual: 12.2, actor: 'Amirul', createdAt: new Date().toISOString() }],
    henkaten: { man: { status: 'OK', issue: '', action: 'Manpower confirmed', count: 0 }, machine: { status: 'NG', issue: 'Waterjet pressure fluctuating', action: 'Monitor pressure after nozzle replacement', count: 1 }, material: { status: 'OK', issue: '', action: 'Incoming material verified', count: 0 }, method: { status: 'OK', issue: '', action: 'Parameters confirmed', count: 0 } },
    issues: [{ id: 'demo-issue', category: 'machine', issue: 'Waterjet pressure fluctuating', action: 'Monitor pressure after nozzle replacement', status: 'pending', actor: 'Muhammad Hakim', createdAt: new Date().toISOString() }],
    audit: [{ id: 'demo-audit', label: 'Parameter condition confirmed', actor: 'Amirul', createdAt: new Date().toISOString() }]
  };
}
