let selectedLine = '';
export function setApiLine(line) { selectedLine = line; }
export function lineUrl(path, line = selectedLine) { return `/api${path}${line ? `${path.includes('?') ? '&' : '?'}line=${encodeURIComponent(line)}` : ''}`; }
export async function api(path, body, method = 'POST') {
  const response = await fetch(`/api${path}`, { credentials: 'same-origin', cache: 'no-store', method: body === undefined ? 'GET' : method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(selectedLine ? { 'X-Checksheet-Line': selectedLine } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return readApiResponse(response);
}

export async function readApiResponse(response) {
  let data;
  try { data = await response.json(); }
  catch (cause) {
    if (cause.name === 'AbortError') throw cause;
    const error = new Error([502, 503, 504].includes(response.status)
      ? `The server or gateway returned HTTP ${response.status} instead of API data. Check the Checksheet server logs and Attendance connection.`
      : `Production Digital returned HTTP ${response.status} without a valid API response. Check the backend address and proxy routing.`);
    error.status = response.status;
    error.code = 'BAD_SERVER_RESPONSE';
    throw error;
  }
  if (!response.ok) {
    const error = new Error(data?.error || `Production Digital returned HTTP ${response.status}. Retry or check the Checksheet server logs.`);
    error.status = response.status;
    error.code = data?.code;
    error.data = data;
    throw error;
  }
  return data;
}
