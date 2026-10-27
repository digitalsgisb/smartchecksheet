import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

export function liveConfigs(env = process.env) {
  const file = env.MACHINE_CONNECTIONS_PATH && resolve(env.MACHINE_CONNECTIONS_PATH);
  const entries = file ? JSON.parse(readFileSync(file, 'utf8')) : env.MQTT_URL ? [{ line: 'ABB2', mqttUrl: env.MQTT_URL, catalogPath: env.CATALOG_PATH, requireLineCode: false }] : [];
  if (!Array.isArray(entries) || !entries.length) throw new Error('Live mode requires MACHINE_CONNECTIONS_PATH or the legacy ABB2 MQTT_URL and CATALOG_PATH.');
  const configs = new Map(), brokers = new Set();
  for (const entry of entries) {
    const { line } = entry;
    if (!['ABB2', 'ABB3', 'ABB7'].includes(line) || configs.has(line)) throw new Error('Configure each supported machine line once: ABB2, ABB3, ABB7.');
    const url = new URL(entry.mqttUrl);
    if (!['mqtt:', 'mqtts:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) throw new Error(line + ': use mqtt://host:port or mqtts://host:port; credentials belong in environment variables.');
    const broker = url.hostname.toLowerCase() + ':' + (url.port || (url.protocol === 'mqtts:' ? '8883' : '1883'));
    if (brokers.has(broker)) throw new Error('Machine command topics are shared: each line must use a separate broker address.');
    brokers.add(broker);
    if (!entry.catalogPath) throw new Error(line + ': catalogPath is required.');
    const catalog = JSON.parse(readFileSync(resolve(file ? dirname(file) : process.cwd(), entry.catalogPath), 'utf8'));
    const { models, people } = catalog;
    if (!Array.isArray(models) || !models.length || models.some(m => !m.name || !Number.isFinite(m.cycle) || m.cycle <= 0 || !Number.isFinite(m.pcsHr) || m.pcsHr <= 0 || !Number.isFinite(m.slabWidth) || m.slabWidth <= 0 || !Number.isFinite(m.slabLength) || m.slabLength <= 0) || !people || ['supervisors', 'leaders', 'operators', 'quality'].some(key => !Array.isArray(people[key]) || !people[key].length || people[key].some(name => typeof name !== 'string' || !name.trim()))) throw new Error(line + ': provide verified models (cycle, pcsHr, slabWidth, slabLength) and manpower lists.');
    configs.set(line, { ...entry, models, people, productionLine: entry.productionLine || { ABB2: 'Line 1', ABB3: 'Line 3', ABB7: 'Line 7' }[line],
      requireLineCode: entry.requireLineCode !== false,
      username: env[line + '_MQTT_USERNAME'] || (line === 'ABB2' ? env.MQTT_USERNAME : '') || '',
      password: env[line + '_MQTT_PASSWORD'] || (line === 'ABB2' ? env.MQTT_PASSWORD : '') || '',
      ingestToken: env[line + '_INGEST_TOKEN'] || (line === 'ABB2' ? env.INGEST_TOKEN : '') || '' });
  }
  return configs;
}
