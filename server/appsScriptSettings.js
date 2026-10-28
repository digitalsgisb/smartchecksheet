import { canManage } from './domain.js';
import { namesUrl, validateManpowerUrl, fetchManpower } from './manpower.js';

export function createAppsScriptSettings({ db, lines, env = process.env, fetchImpl = fetch }) {
  db.exec('CREATE TABLE IF NOT EXISTS apps_script_settings (line TEXT PRIMARY KEY, url TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT NOT NULL)');
  const get = line => db.prepare('SELECT url, updated_at AS updatedAt, updated_by AS updatedBy FROM apps_script_settings WHERE line=?').get(line);
  const fallback = line => env[`${line}_MANPOWER_URL`] || env.MANPOWER_URL || namesUrl;
  const urlFor = line => get(line)?.url || fallback(line);
  const allowed = req => lines().filter(line => req.user.lines.includes(line));
  function authorize(req, res, target = false) {
    if (!req.user) { res.status(401).json({ error: 'Please sign in.' }); return false; }
    if (!canManage(req.user)) { res.status(403).json({ error: 'Administrator access required.' }); return false; }
    if (target && !allowed(req).includes(req.params.line)) { res.status(403).json({ error: 'No access to this line.' }); return false; }
    return true;
  }
  return {
    urlFor,
    list(req, res) {
      if (!authorize(req, res)) return;
      return res.json({ lines: allowed(req).map(line => { const saved = get(line); return { line, url: urlFor(line), source: saved ? 'saved' : 'default', updatedAt: saved?.updatedAt || null, updatedBy: saved?.updatedBy || null }; }) });
    },
    save(req, res) {
      if (!authorize(req, res, true)) return;
      let url;
      try { url = validateManpowerUrl(req.body?.url?.trim()); }
      catch { return res.status(400).json({ error: 'Use an HTTPS Apps Script deployment link ending in /exec.' }); }
      const updatedAt = new Date().toISOString();
      db.prepare('INSERT INTO apps_script_settings(line,url,updated_at,updated_by) VALUES(?,?,?,?) ON CONFLICT(line) DO UPDATE SET url=excluded.url,updated_at=excluded.updated_at,updated_by=excluded.updated_by').run(req.params.line, url, updatedAt, req.user.name);
      return res.json({ line: req.params.line, url, source: 'saved', updatedAt, updatedBy: req.user.name });
    },
    async test(req, res) {
      if (!authorize(req, res, true)) return;
      let url;
      try { url = validateManpowerUrl(req.body?.url?.trim()); }
      catch { return res.status(400).json({ error: 'Use an HTTPS Apps Script deployment link ending in /exec.' }); }
      try {
        const people = await fetchManpower(url, fetchImpl);
        return res.json({ ok: true, counts: Object.fromEntries(Object.entries(people).map(([role, names]) => [role, names.length])), testedAt: new Date().toISOString() });
      } catch { return res.status(502).json({ error: 'Test failed. Check deployment access and the six manpower columns.' }); }
    }
  };
}
