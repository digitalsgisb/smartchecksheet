import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

// The same rule is used by the Pi relay and the deployment scripts.
export const lineCodePattern = /^[A-Z][A-Z0-9]{1,7}$/;

export function liveConfigs(env = process.env) {
  const file = env.MACHINE_CONNECTIONS_PATH && resolve(env.MACHINE_CONNECTIONS_PATH);
  const entries = file ? JSON.parse(readFileSync(file, 'utf8')) : env.MQTT_URL ? [{ line: 'ABB2', mqttUrl: env.MQTT_URL, catalogPath: env.CATALOG_PATH, requireLineCode: false }] : [];
  if (!Array.isArray(entries) || !entries.length) throw new Error('Live mode requires MACHINE_CONNECTIONS_PATH or the legacy ABB2 MQTT_URL and CATALOG_PATH.');
  const configs = new Map(), brokers = new Set();
  for (const entry of entries) {
    const { line } = entry;
    if (typeof line !== 'string' || !lineCodePattern.test(line)) throw new Error('A machine line code uses 2-8 capital letters or digits and starts with a letter, for example ABB7 or SDY1.');
    if (configs.has(line)) throw new Error(line + ' is configured twice; list each machine line once.');
    const url = new URL(entry.mqttUrl);
    if (!['mqtt:', 'mqtts:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) throw new Error(line + ': use mqtt://host:port or mqtts://host:port; credentials belong in environment variables.');
    const broker = url.hostname.toLowerCase() + ':' + (url.port || (url.protocol === 'mqtts:' ? '8883' : '1883'));
    if (brokers.has(broker)) throw new Error('Machine command topics are shared: each line must use a separate broker address.');
    brokers.add(broker);
    if (!entry.catalogPath) throw new Error(line + ': catalogPath is required.');
    const catalog = JSON.parse(readFileSync(resolve(file ? dirname(file) : process.cwd(), entry.catalogPath), 'utf8'));
    const { models, people } = catalog;
    const optionalStandard = value => value == null || Number.isFinite(value) && value >= 0;
    if (!Array.isArray(models) || !models.length || models.some(m => !m || typeof m.name !== 'string' || !m.name.trim() || !['cycle', 'pcsHr', 'slabWidth', 'slabLength'].every(key => optionalStandard(m[key]))) || !people || ['supervisors', 'leaders', 'operators', 'quality'].some(key => !Array.isArray(people[key]) || !people[key].length || people[key].some(name => typeof name !== 'string' || !name.trim()))) throw new Error(line + ': provide verified models (optional nonnegative standards) and manpower lists.');
    configs.set(line, { ...entry, models, people, productionLine: entry.productionLine || { ABB2: 'Line 1', ABB3: 'Line 3', ABB7: 'Line 7' }[line] || line,
      requireLineCode: entry.requireLineCode !== false,
      username: env[line + '_MQTT_USERNAME'] || (line === 'ABB2' ? env.MQTT_USERNAME : '') || '',
      password: env[line + '_MQTT_PASSWORD'] || (line === 'ABB2' ? env.MQTT_PASSWORD : '') || '',
      ingestToken: env[line + '_INGEST_TOKEN'] || (line === 'ABB2' ? env.INGEST_TOKEN : '') || '' });
  }
  return configs;
}
