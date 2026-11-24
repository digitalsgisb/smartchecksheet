import { productionGroup } from '../shared/productionGroups.js';
import { staffRole } from './staffDirectory.js';

// Start-shift name lists built from the Employees master (Smart Attendance), line by line.
// A line switches over only after an executive or manager confirms its matching preview; until then it keeps its saved
// list (or Google link). The last good copy of the staff list is kept in SQLite, so tablets keep their names when
// Attendance is offline or the server restarts.
// Operators fill all three operator lists; the tablet still asks forming, waterjet and assembly separately.
const listOf = { supervisors: 'SUPERVISOR', leaders: 'LEADER', forming: 'OPERATOR', waterjet: 'OPERATOR', assembly: 'OPERATOR', quality: 'QUALITY' };
// Supervisors cover every line in their own division and site (Conversion · Port Klang, Roll Making · Port Klang, …); leaders cover their home line plus the lines ticked for them.
const covering = ['LEADER'];
const display = p => p.nickname || p.name;
const current = p => ({ ...p, role: staffRole(p.role) });
const norm = text => String(text || '').trim().toLowerCase().replace(/\s+/g, ' ');
// A person's Checksheet lines: homeLines is their Attendance line translated (FC + FC Line 1 → ABB2); older cached copies fall back to the raw line.
const home = p => p.homeLines || [p.line];
const onLine = (p, line, groupId) => p.role === 'SUPERVISOR' ? !!groupId && p.groupId === groupId : home(p).includes(line) || (covering.includes(p.role) && p.coversLines.includes(line));
// What to save in Attendance to put an operator on a Checksheet line: FC + FC Line 1 for ABB2, MF for ABB7, or the line itself.
const placeOn = (line, map = []) => { const item = map.find(entry => entry.line === line); return item ? { line: item.attendanceLine, ...(item.fcGroup ? { fcGroup: item.fcGroup } : {}) } : { line }; };

// The six Start-shift lists for one line, from active people with a role on (or covering) that line.
export function linePeople(people, line, groupId) {
  people = people.map(current);
  return Object.fromEntries(Object.entries(listOf).map(([list, role]) => [list, [...new Set(people.filter(p => p.active && p.role === role && onLine(p, line, groupId)).map(display))].sort((a, b) => a.localeCompare(b))]));
}

// Compares a line's current names with the master. Every name gets a status:
// ok (already right), change (found; role or line to set, `apply` suggests whether to tick it), missing (no one by that name),
// ambiguous (several people share it), inactive (found but deactivated) or conflict (same person already listed under another role).
export function matchLine(oldPeople, people, line, site, map = [], groupId = '') {
  people = people.map(current);
  const plant = people.filter(p => productionGroup(p.groupId)?.site === site), used = new Map(), seen = new Set(), rows = [];
  for (const [list, role] of Object.entries(listOf)) for (const name of oldPeople?.[list] || []) {
    if (seen.has(role + ':' + norm(name))) continue; // one row per name and role
    seen.add(role + ':' + norm(name));
    const found = plant.filter(p => [p.nickname, p.name].some(value => value && norm(value) === norm(name)));
    const row = { list, name, role };
    if (!found.length) rows.push({ ...row, status: 'missing' });
    else if (found.length > 1) rows.push({ ...row, status: 'ambiguous', ids: found.map(p => p.id) });
    else {
      const p = found[0], who = { id: p.id, fullName: p.name, line: p.line, homeLines: home(p), currentRole: p.role, updatedAt: p.updatedAt };
      if (used.get(p.id) === role) continue; // the same operator in forming and waterjet is one person
      if (used.has(p.id)) rows.push({ ...row, ...who, status: 'conflict', otherRole: used.get(p.id) });
      else if (!p.active) rows.push({ ...row, ...who, status: 'inactive' });
      else if (p.role === role && onLine(p, line, groupId)) rows.push({ ...row, ...who, status: 'ok' });
      else {
        // Operators move their home line only when the exec ticks it; supervisors and leaders just gain this line.
        const covers = covering.includes(role), patch = { role, ...(role === 'SUPERVISOR' ? {} : covers ? { coversLines: [...new Set([...p.coversLines, line])] } : placeOn(line, map)) };
        rows.push({ ...row, ...who, status: 'change', patch, apply: (!p.role || p.role === role) && (role === 'SUPERVISOR' || covers || home(p).includes(line)) });
      }
      used.set(p.id, role);
    }
  }
  // Active people already on this line who were not in the old list: shown so nobody is forgotten.
  const listed = new Set(rows.map(row => row.id).filter(Boolean));
  const unlisted = plant.filter(p => p.active && home(p).includes(line) && !listed.has(p.id)).map(p => ({ id: p.id, name: display(p), fullName: p.name, role: p.role }));
  return { rows, unlisted };
}

export function createStaffLists({ db, directory, lines, lineGroups, oldPeople = async () => null, onChange = () => {} }) {
  db.exec(`CREATE TABLE IF NOT EXISTS staff_cache (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS line_staff_source (line TEXT PRIMARY KEY, switched_at TEXT NOT NULL, switched_by TEXT NOT NULL);`);
  const row = db.prepare('SELECT data, updated_at FROM staff_cache WHERE id=1').get();
  let cache = row ? { people: JSON.parse(row.data), updatedAt: row.updated_at } : null, timer = null;
  async function refresh() {
    try {
      const people = await directory.everyone(), updatedAt = new Date().toISOString();
      db.prepare('INSERT INTO staff_cache VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at').run(JSON.stringify(people), updatedAt);
      const changed = JSON.stringify(people) !== JSON.stringify(cache?.people);
      cache = { people, updatedAt };
      if (changed) onChange();
      return true;
    } catch { return false; } // Keep the last good copy.
  }
  const switched = line => db.prepare('SELECT switched_at AS switchedAt, switched_by AS switchedBy FROM line_staff_source WHERE line=?').get(line) || null;
  const fail = directory.fail;
  function lineAccess(req, groups) {
    const line = req.params.line, group = productionGroup(lineGroups()[line]);
    if (!lines().includes(line) || !req.user.lines.includes(line)) throw fail(403, 'No access to this line.');
    if (!group || !groups.some(item => item.id === group.id)) throw fail(403, 'Set this line\'s plant first (Executive workspace → Production group setup).');
    return { line, group };
  }
  const handler = fn => async (req, res) => {
    try { await fn(req, res, directory.groupsFor(req.user)); }
    catch (error) { res.status(error.status || 502).json({ error: error.status ? error.message : 'Smart Attendance is unavailable. Try again.' }); }
  };
  return {
    refresh, switched,
    start(every = 60000) { refresh(); timer = setInterval(refresh, every); timer.unref?.(); },
    stop() { clearInterval(timer); },
    // For tablets and live lines: the master lists for a switched line, otherwise null (the old list stays in use).
    people(line) { return switched(line) ? { data: linePeople(cache?.people || [], line, lineGroups()[line] || ''), updatedAt: cache?.updatedAt || null, source: 'employees' } : null; },
    status: handler(async (req, res, groups) => {
      const { line, group } = lineAccess(req, groups), people = await directory.everyone(), state = switched(line);
      if (state) return res.json({ line, switched: state, lists: linePeople(people, line, group.id) });
      const old = await oldPeople(line);
      res.json({ line, switched: null, oldSource: old?.source || 'none', lists: linePeople(people, line, group.id), ...matchLine(old?.data, people, line, group.site, directory.lineMap, group.id) });
    }),
    // Saves the ticked role/line changes, then switches the line to the master. Stops at the first refused change.
    switchOver: handler(async (req, res, groups) => {
      const { line } = lineAccess(req, groups), changes = req.body?.changes ?? [];
      if (!Array.isArray(changes) || changes.length > 300 || changes.some(c => typeof c?.id !== 'string') || new Set(changes.map(c => c.id)).size !== changes.length) throw fail(400, 'Send the changes to apply, one per person.');
      let people = await directory.everyone(), saved = 0;
      for (const change of changes) {
        const p = people.find(item => item.id === change.id);
        if (!p) throw fail(404, `${saved} saved. Someone in the list was not found; reload and try again. The line was not switched.`);
        const patch = { role: change.role, ...(change.line !== undefined ? { line: change.line } : {}), ...(change.fcGroup !== undefined ? { fcGroup: change.fcGroup } : {}), ...(change.coversLines !== undefined ? { coversLines: change.coversLines } : {}) };
        try { await directory.edit(req.user, groups, p.id, patch, p.updatedAt, people); saved++; }
        catch (error) { throw fail(error.status || 502, `${saved} saved, then ${p.nickname || p.name}: ${error.message} The line was not switched.`); }
      }
      if (saved) people = await directory.everyone();
      db.prepare('INSERT INTO line_staff_source VALUES(?,?,?) ON CONFLICT(line) DO UPDATE SET switched_at=excluded.switched_at, switched_by=excluded.switched_by').run(line, new Date().toISOString(), req.user.name);
      await refresh(); onChange();
      res.json({ line, saved, switched: switched(line), lists: linePeople(people, line, lineGroups()[line] || '') });
    }),
    // Back to the line's old list, for the pilot period.
    switchBack: handler(async (req, res, groups) => {
      const { line } = lineAccess(req, groups);
      db.prepare('DELETE FROM line_staff_source WHERE line=?').run(line);
      onChange(); res.json({ line, switched: null });
    })
  };
}
