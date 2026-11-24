import { productionGroups, productionGroup } from '../shared/productionGroups.js';
import { attendanceSection } from './attendance.js';

// Production staff list. Smart Attendance stores the records (face scans are tied to its IDs); this is the only place they are edited.
// Executives manage their own division and site; management and developers manage every Production group.
export const staffRoles = ['SUPERVISOR', 'LEADER', 'FORMING', 'WATERJET', 'ASSEMBLY', 'QUALITY'];
export const plantTeams = site => site === 'Sendayan' ? ['C', 'D', 'N'] : ['A', 'B', 'N'];
const covering = ['SUPERVISOR', 'LEADER'];
const clean = value => String(value || '').trim().toUpperCase();
const fail = (status, message) => Object.assign(new Error(message), { status });
const linePattern = /^[A-Z0-9][A-Z0-9 &/.-]{0,39}$/;
const parseLines = value => { try { const list = typeof value === 'string' ? JSON.parse(value || '[]') : value; return Array.isArray(list) ? list.filter(item => typeof item === 'string') : []; } catch { return []; } };
const groupOf = e => productionGroups.find(group => clean(e.base) === clean(group.site) && attendanceSection(e) === clean(group.division)) || null;
const person = e => ({ id: String(e.id), name: e.name || '', nickname: e.nickname || '', position: e.position || '', groupId: groupOf(e)?.id || '', plant: e.base || '', line: e.line || '', team: e.team || '', fcGroup: e.checksheet_group || '', active: !!e.active,
  role: e.checksheet_role || '', coversLines: parseLines(e.covers_lines), status: e.status === 'IN' ? 'IN' : 'OUT', updatedAt: e.updated_at || '' });

// onSaved() runs after a change reaches Attendance (the line lists refresh from it).
export function createStaffDirectory({ attendance, lines = () => [], lineGroups = () => ({}), fetcher = fetch, onSaved = () => {} }) {
  function groupsFor(user) {
    if (['management', 'developer'].includes(user?.role)) return productionGroups;
    if (user?.role === 'executive' && productionGroup(user.executiveGroup)) return [productionGroup(user.executiveGroup)];
    throw fail(403, 'Executive, management or developer access required.');
  }
  async function call(path, options = {}) {
    if (!attendance.url || !attendance.token) throw fail(503, 'Smart Attendance is not connected. Ask the administrator to set up the employee connection.');
    let response;
    try { response = await fetcher(`${attendance.url}${path}`, { ...options, headers: { Authorization: `Bearer ${attendance.token}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}) }, signal: AbortSignal.timeout(8000), redirect: 'error', cache: 'no-store' }); }
    catch { throw fail(503, 'Smart Attendance is offline. Nothing was changed. Try again.'); }
    return response;
  }
  async function everyone() {
    const response = await call('/api/employees');
    if (!response.ok) throw fail(502, 'Smart Attendance refused the connection. Ask the administrator to check the employee connection.');
    const data = await response.json().catch(() => null);
    if (data?.connection_scope !== 'integration' || !Array.isArray(data.employees)) throw fail(502, 'Smart Attendance sent an unexpected answer.');
    return data.employees.filter(e => clean(e.department) === 'PRODUCTION').map(person);
  }
  // Checksheet lines per Production group, for the line pickers. Attendance-only lines (such as FC) come from the staff themselves.
  function lineOptions(groups, people) {
    const mapping = lineGroups();
    return Object.fromEntries(groups.map(group => [group.id, [...new Set([...lines().filter(line => mapping[line] === group.id), ...people.filter(p => p.groupId === group.id).map(p => clean(p.line))].filter(Boolean))].sort()]));
  }
  // Lines a supervisor or leader may cover: Checksheet lines anywhere in the same plant.
  const plantLines = group => { const mapping = lineGroups(); return lines().filter(line => productionGroup(mapping[line])?.site === group.site); };
  function details(p, group, existing) {
    const e = p || {};
    const name = String(e.name ?? existing?.name ?? '').trim(), line = clean(e.line ?? existing?.line), role = e.role ?? existing?.role ?? '', team = e.team ?? existing?.team ?? '';
    if (!name || name.length > 80) throw fail(400, 'Enter the full name.');
    for (const key of ['nickname', 'position']) if (e[key] !== undefined && (typeof e[key] !== 'string' || e[key].trim().length > 80)) throw fail(400, `Check the ${key}.`);
    if (!linePattern.test(line)) throw fail(400, 'Choose a line.');
    if (role && !staffRoles.includes(role)) throw fail(400, 'Choose a role.');
    if (team && !plantTeams(group.site).includes(team)) throw fail(400, `Choose team ${plantTeams(group.site).join(', ')} or leave it empty.`);
    // Lines saved earlier that have since left the plant are dropped quietly; new picks must be in the same plant.
    const allowed = new Set([...plantLines(group), line]), picked = e.coversLines !== undefined ? parseLines(e.coversLines) : parseLines(existing?.coversLines).filter(item => allowed.has(item));
    if (picked.some(item => !allowed.has(item))) throw fail(400, `A supervisor or leader can only cover lines in ${group.site}.`);
    const covers = covering.includes(role) ? [...new Set([...picked, line])] : [];
    const fcGroup = line === 'FC' ? e.fcGroup ?? existing?.fcGroup ?? '' : '';
    if (!['', 'fc1', 'fc2', 'fc3'].includes(fcGroup)) throw fail(400, 'Choose FC Line 1, 2 or 3.');
    return { name, nickname: String(e.nickname ?? existing?.nickname ?? '').trim(), position: String(e.position ?? existing?.position ?? '').trim(), base: group.site.toUpperCase(), production_section: group.division.toUpperCase(),
      line, team, checksheet_group: fcGroup, checksheet_role: role, covers_lines: covers, ...(e.active !== undefined ? { active: !!e.active } : {}) };
  }
  async function send(path, method, body, user, creating) {
    const response = await call(path, { method, body: JSON.stringify({ ...body, changed_by: user.name || user.username || 'Checksheet' }) });
    // Attendance answers are mapped to plain messages; its bodies never reach the browser.
    if (!response.ok) throw fail(response.status === 409 ? 409 : response.status === 404 ? 404 : 502, {
      400: 'Smart Attendance refused these details. Check them and try again.',
      403: 'Smart Attendance refused this change. Ask the administrator to update Smart Attendance so the Checksheet can manage staff.',
      404: 'This person was not found in Smart Attendance. Reload the list.',
      409: creating ? 'That staff ID is already used.' : 'Someone else changed this person. Reload and try again.'
    }[response.status] || 'Smart Attendance could not save this. Nothing was changed. Try again.');
    onSaved();
    return (await response.json().catch(() => ({}))).employee;
  }
  // One person's change. `people` is a fresh read of Attendance, so the person's group is checked against current data.
  async function edit(user, groups, id, p, updatedAt, people) {
    const existing = people.find(item => item.id === id);
    if (!existing || !groups.some(group => group.id === existing.groupId)) throw fail(404, 'This person is not in your production group.');
    const group = groups.find(item => item.id === (p.groupId || existing.groupId));
    if (!group) throw fail(403, 'Choose your own division and site.');
    if (p.active === false && existing.active && existing.status === 'IN') throw fail(409, 'This person is still clocked in. Clock them out before deactivating.');
    const saved = await send(`/api/integrations/production-employees/${encodeURIComponent(id)}`, 'PUT', { employee: details(p, group, existing), updated_at: updatedAt }, user, false);
    return saved ? person({ ...saved, department: 'PRODUCTION' }) : null;
  }
  const handler = fn => async (req, res) => {
    try { await fn(req, res, groupsFor(req.user)); }
    catch (error) { res.status(error.status || 502).json({ error: error.status ? error.message : 'Smart Attendance is unavailable. Try again.' }); }
  };
  return {
    list: handler(async (req, res, groups) => {
      const people = (await everyone()).filter(p => groups.some(group => group.id === p.groupId));
      const options = lineOptions(groups, people);
      res.json({ employees: people, groups: groups.map(group => ({ ...group, teams: plantTeams(group.site), lines: options[group.id], coverLines: plantLines(group) })), roles: staffRoles });
    }),
    create: handler(async (req, res, groups) => {
      const p = req.body?.employee || {}, group = groups.find(item => item.id === p.groupId);
      if (!group) throw fail(403, 'Choose your own division and site.');
      const id = String(p.id || '').trim();
      if (!/^[A-Za-z0-9-]{1,40}$/.test(id)) throw fail(400, 'Enter the staff number: letters, numbers or hyphens.');
      const saved = await send('/api/integrations/production-employees', 'POST', { employee: { id, ...details(p, group), active: true } }, req.user, true);
      res.json({ employee: saved ? person({ ...saved, department: 'PRODUCTION' }) : null });
    }),
    update: handler(async (req, res, groups) => {
      res.json({ employee: await edit(req.user, groups, String(req.params.id || ''), req.body?.employee || {}, req.body?.updatedAt, await everyone()) });
    }),
    groupsFor, everyone, edit, fail
  };
}
