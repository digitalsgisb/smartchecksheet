// The same Names deployment used by the original Node-RED checksheet.
export const namesUrl = 'https://script.google.com/macros/s/AKfycbx2axNcp4GP1hJrq2dyZ4pBRNRP8kdDwvcBA7QxpPFiWdEwj7jYue_Jdu82SsNraijbKg/exec';
export function mapManpower(rows) {
  if (!Array.isArray(rows)) throw new Error('Expected manpower rows.');
  const fields = { supervisors: 'supervisors', leaders: 'lineLeaders', forming: 'formingOperators', waterjet: 'waterjetOperators', assembly: 'assemblyOperators', quality: 'qualityOperators' };
  const people = Object.fromEntries(Object.entries(fields).map(([key, source]) => [key, [...new Set(rows.map(row => row?.[source]).filter(value => typeof value === 'string' && value.trim()).map(value => value.trim()))]]));
  if (Object.values(people).some(list => !list.length)) throw new Error('Incomplete manpower list.');
  return people;
}
export function validateManpowerUrl(url) {
  if (typeof url !== 'string' || url.length > 2048) throw new Error('Enter a valid Apps Script deployment URL.');
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'script.google.com' || parsed.port || parsed.username || parsed.password || parsed.hash || !/^\/macros\/s\/[a-zA-Z0-9_-]+\/exec$/.test(parsed.pathname)) throw new Error('Use an HTTPS script.google.com deployment URL ending in /exec.');
  return parsed.href;
}
export async function fetchManpower(url, fetchImpl = fetch) {
  validateManpowerUrl(url);
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error('Apps Script unavailable.');
  const raw = await response.text();
  if (raw.length > 4000000) throw new Error('Manpower response too large.');
  return mapManpower(JSON.parse(raw.replace(/^\uFEFF/, '')));
}
export function createManpowerBridge({ env = process.env, fetchImpl = fetch, resolveUrl } = {}) {
  const cache = new Map(), pending = new Map();
  return async (req, res) => {
    const url = resolveUrl ? resolveUrl(req.line) : env[`${req.line}_MANPOWER_URL`] || env.MANPOWER_URL || namesUrl;
    try {
      validateManpowerUrl(url);
      let entry = cache.get(url);
      if (!entry || Date.now() - entry.time >= 60000) {
        if (!pending.has(url)) pending.set(url, (async () => {
          const result = { people: await fetchManpower(url, fetchImpl), updatedAt: new Date().toISOString(), time: Date.now() };
          cache.set(url, result); return result;
        })().finally(() => pending.delete(url)));
        entry = await pending.get(url);
      }
      return res.json({ people: entry.people, updatedAt: entry.updatedAt });
    } catch { return res.status(502).json({ error: 'Names unavailable. Retry Apps Script.' }); }
  };
}
