import { mapModels } from './models.js';
import { cleanPeople } from '../shared/lineLists.js';

// Names and models kept in the checksheet per line (Administration → Names & models). A saved list replaces that line's
// Google Apps Script link; lines without one keep reading the link until the Google Sheet is switched off.
// Management, executives and developers may edit the lists of lines on their account.
export const canEditLists = user => ['management', 'executive', 'developer'].includes(user?.role);
// importPeople/importModels(line) read the line's current Apps Script link once so the list can be brought over.
export function createLineLists({ db, lines, importPeople = async () => { throw new Error('No names link.'); }, importModels = async () => { throw new Error('No models link.'); } }) {
  db.exec("CREATE TABLE IF NOT EXISTS line_lists (line TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('people','models')), data TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT NOT NULL, PRIMARY KEY(line,kind))");
  const get = (line, kind) => { const row = db.prepare('SELECT data,updated_at AS updatedAt,updated_by AS updatedBy FROM line_lists WHERE line=? AND kind=?').get(line, kind); return row ? { data: JSON.parse(row.data), updatedAt: row.updatedAt, updatedBy: row.updatedBy } : null; };
  function allowed(req, res) {
    if (!req.user) { res.status(401).json({ error: 'Please sign in.' }); return false; }
    if (!canEditLists(req.user)) { res.status(403).json({ error: 'Administrator access required.' }); return false; }
    if (!lines().includes(req.params.line) || !req.user.lines.includes(req.params.line)) { res.status(403).json({ error: 'No access to this line.' }); return false; }
    if (req.params.kind && !['people', 'models'].includes(req.params.kind)) { res.status(404).json({ error: 'Unknown list.' }); return false; }
    return true;
  }
  const clean = (kind, body) => kind === 'people' ? cleanPeople(body?.people) : (() => { if (!Array.isArray(body?.models)) throw new Error('Send the model list.'); try { return mapModels(body.models); } catch (e) { throw new Error(e.message === 'Invalid model row.' ? 'Check the model rows: each needs a name, a cycle time above 0 and numbers only.' : e.message); } })();
  return {
    people: line => get(line, 'people'),
    models: line => get(line, 'models'),
    read(req, res) {
      if (!allowed(req, res)) return;
      res.json({ line: req.params.line, people: get(req.params.line, 'people'), models: get(req.params.line, 'models') });
    },
    save(req, res) {
      if (!allowed(req, res)) return;
      let data;
      try { data = clean(req.params.kind, req.body); } catch (e) { return res.status(400).json({ error: e.message }); }
      const updatedAt = new Date().toISOString();
      db.prepare('INSERT INTO line_lists VALUES(?,?,?,?,?) ON CONFLICT(line,kind) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at,updated_by=excluded.updated_by').run(req.params.line, req.params.kind, JSON.stringify(data), updatedAt, req.user.name);
      res.json({ data, updatedAt, updatedBy: req.user.name });
    },
    // Reads the Google link without saving: the editor shows it as a preview first.
    async import(req, res) {
      if (!allowed(req, res)) return;
      try { res.json(req.params.kind === 'people' ? { people: await importPeople(req.params.line) } : { models: (await importModels(req.params.line)).models }); }
      catch { res.status(502).json({ error: 'Could not read the Google link for this line. Paste the table instead.' }); }
    }
  };
}
