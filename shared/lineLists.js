// Names and model lists pasted from a Google Sheet (tab-separated, header row first) into Administration → Names & models.
// Shared by the editor (preview) and the server (validation) so both read a paste the same way.
export const peopleRoles = { supervisors: 'Supervisors', leaders: 'Leaders', forming: 'Forming', waterjet: 'Waterjet', assembly: 'Assembly', quality: 'Quality' };
const key = text => String(text ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const peopleHeaders = { supervisors: 'supervisors', supervisor: 'supervisors', spv: 'supervisors', lineleaders: 'leaders', lineleader: 'leaders', leaders: 'leaders', leader: 'leaders', formingoperators: 'forming', forming: 'forming', waterjetoperators: 'waterjet', waterjet: 'waterjet', assemblyoperators: 'assembly', assembly: 'assembly', qualityoperators: 'quality', quality: 'quality', qualityinspectors: 'quality', inspector: 'quality' };
const modelHeaders = { model: 'name', name: 'name', modelname: 'name', cycle: 'cycle', cycleminutes: 'cycle', cycletime: 'cycle', stdcycle: 'cycle', standardcycle: 'cycle', cycletimemin: 'cycle', cyclemin: 'cycle', cycleminpc: 'cycle', pcshr: 'pcsHr', pcsperhour: 'pcsHr', targetperhour: 'pcsHr', target: 'pcsHr', slabwidth: 'slabWidth', stdslabwidth: 'slabWidth', slabw: 'slabWidth', slablength: 'slabLength', stdslablength: 'slabLength', slabl: 'slabLength', line: 'line', active: 'active' };
const cell = value => String(value ?? '').trim().replace(/^"(.*)"$/s, '$1').trim();
export const tableRows = text => String(text ?? '').replace(/\r\n?/g, '\n').split('\n').filter(row => row.trim()).map(row => row.split('\t').map(cell));
function headed(text, headers, required, prefix = false) {
  const [head = [], ...rows] = tableRows(text);
  const columns = head.map(name => headers[key(name)] || (prefix && headers[Object.keys(headers).find(h => h.length > 4 && key(name).startsWith(h))]) || null), ignored = head.filter((name, i) => name && !columns[i]);
  if (!columns.some(Boolean)) throw new Error(`Copy the header row too (${required}).`);
  return { columns, rows, ignored };
}
export function parsePeopleTable(text) {
  const { columns, rows, ignored } = headed(text, peopleHeaders, 'supervisors, lineLeaders, formingOperators…');
  const people = Object.fromEntries(Object.keys(peopleRoles).map(role => [role, []]));
  for (const row of rows) columns.forEach((role, i) => { if (role && row[i] && !people[role].includes(row[i])) people[role].push(row[i]); });
  return { people, ignored };
}
export function parseModelsTable(text, line) {
  const { columns, rows, ignored } = headed(text, modelHeaders, 'Model, Cycle time, Pcs/hr…', true);
  if (!columns.includes('name') || !columns.includes('cycle')) throw new Error('The header row needs a Model column and a Cycle time column.');
  const models = [], warnings = [];
  for (const row of rows) {
    const item = Object.fromEntries(columns.map((field, i) => [field, row[i]]).filter(([field]) => field));
    if (!item.name) continue;
    if (item.line && line && item.line.toUpperCase() !== line) continue;
    if (item.active && ['false', 'no', '0', 'n'].includes(item.active.toLowerCase())) continue;
    models.push({ name: item.name, cycle: item.cycle ?? '', pcsHr: item.pcsHr ?? '', slabWidth: item.slabWidth ?? '', slabLength: item.slabLength ?? '' });
  }
  return { models, warnings, ignored };
}
export function cleanPeople(input) {
  if (!input || typeof input !== 'object') throw new Error('Send the names list.');
  const people = {};
  for (const role of Object.keys(peopleRoles)) {
    const list = input[role];
    if (!Array.isArray(list) || list.length > 1000) throw new Error(`${peopleRoles[role]}: send a list of names.`);
    people[role] = [...new Set(list.map(name => typeof name === 'string' ? name.trim() : ''))].filter(Boolean);
    if (people[role].some(name => name.length > 120)) throw new Error(`${peopleRoles[role]}: a name is too long.`);
  }
  const empty = Object.keys(peopleRoles).filter(role => !people[role].length).map(role => peopleRoles[role]);
  if (empty.length) throw new Error(`Add at least one name for: ${empty.join(', ')}.`);
  return people;
}
// What a save would change, per role (names) or per model; "missing" stays unless the admin ticks it for removal.
export function diffPeople(current, next) {
  return Object.fromEntries(Object.keys(peopleRoles).map(role => { const was = current?.[role] || [], now = next?.[role] || []; return [role, { added: now.filter(n => !was.includes(n)), missing: was.filter(n => !now.includes(n)) }]; }));
}
const same = (a, b) => ['cycle', 'pcsHr', 'slabWidth', 'slabLength'].every(f => Number(a[f] || 0) === Number(b[f] || 0));
export function diffModels(current, next) {
  const was = new Map((current || []).map(m => [m.name, m])), names = new Set((next || []).map(m => m.name));
  return { added: (next || []).filter(m => !was.has(m.name)), changed: (next || []).filter(m => was.has(m.name) && !same(was.get(m.name), m)).map(m => ({ before: was.get(m.name), after: m })), missing: (current || []).filter(m => !names.has(m.name)) };
}
export function mergePeople(current, next, remove = []) {
  return Object.fromEntries(Object.keys(peopleRoles).map(role => [role, [...(next?.[role] || []), ...(current?.[role] || []).filter(n => !(next?.[role] || []).includes(n) && !remove.includes(`${role}:${n}`))]]));
}
export function mergeModels(current, next, remove = []) {
  const names = new Set((next || []).map(m => m.name));
  return [...(next || []), ...(current || []).filter(m => !names.has(m.name) && !remove.includes(m.name))];
}
