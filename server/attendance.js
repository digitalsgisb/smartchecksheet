const clean = value => String(value || '').trim().toUpperCase();

export function attendanceConfig(env = process.env) {
  const groups = JSON.parse(env.ATTENDANCE_GROUPS || '[]');
  if (!Array.isArray(groups) || groups.some(g => !g.id || !g.label || (g.section ? g.section !== 'ROLL MAKING' || g.lines !== undefined : !Array.isArray(g.lines) || !g.lines.length || g.lines.some(l => typeof l !== 'string' || !l.trim())) || (g.assignment && !['fc1','fc2','fc3'].includes(g.assignment))) || new Set(groups.map(g => g.id)).size !== groups.length) {
    throw new Error('ATTENDANCE_GROUPS must contain unique id, label and either non-empty lines or section ROLL MAKING.');
  }
  const base = env.ATTENDANCE_API_URL?.trim();
  let url;
  if (base) {
    url = new URL(base);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('ATTENDANCE_API_URL must be a server origin, for example http://127.0.0.1:8765.');
  }
  return { url: url?.origin, token: env.ATTENDANCE_TOKEN?.trim(), groups };
}

export function summarizeAttendance(employees, group, updatedAt) {
  if (!Array.isArray(employees)) throw new Error('Invalid employee response');
  const lines = new Set((group.lines || []).map(clean));
  const section = e => clean(e.production_section) || (clean(e.line) === 'ROLL MAKING' ? 'ROLL MAKING' : 'CONVERSION');
  const selected = employees.filter(e => e.active && clean(e.department) === 'PRODUCTION' && (group.section ? section(e) === group.section : lines.has(clean(e.line))) && (!group.assignment || e.checksheet_group === group.assignment));
  if (selected.some(e => !['IN', 'OUT'].includes(e.status))) throw new Error('Invalid employee status');
  const people = selected.map(e => ({ id: e.id, name: e.nickname || e.name, team: e.team || '', line: e.line,
    status: e.stale_session ? 'REVIEW' : e.status, clockedInAt: e.session?.time_in || null }));
  people.sort((a, b) => a.team.localeCompare(b.team) || a.name.localeCompare(b.name));
  return { group: { id: group.id, label: group.label }, updatedAt, total: people.length,
    in: people.filter(e => e.status === 'IN').length, out: people.filter(e => e.status === 'OUT').length,
    review: people.filter(e => e.status === 'REVIEW').length, employees: people };
}

export function createAttendanceBridge(config, fetcher = fetch) {
  let cached = null, pending = null;
  async function employees() {
    if (cached && Date.now() - cached.time < 5000) return cached;
    if (!pending) pending = (async () => {
      const response = await fetcher(`${config.url}/api/employees`, { headers: { Authorization: `Bearer ${config.token}` }, signal: AbortSignal.timeout(5000), redirect: 'error', cache: 'no-store' });
      if (!response.ok) throw new Error('Attendance request failed');
      const data = await response.json();
      // Refuse an administrator or kiosk credential: this connection must be read-only.
      if (data.connection_scope !== 'integration' || !Array.isArray(data.employees)) throw new Error('A read-only integration token is required');
      cached = { time: Date.now(), updatedAt: new Date().toISOString(), employees: data.employees };
      return cached;
    })().finally(() => { pending = null; });
    return pending;
  }
  return async (req, res) => {
    const groups = config.groups.map(({ id, label }) => ({ id, label }));
    if (!config.url || !config.token || !groups.length) return res.status(503).json({ error: 'Attendance is not connected yet. Ask your administrator to configure the connection and employee groups.', configured: false, groups: [] });
    const group = config.groups.find(g => g.id === (req.query.group || groups[0].id));
    if (!group) return res.status(403).json({ error: 'This attendance group is not available on this installation.' });
    try {
      const data = await employees();
      return res.json({ configured: true, groups, ...summarizeAttendance(data.employees, group, data.updatedAt) });
    } catch {
      // Never pass upstream response bodies, URLs or tokens to a tablet.
      return res.status(502).json({ error: 'Attendance is unavailable. Check the server connection and read-only integration token.', configured: true, groups });
    }
  };
}
