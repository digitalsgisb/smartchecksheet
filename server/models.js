import { canManage } from './domain.js';
import { validateManpowerUrl } from './manpower.js';

export function mapModels(data, warnings = []) {
  const rows = Array.isArray(data) ? data : data?.models;
  if (!Array.isArray(rows) || !rows.length || rows.length > 10000) throw new Error('No model rows.');
  const names = new Map();
  const models = [];
  for (const row of rows) {
    const name = typeof row?.name === 'string' ? row.name.trim() : '';
    const legacy = row && !Object.hasOwn(row, 'cycle') && Object.hasOwn(row, 'stdCycle');
    // pcsHr is only a suggested target: 0 or blank means the supervisor types the shift's target/hour.
    const cycle = Number(legacy ? row.stdCycle : row?.cycle), pcsHr = Number(row?.pcsHr ?? 0) || 0;
    if (legacy && ['NO PROD', 'TRIAL'].includes(name.toUpperCase()) && cycle === 0 && pcsHr === 0) continue;
    // A row whose standard cycle is blank or 0 cannot be run; leave it out with a warning instead of losing the whole list.
    if (name && (Number.isNaN(cycle) || cycle === 0)) { warnings.push(`${name}: no standard cycle in the model sheet; left out.`); continue; }
    if (!name || name.length > 120 || !Number.isFinite(pcsHr) || pcsHr < 0 || pcsHr > 10000 || !Number.isFinite(cycle) || cycle < .001 || cycle > 10000) throw new Error('Invalid model row.');
    if (names.has(name)) {
      const first = names.get(name);
      if (first.cycle !== cycle || first.pcsHr !== pcsHr) throw new Error('Duplicate model with different standards.');
      warnings.push(`${name}: listed twice in the model source; the copy was ignored.`); continue;
    }
    // Slab size is optional (Names & models editor); it is only sent to the Pi when known.
    const slabWidth = Number(row?.slabWidth || 0), slabLength = Number(row?.slabLength || 0);
    if (![slabWidth, slabLength].every(v => Number.isFinite(v) && v >= 0 && v <= 100000)) throw new Error('Invalid model row.');
    const model = { name, pcsHr, cycle, ...(slabWidth ? { slabWidth } : {}), ...(slabLength ? { slabLength } : {}) }; names.set(name, model); models.push(model);
  }
  if (!models.length) throw new Error('No models with a standard cycle.');
  return models;
}

// stored(line): the list saved in Names & models; when present it replaces the Models Apps Script link for that line.
export function createModelSettings({ db, lines, env = process.env, fetchImpl = fetch, stored = () => null }) {
  db.exec('CREATE TABLE IF NOT EXISTS model_script_settings (line TEXT PRIMARY KEY,url TEXT NOT NULL,updated_at TEXT NOT NULL,updated_by TEXT NOT NULL)');
  const cache = new Map(), pending = new Map();
  const saved = line => db.prepare('SELECT url,updated_at AS updatedAt,updated_by AS updatedBy FROM model_script_settings WHERE line=?').get(line);
  const urlFor = line => saved(line)?.url || env[`${line}_MODELS_URL`] || env.MODELS_URL || '';
  async function fetchModels(url, line) {
    const target = new URL(validateManpowerUrl(url)); target.searchParams.set('line', line);
    const response = await fetchImpl(target.href, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('Model script unavailable.');
    const text = await response.text();
    if (text.length > 4000000) throw new Error('Model response too large.');
    const warnings = [];
    const models = mapModels(JSON.parse(text.replace(/^\uFEFF/, '')), warnings);
    return { models, warnings };
  }
  const hasSource = line => !!stored(line) || !!urlFor(line);
  async function linked(line) {
    const url = urlFor(line);
    if (!url) throw new Error('This line has no Models Apps Script link to import from.');
    return fetchModels(url, line);
  }
  async function catalog(line) {
    const own = stored(line);
    if (own) return { models: own.data, warnings: [], updatedAt: own.updatedAt, source: 'checksheet' };
    const url = urlFor(line);
    if (!url) throw new Error('Add this line’s models in Administration → Names & models.');
    const key = JSON.stringify([url, line]), entry = cache.get(key);
    if (entry && Date.now() - entry.time < 60000) return entry;
    if (!pending.has(key)) pending.set(key, fetchModels(url, line).then(data => {
      const value = { ...data, updatedAt: new Date().toISOString(), time: Date.now() }; cache.set(key, value); return value;
    }).finally(() => pending.delete(key)));
    return pending.get(key);
  }
  function allowed(req, res, target = false) {
    if (!req.user) { res.status(401).json({ error: 'Please sign in.' }); return false; }
    if (!canManage(req.user)) { res.status(403).json({ error: 'Administrator access required.' }); return false; }
    if (target && (!lines().includes(req.params.line) || !req.user.lines.includes(req.params.line))) { res.status(403).json({ error: 'No access to this line.' }); return false; }
    return true;
  }
  return {
    urlFor, catalog, hasSource, linked,
    list(req, res) {
      if (!allowed(req, res)) return;
      res.json({ lines: lines().filter(line => req.user.lines.includes(line)).map(line => ({ line, url: urlFor(line), source: saved(line) ? 'saved' : 'default', ...saved(line) })) });
    },
    save(req, res) {
      if (!allowed(req, res, true)) return;
      let url;
      try { url = validateManpowerUrl(req.body?.url?.trim()); } catch { return res.status(400).json({ error: 'Use an HTTPS Apps Script deployment link ending in /exec.' }); }
      const updatedAt = new Date().toISOString();
      db.prepare('INSERT INTO model_script_settings VALUES(?,?,?,?) ON CONFLICT(line) DO UPDATE SET url=excluded.url,updated_at=excluded.updated_at,updated_by=excluded.updated_by').run(req.params.line, url, updatedAt, req.user.name);
      cache.clear(); res.json({ line: req.params.line, url, source: 'saved', updatedAt, updatedBy: req.user.name });
    },
    async test(req, res) {
      if (!allowed(req, res, true)) return;
      let url;
      try { url = validateManpowerUrl(req.body?.url?.trim()); } catch { return res.status(400).json({ error: 'Use an HTTPS Apps Script deployment link ending in /exec.' }); }
      try { const data = await fetchModels(url, req.params.line); res.json({ ok: true, counts: { models: data.models.length }, warnings: data.warnings, testedAt: new Date().toISOString() }); }
      catch { res.status(502).json({ error: 'Test failed. Check deployment access and the Models sheet columns for this line.' }); }
    },
    async read(req, res) {
      try { const data = await catalog(req.line); res.json({ models: data.models, warnings: data.warnings, updatedAt: data.updatedAt }); }
      catch { res.status(urlFor(req.line) ? 502 : 503).json({ error: urlFor(req.line) ? 'Models unavailable. Check the Models Apps Script link and sheet data.' : 'Add this line’s models in Administration → Names & models.' }); }
    }
  };
}
