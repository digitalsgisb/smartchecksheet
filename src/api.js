export async function api(path, body, method = 'POST') {
  const response = await fetch(`/api${path}`, { credentials: 'same-origin', method: body === undefined ? 'GET' : method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || 'Unable to reach Production Digital.');
    error.status = response.status;
    throw error;
  }
  return data;
}
