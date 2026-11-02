import { randomUUID } from 'node:crypto';
import { productionGroups, productionGroup } from '../shared/productionGroups.js';
import { createAttendanceSource, summarizeAttendance } from './attendance.js';
import { malaysiaDate, requireText } from './domain.js';

const administrators = user => ['management', 'developer'].includes(user.role);
const fail = (status, message) => Object.assign(new Error(message), { status });
export function lineGroupMap(db) { return Object.fromEntries(db.prepare('SELECT line,group_id FROM production_line_groups').all().map(row => [row.line, row.group_id])); }
export function executiveUser(db, user) {
  if (user.role !== 'executive') return user;
  const mapping = lineGroupMap(db);
  return { ...user, lines: user.lines.filter(line => productionGroup(user.executiveGroup) && mapping[line] === user.executiveGroup) };
}
export function attendanceProductionGroup(group, mapping) {
  const ids = [...new Set(group.accountLines.map(line => mapping[line]))];
  return ids.length === 1 ? productionGroup(ids[0]) || null : null;
}
const assignment = row => ({ id: row.id, employeeId: row.employee_id, employeeName: row.employee_name, groupId: row.group_id, line: row.line, shiftName: row.shift_name, startAt: row.start_at, endAt: row.end_at, updatedBy: row.updated_by, updatedAt: row.updated_at });
function dateWindow(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) throw fail(400, 'Choose a valid date.');
  const start = new Date(`${date}T00:00:00+08:00`);
  return [start.toISOString(), new Date(start.getTime() + 86400000).toISOString()];
}
export function createExecutiveWorkspace({ db, lines, attendance, snapshot, onChange = () => {}, fetcher = fetch }) {
  const source = createAttendanceSource(attendance, fetcher);
  function access(user) {
    if (!user) throw fail(401, 'Please sign in.');
    if (!administrators(user) && user.role !== 'executive') throw fail(403, 'Executive access required.');
    return executiveUser(db, user);
  }
  function scope(user) {
    const mapping = lineGroupMap(db);
    return lines().filter(line => user.lines.includes(line)).map(line => ({ line, groupId: mapping[line] || '', group: productionGroup(mapping[line]) || null }));
  }
  async function people(user) {
    if (!attendance.url || !attendance.token || !attendance.groups.length) throw fail(503, 'Attendance is not connected. Configure the employee connection before assigning shifts.');
    const data = await source();
    const mapping = lineGroupMap(db), allowed = scope(user), result = new Map();
    for (const group of attendance.groups) {
      const label = attendanceProductionGroup(group, mapping);
      const accountLines = group.accountLines.filter(line => allowed.some(item => item.line === line && item.groupId === label?.id));
      if (!label || !accountLines.length) continue;
      for (const person of summarizeAttendance(data.employees, { ...group, productionGroup: label }, data.updatedAt).employees) {
        const id = String(person.id), existing = result.get(id);
        // Ambiguous source membership must never permit a cross-division assignment.
        if (existing && existing.productionGroup?.id !== label.id) throw fail(502, 'An employee belongs to conflicting Attendance groups. Correct the employee grouping in Attendance.');
        result.set(id, { ...person, id, allowedLines: [...new Set([...(existing?.allowedLines || []), ...allowed.filter(item => item.groupId === label.id).map(item => item.line)])] });
      }
    }
    return { employees: [...result.values()], updatedAt: data.updatedAt };
  }
  const handler = fn => async (req, res) => {
    try { const user = access(req.user); await fn(req, res, user); }
    catch (error) { res.status(error.status || 502).json({ error: error.status ? error.message : 'Attendance is unavailable. Check the employee connection and try again.' }); }
  };
  return {
    list: handler(async (req, res, user) => {
      const [start, end] = dateWindow(req.query.date || malaysiaDate());
      const scoped = scope(user), allowed = new Set(scoped.map(item => item.line));
      let staff = { employees: [], updatedAt: null }, attendanceError = '';
      try { staff = await people(user); } catch (error) { attendanceError = error.status ? error.message : 'Attendance is unavailable. Employee status could not be refreshed.'; }
      const assignments = db.prepare('SELECT * FROM shift_assignments WHERE start_at < ? AND end_at > ? ORDER BY start_at,line,employee_name').all(end, start).filter(row => allowed.has(row.line) && scoped.some(item => item.line === row.line && item.groupId === row.group_id)).map(assignment);
      res.json({ groups: productionGroups.filter(group => administrators(user) || group.id === user.executiveGroup), canConfigure: administrators(user), lines: scoped.map(item => {
        const state = snapshot(item.line);
        return { ...item, shift: state.shift, live: state.live, connected: state.connected, pendingIssues: state.issues?.filter(issue => issue.status === 'pending').length || 0 };
      }), ...staff, attendanceError, assignments });
    }),
    configure: handler(async (req, res, user) => {
      if (!administrators(user)) throw fail(403, 'Management access required.');
      const mapping = req.body.lineGroups;
      if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) throw fail(400, 'Choose a production group for each line.');
      const current = lineGroupMap(db), available = new Set(scope(user).map(item => item.line));
      for (const [line, id] of Object.entries(mapping)) {
        if (!available.has(line) || id && !productionGroup(id)) throw fail(400, 'Invalid line or production group.');
        current[line] = id;
      }
      for (const group of attendance.groups) {
        const ids = [...new Set(group.accountLines.map(line => current[line]).filter(Boolean))];
        if (ids.length > 1) throw fail(400, `${group.label} spans multiple production groups. Separate its Attendance mapping first.`);
        if (ids.length && group.accountLines.some(line => !current[line])) throw fail(400, `Map all lines in ${group.label} to the same group, or leave them all unassigned.`);
        if (ids.length && (group.section === 'ROLL MAKING' || group.lines?.some(line => line.toUpperCase() === 'ROLL MAKING')) !== (ids[0] === 'roll-making-port-klang')) throw fail(400, `${group.label} must match its Conversion or Roll Making division.`);
      }
      // Keep saved assignments attached to their original division and site.
      for (const [line, id] of Object.entries(mapping)) if (id !== lineGroupMap(db)[line] && db.prepare('SELECT 1 FROM shift_assignments WHERE line=? AND end_at>? LIMIT 1').get(line, new Date().toISOString())) throw fail(409, 'Remove current and future assignments before moving a line to another group.');
      db.exec('BEGIN IMMEDIATE');
      try {
        for (const [line, id] of Object.entries(mapping)) {
          if (id) db.prepare('INSERT INTO production_line_groups(line,group_id) VALUES(?,?) ON CONFLICT(line) DO UPDATE SET group_id=excluded.group_id').run(line, id);
          else db.prepare('DELETE FROM production_line_groups WHERE line=?').run(line);
        }
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      onChange(); res.json({ ok: true });
    }),
    save: handler(async (req, res, user) => {
      const p = req.body, scoped = scope(user), target = scoped.find(item => item.line === p.line && item.group);
      if (!target) throw fail(403, 'Choose a line in your production group.');
      const old = p.id ? db.prepare('SELECT * FROM shift_assignments WHERE id=?').get(p.id) : null;
      if (p.id && (!old || !scoped.some(item => item.line === old.line && item.groupId === old.group_id))) throw fail(403, 'Assignment is outside your access.');
      if (old && old.updated_at !== p.updatedAt) throw fail(409, 'This assignment changed. Refresh before editing.');
      let shiftName;
      try { shiftName = requireText(p.shiftName, 'Shift name', 60); } catch (error) { throw fail(400, error.message); }
      const dates = [p.startAt, p.endAt].map(value => typeof value === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? Date.parse(value) : NaN);
      if (dates.some(value => !Number.isFinite(value)) || dates[1] <= dates[0] || dates[1] - dates[0] > 86400000) throw fail(400, 'Enter shift times with an end after the start, up to 24 hours.');
      const staff = await people(user), person = staff.employees.find(employee => employee.id === String(p.employeeId) && employee.productionGroup.id === target.groupId);
      if (!person) throw fail(400, 'Choose an active Attendance employee in this production group.');
      if (!scope(user).some(item => item.line === p.line && item.groupId === target.groupId)) throw fail(409, 'Production groups changed. Refresh before assigning a shift.');
      if (old && db.prepare('SELECT updated_at FROM shift_assignments WHERE id=?').get(old.id)?.updated_at !== p.updatedAt) throw fail(409, 'This assignment changed. Refresh before editing.');
      const startAt = new Date(dates[0]).toISOString(), endAt = new Date(dates[1]).toISOString(), id = old?.id || randomUUID();
      const conflict = db.prepare('SELECT id FROM shift_assignments WHERE employee_id=? AND id<>? AND start_at < ? AND end_at > ?').get(person.id, id, endAt, startAt);
      if (conflict) throw fail(409, 'This employee already has an overlapping shift assignment.');
      const updatedAt = new Date(Math.max(Date.now(), old ? Date.parse(old.updated_at) + 1 : 0)).toISOString();
      db.prepare(`INSERT INTO shift_assignments VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET employee_id=excluded.employee_id,employee_name=excluded.employee_name,group_id=excluded.group_id,line=excluded.line,shift_name=excluded.shift_name,start_at=excluded.start_at,end_at=excluded.end_at,updated_by=excluded.updated_by,updated_at=excluded.updated_at`).run(id, person.id, person.name, target.groupId, p.line, shiftName, startAt, endAt, user.name, updatedAt);
      res.json({ ok: true, id });
    }),
    remove: handler(async (req, res, user) => {
      const row = db.prepare('SELECT * FROM shift_assignments WHERE id=?').get(req.params.id);
      if (!row || !scope(user).some(item => item.line === row.line && item.groupId === row.group_id)) throw fail(403, 'Assignment is outside your access.');
      if (row.updated_at !== req.body.updatedAt) throw fail(409, 'This assignment changed. Refresh before removing.');
      db.prepare('DELETE FROM shift_assignments WHERE id=?').run(row.id); res.json({ ok: true });
    })
  };
}
