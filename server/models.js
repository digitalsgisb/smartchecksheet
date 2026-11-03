import { canManage } from './domain.js';
import { validateManpowerUrl } from './manpower.js';

export function mapModels(data, warnings = []) {
  const rows = Array.isArray(data) ? data : data?.models;
  if (!Array.isArray(rows) || !rows.length || rows.length > 10000) throw new Error('No model rows.');
  const names = new Set();
  const models = [];
  for (const row of rows) {
    const name = typeof row?.name === 'string' ? row.name.trim() : '';
    const legacy = row && !Object.hasOwn(row, 'cycle') && Object.hasOwn(row, 'stdCycle');
    const cycle = Number(legacy ? row.stdCycle : row?.cycle), pcsHr = Number(row?.pcsHr);
    if (legacy && ['NO PROD', 'TRIAL'].includes(name.toUpperCase()) && cycle === 0 && pcsHr === 0) continue;
    if (legacy && name && Number.isFinite(cycle) && cycle >= .001 && cycle <= 10000 && pcsHr === 0) {
      warnings.push(`${name}: target/hour is 0. Set a positive pcsHr in the model source to enable this model.`);
      continue;
    }
    if (!name || name.length > 120 || names.has(name) || !Number.isInteger(pcsHr) || pcsHr < 1 || pcsHr > 10000 || !Number.isFinite(cycle) || cycle < .001 || cycle > 10000) throw new Error('Invalid or duplicate model row.');
    names.add(name); models.push({ name, pcsHr, cycle });
  }
  if (!models.length) throw new Error('No models with a positive target/hour and standard cycle.');
  return models;
}

export function createModelSettings({ db, lines, env = process.env, fetchImpl = fetch }) {
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
  async function catalog(line) {
    const url = urlFor(line);
    if (!url) throw new Error('Configure the Models Apps Script link for this line in Administration → Apps Script links.');
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
    urlFor, catalog,
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
      catch { res.status(urlFor(req.line) ? 502 : 503).json({ error: urlFor(req.line) ? 'Models unavailable. Check the Models Apps Script link and sheet data.' : 'Configure this line’s Models Apps Script link in Administration → Apps Script links.' }); }
    }
  };
}
