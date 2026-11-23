import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { lineCodePattern } from './machineConfig.js';
import { sheetsUrlPattern } from '../shared/sheetsUrl.js';
import { productionGroup } from '../shared/productionGroups.js';

// Lines and their Raspberry Pi connections added from the app (developer only), so a new line needs no file edits or restart.
// Lines from PRODUCTION_LINES / machines.json stay as they are and are shown read-only.
// The broker password and the relay token are stored encrypted with CHECKSHEET_SECRET_KEY (.env.docker) and never sent back to the browser.
const hostPattern = /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;
const labelPattern = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,19}$/;
const piFiles = ['install-pi.sh', 'checksheet_event_relay.py', 'checksheet-relay@.service'];

// publishSettings(line, settings) sends saved Pi settings to a live line now; it resolves false when the Pi broker is not connected.
export function createLineRegistry({ db, env = process.env, fileLines = () => [], fileMachines = new Map(), onLinesChange = () => {}, onMachineChange = () => {}, publishSettings = async () => false, deployDir = new URL('../deploy/', import.meta.url) }) {
  db.exec(`CREATE TABLE IF NOT EXISTS site_lines (line TEXT PRIMARY KEY, created_at TEXT NOT NULL, created_by TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS line_machines (line TEXT PRIMARY KEY, host TEXT NOT NULL, port INTEGER NOT NULL, username TEXT NOT NULL, password TEXT NOT NULL, token TEXT NOT NULL, production_line TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS line_pi_settings (line TEXT PRIMARY KEY, google_web_app_url TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS production_line_groups (line TEXT PRIMARY KEY, group_id TEXT NOT NULL);`);
  // The line's division and site (plant). Lines without one show under "Other lines" and are hidden from executives.
  const groupOf = line => productionGroup(db.prepare('SELECT group_id FROM production_line_groups WHERE line=?').get(line)?.group_id) || null;
  // Pi settings work for app- and file-connected lines alike. An empty link means "use the link built into the Pi program".
  function piSettings(line) { const saved = db.prepare('SELECT * FROM line_pi_settings WHERE line=?').get(line); return saved ? { googleWebAppUrl: saved.google_web_app_url, updatedAt: saved.updated_at, updatedBy: saved.updated_by } : null; }
  const secret = String(env.CHECKSHEET_SECRET_KEY || '');
  const key = secret.length >= 32 ? createHash('sha256').update(secret).digest() : null;
  function seal(text) { const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv); const data = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]); return ['v1', iv, cipher.getAuthTag(), data].map(part => typeof part === 'string' ? part : part.toString('base64')).join(':'); }
  function open(sealed) { const [, iv, tag, data] = sealed.split(':').map((part, i) => i ? Buffer.from(part, 'base64') : part); const decipher = createDecipheriv('aes-256-gcm', key, iv); decipher.setAuthTag(tag); return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8'); }
  const appLines = () => db.prepare('SELECT line FROM site_lines ORDER BY line').all().map(row => row.line);
  const row = line => db.prepare('SELECT * FROM line_machines WHERE line=?').get(line);
  function config(saved) {
    if (!key) return null; // Without the key the saved secrets cannot be read; the line stays in manual recording.
    try { return { line: saved.line, mqttUrl: `mqtt://${saved.host}:${saved.port}`, productionLine: saved.production_line, requireLineCode: true, models: [], people: null, source: 'app', username: saved.username, password: open(saved.password), ingestToken: open(saved.token) }; }
    catch { return null; }
  }
  function machines() { const map = new Map(); for (const saved of db.prepare('SELECT * FROM line_machines ORDER BY line').all()) { const item = config(saved); if (item && !fileMachines.has(item.line)) map.set(item.line, item); } return map; }
  const developer = (req, res) => { if (req.user?.role === 'developer') return true; res.status(403).json({ error: 'Developer access required.' }); return false; };
  const known = line => [...fileLines(), ...appLines()].includes(line);
  function settings(line) {
    if (fileMachines.has(line)) { const file = fileMachines.get(line), url = new URL(file.mqttUrl); return { source: 'file', host: url.hostname, port: Number(url.port || 1883), username: file.username || '', productionLine: file.productionLine, hasPassword: !!file.password }; }
    const saved = row(line);
    return saved ? { source: 'app', host: saved.host, port: saved.port, username: saved.username, productionLine: saved.production_line, hasPassword: true, readable: !!config(saved), updatedAt: saved.updated_at, updatedBy: saved.updated_by } : null;
  }
  function installer(line, eventsUrl) {
    const saved = row(line), item = saved && config(saved);
    if (!item) throw new Error('Connect this line to its Pi first.');
    const relayEnv = `CHECKSHEET_LINE=${line}\nCHECKSHEET_SQLITE_PATH=\nCHECKSHEET_EVENTS_URL=${eventsUrl}\nCHECKSHEET_TOKEN=${item.ingestToken}\n`;
    const files = [['install.sh', readFileSync(new URL(piFiles[0], deployDir))], ['checksheet_event_relay.py', readFileSync(new URL(piFiles[1], deployDir))], ['checksheet-relay@.service', readFileSync(new URL(piFiles[2], deployDir))], ['relay.env', Buffer.from(relayEnv)]];
    return ['#!/usr/bin/env bash', `# Smart Checksheet relay installer for ${line}. Run ON THE ${line} PI:  sudo bash install-pi-${line}.sh`,
      '# It contains this line\'s private relay token: delete the file after installing and do not share it.', 'set -euo pipefail',
      'test "$(id -u)" -eq 0 || { echo "Run this with sudo:  sudo bash $0"; exit 1; }', 'dir="$(mktemp -d)"; trap \'rm -rf "$dir"\' EXIT', 'umask 077',
      ...files.flatMap(([name, data]) => [`base64 -d > "$dir/${name}" <<'SMARTCHECKSHEET_FILE'`, ...data.toString('base64').match(/.{1,76}/g), 'SMARTCHECKSHEET_FILE']),
      'bash "$dir/install.sh" "$@"', ''].join('\n');
  }
  const brokerOf = (host, port) => host.toLowerCase() + ':' + port;
  return {
    lines: appLines, machines, settings, piSettings, groupOf,
    async saveSheetsUrl(req, res) {
      if (!developer(req, res)) return;
      const line = req.params.line, url = String(req.body?.googleWebAppUrl ?? '').trim();
      if (!known(line) && !fileMachines.has(line)) return res.status(404).json({ error: 'Add the line first.' });
      if (url && !sheetsUrlPattern.test(url)) return res.status(400).json({ error: 'Paste the Apps Script web app link: https://script.google.com/macros/s/…/exec' });
      const updatedAt = new Date().toISOString();
      db.prepare('INSERT INTO line_pi_settings VALUES(?,?,?,?) ON CONFLICT(line) DO UPDATE SET google_web_app_url=excluded.google_web_app_url, updated_at=excluded.updated_at, updated_by=excluded.updated_by').run(line, url, updatedAt, req.user.name);
      let sent = false;
      try { sent = await publishSettings(line, piSettings(line)); } catch { sent = false; }
      res.json({ line, piSettings: piSettings(line), sent });
    },
    addLine(req, res) {
      if (!developer(req, res)) return;
      const line = String(req.body?.line || '').trim().toUpperCase();
      if (!lineCodePattern.test(line)) return res.status(400).json({ error: 'Use 2-8 capital letters or digits, starting with a letter (for example ABB4).' });
      if (known(line)) return res.status(409).json({ error: line + ' is already on this site.' });
      const group = productionGroup(String(req.body?.groupId || ''));
      if (!group) return res.status(400).json({ error: 'Choose the plant and division for this line.' });
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare('INSERT INTO site_lines VALUES(?,?,?)').run(line, new Date().toISOString(), req.user.name);
        db.prepare('INSERT INTO production_line_groups(line,group_id) VALUES(?,?) ON CONFLICT(line) DO UPDATE SET group_id=excluded.group_id').run(line, group.id);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      onLinesChange(); res.json({ line, group });
    },
    removeLine(req, res) {
      if (!developer(req, res)) return;
      const line = req.params.line;
      if (!appLines().includes(line)) return res.status(409).json({ error: 'Only lines added in the app can be removed here.' });
      if (row(line)) return res.status(409).json({ error: 'Disconnect the Pi first.' });
      db.prepare('DELETE FROM site_lines WHERE line=?').run(line); // Records already made for the line stay in the database.
      onLinesChange(); res.json({ ok: true });
    },
    saveMachine(req, res) {
      if (!developer(req, res)) return;
      const line = req.params.line, p = req.body || {}, saved = row(line);
      if (!known(line)) return res.status(404).json({ error: 'Add the line first.' });
      if (fileMachines.has(line)) return res.status(409).json({ error: line + ' is connected by the site settings file (machines.json). Change it there.' });
      if (!key) return res.status(503).json({ error: 'This PC has no CHECKSHEET_SECRET_KEY yet. Run: bash deploy/site.sh update' });
      const host = String(p.host || '').trim(), port = p.port === undefined || p.port === '' ? 1883 : Number(p.port), username = String(p.username || '').trim(), password = typeof p.password === 'string' ? p.password : '', productionLine = String(p.productionLine || '').trim();
      if (!hostPattern.test(host)) return res.status(400).json({ error: 'Enter the Pi address, for example 192.168.1.50.' });
      if (!Number.isInteger(port) || port < 1 || port > 65535) return res.status(400).json({ error: 'Broker port must be 1-65535 (usually 1883).' });
      if (!username || username.length > 100) return res.status(400).json({ error: 'Enter the broker username.' });
      if (!saved && !password || password.length > 200) return res.status(400).json({ error: 'Enter the broker password.' });
      if (!labelPattern.test(productionLine)) return res.status(400).json({ error: 'Enter the line label used in this Pi\'s shift IDs (for example MF).' });
      const used = [...[...fileMachines.values()].map(item => { const url = new URL(item.mqttUrl); return [item.line, brokerOf(url.hostname, url.port || 1883)]; }), ...db.prepare('SELECT line, host, port FROM line_machines').all().map(item => [item.line, brokerOf(item.host, item.port)])];
      const clash = used.find(([other, broker]) => other !== line && broker === brokerOf(host, port));
      if (clash) return res.status(409).json({ error: `${clash[0]} already uses that Pi. Every line needs its own Pi broker.` });
      const old = saved && config(saved);
      if (saved && !old && !password) return res.status(409).json({ error: 'The saved password cannot be read on this PC. Enter the broker password again.' });
      const token = old?.ingestToken || randomBytes(24).toString('hex'), updatedAt = new Date().toISOString();
      db.prepare(`INSERT INTO line_machines VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(line) DO UPDATE SET host=excluded.host, port=excluded.port, username=excluded.username, password=excluded.password, token=excluded.token, production_line=excluded.production_line, updated_at=excluded.updated_at, updated_by=excluded.updated_by`)
        .run(line, host, port, username, seal(password || old.password), seal(token), productionLine, updatedAt, req.user.name);
      onMachineChange(line); res.json({ line, settings: settings(line) });
    },
    removeMachine(req, res) {
      if (!developer(req, res)) return;
      if (!row(req.params.line)) return res.status(404).json({ error: 'This line has no Pi connected in the app.' });
      db.prepare('DELETE FROM line_machines WHERE line=?').run(req.params.line);
      onMachineChange(req.params.line); res.json({ ok: true });
    },
    downloadInstaller(req, res) {
      if (!developer(req, res)) return;
      let base;
      try { base = new URL(String(req.query.server || `${req.protocol}://${req.headers.host}`)); if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) throw new Error(); }
      catch { return res.status(400).json({ error: 'Enter this PC\'s address as the Pi sees it, for example http://192.168.1.10:3700.' }); }
      try {
        const script = installer(req.params.line, new URL('/api/integrations/events', base.origin).href);
        res.setHeader('Content-Type', 'text/x-shellscript; charset=utf-8'); res.setHeader('Content-Disposition', `attachment; filename="install-pi-${req.params.line}.sh"`);
        res.send(script);
      } catch (error) { res.status(409).json({ error: error.message }); }
    }
  };
}
