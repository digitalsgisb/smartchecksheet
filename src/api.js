let selectedLine = '';
export function setApiLine(line) { selectedLine = line; }
export function lineUrl(path, line = selectedLine) { return `/api${path}${line ? `${path.includes('?') ? '&' : '?'}line=${encodeURIComponent(line)}` : ''}`; }
export async function api(path, body, method = 'POST') {
  const response = await fetch(`/api${path}`, { credentials: 'same-origin', cache: 'no-store', method: body === undefined ? 'GET' : method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(selectedLine ? { 'X-Checksheet-Line': selectedLine } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let data;
  try { data = await response.json(); }
  catch {
    const error = new Error(`Production Digital returned HTTP ${response.status} without a valid API response. The backend or proxy may be restarting or unavailable; retry and check the Checksheet server logs.`);
    error.status = response.status;
    error.code = 'BAD_SERVER_RESPONSE';
    throw error;
  }
  if (!response.ok) {
    const error = new Error(data?.error || `Production Digital returned HTTP ${response.status}. Retry or check the Checksheet server logs.`);
    error.status = response.status;
    error.code = data?.code;
    throw error;
  }
  return data;
}
