import { timingSafeEqual } from 'node:crypto';
import { createAttendanceSource, summarizeAttendance } from './attendance.js';
import { lineGroupMap } from './executive.js';
import { productionGroup } from '../shared/productionGroups.js';
import { shiftSchedule } from './domain.js';

const key = (line, shift) => JSON.stringify([line, shift.date, shift.shift]);
export function createShiftBoard({ db, attendance, lines, snapshot, token = '', mode = 'attendance', fetcher = fetch, now = Date.now }) {
  token = token.trim();
  db.exec(`CREATE TABLE IF NOT EXISTS shift_board_bindings (binding_key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS shift_board_feed (feed_key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
  const source = createAttendanceSource(attendance, fetcher);
  function binding(line, shift) { return shift ? JSON.parse(db.prepare('SELECT value FROM shift_board_bindings WHERE binding_key=?').get(key(line, shift))?.value || 'null') : null; }
  async function employees(line) {
    const group = productionGroup(lineGroupMap(db)[line]);
    if (!group) throw new Error('Map this line to its division and site in Executive Workspace first.');
    if (!attendance.url || !attendance.token) throw new Error('Connect Attendance before linking shift-board employees.');
    let data;
    try { data = await source(); } catch { throw new Error('Attendance is unavailable. Employee IDs could not be verified.'); }
    const people = new Map();
    for (const mapping of attendance.groups.filter(item => item.accountLines.includes(line))) {
      for (const person of summarizeAttendance(data.employees, { ...mapping, productionGroup: group }, data.updatedAt).employees) people.set(String(person.id), { id: String(person.id), name: person.name, group: group.label });
    }
    return [...people.values()];
  }
  return {
    async prepare(line, p) {
      // Older clients may continue recording shifts without opting in to board control.
      if (p.attendanceEmployeeIds === undefined) return null;
      if (!Array.isArray(p.attendanceEmployeeIds) || p.attendanceEmployeeIds.length > 500 || p.attendanceEmployeeIds.some(id => typeof id !== 'string' || !id || id.length > 100) || new Set(p.attendanceEmployeeIds).size !== p.attendanceEmployeeIds.length) throw new Error('Choose valid Attendance employees.');
      if (![15, 30].includes(p.boardGraceMinutes)) throw new Error('Choose a 15 or 30 minute board grace period.');
      const group = productionGroup(lineGroupMap(db)[line]);
      if (p.attendanceEmployeeIds.length) {
        const allowed = new Set((await employees(line)).map(person => person.id));
        if (p.attendanceEmployeeIds.some(id => !allowed.has(id))) throw new Error('An employee is outside this line’s Attendance group, plant or division.');
      }
      return { employeeIds: p.attendanceEmployeeIds, graceMinutes: p.boardGraceMinutes, groupId: group?.id || null, overtime: p.overtime };
    },
    save(line, shift, selection) {
      if (selection) db.prepare('INSERT INTO shift_board_bindings VALUES(?,?) ON CONFLICT(binding_key) DO UPDATE SET value=excluded.value').run(key(line, shift), JSON.stringify(selection));
    },
    decorate(line, state) {
      const selection = binding(line, state.shift);
      return { ...state, shift: state.shift && { ...state.shift, attendanceEmployeeIds: selection?.employeeIds || [], boardGraceMinutes: selection?.graceMinutes || 30 } };
    },
    async options(req, res) {
      try { res.json({ employees: await employees(req.line), feedEnabled: token.length >= 32 && mode !== 'demo' }); }
      catch (error) { res.status(503).json({ error: error.message }); }
    },
    capture() {
      if (mode === 'demo') return;
      for (const line of lines()) {
        const state = snapshot(line), shift = state.shift, selected = binding(line, shift);
        if (!shift || !selected || selected.overtime !== shift.overtime || selected.groupId !== lineGroupMap(db)[line]) continue;
        let scheduled;
        try { scheduled = shiftSchedule(shift.date, shift.shift, shift.overtime); } catch { continue; }
        const startAt = shift.startAt || scheduled.startAt, plannedEnd = shift.endAt || scheduled.endAt;
        if (!Number.isFinite(Date.parse(startAt)) || !Number.isFinite(Date.parse(plannedEnd))) continue;
        const feedKey = JSON.stringify([line, shift.id]);
        const previous = JSON.parse(db.prepare('SELECT value FROM shift_board_feed WHERE feed_key=?').get(feedKey)?.value || 'null');
        const endedAt = shift.status === 'ended' ? previous?.endedAt || new Date(Math.min(now(), Date.parse(plannedEnd))).toISOString() : null;
        const endAt = endedAt || plannedEnd;
        const record = { id: feedKey, line, shiftId: shift.id, date: shift.date, shift: shift.shift, overtime: shift.overtime,
          groupId: selected.groupId, employeeIds: selected.employeeIds, startAt, endAt, endedAt,
          graceMinutes: selected.graceMinutes, greyAt: new Date(Date.parse(endAt) + selected.graceMinutes * 60000).toISOString() };
        if (JSON.stringify(record) !== JSON.stringify(previous)) db.prepare('INSERT INTO shift_board_feed VALUES(?,?) ON CONFLICT(feed_key) DO UPDATE SET value=excluded.value').run(feedKey, JSON.stringify(record));
      }
    },
    feed(req, res) {
      const supplied = String(req.headers.authorization || '').replace(/^Bearer /, '');
      const a = Buffer.from(token), b = Buffer.from(supplied);
      if (mode === 'demo' || a.length < 32 || a.length !== b.length || !timingSafeEqual(a, b)) return res.status(401).json({ error: 'Shift-feed authentication required.' });
      const mapping = lineGroupMap(db);
      const shifts = db.prepare('SELECT value FROM shift_board_feed').all().map(row => JSON.parse(row.value)).filter(record => record.groupId === mapping[record.line] && Date.parse(record.endAt) > now() - 14 * 86400000);
      res.json({ schema: 1, generatedAt: new Date(now()).toISOString(), shifts });
    }
  };
}
