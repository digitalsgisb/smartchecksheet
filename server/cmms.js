import { createHash } from 'node:crypto';

const fail = (status, message) => Object.assign(new Error(message), { status });
export function cmmsConfig(env = process.env) {
  const url = env.CMMS_API_URL?.trim().replace(/\/+$/, '') || '';
  if (url) {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') throw new Error('CMMS_API_URL must be an HTTP(S) origin without credentials or a path.');
  }
  const lines = JSON.parse(env.CMMS_LINES || '{}');
  if (!lines || Array.isArray(lines) || typeof lines !== 'object') throw new Error('CMMS_LINES must be an object.');
  for (const mapping of Object.values(lines)) {
    if (!['port-klang', 'sendayan'].includes(mapping?.plant) || !Array.isArray(mapping.machineIds) || !mapping.machineIds.length || mapping.machineIds.some(id => typeof id !== 'string' || !id.trim())) throw new Error('Each CMMS line needs a plant and machineIds.');
  }
  return { url, username: env.CMMS_USERNAME || '', password: env.CMMS_PASSWORD || '', lines };
}

// Deliberately expose a small work-order projection, never CMMS users or tokens.
export function publicOrder(order) {
  const keys = ['id', 'number', 'title', 'machineId', 'machineName', 'area', 'location', 'status', 'priority', 'issueDescription', 'reportedByName', 'createdAt', 'updatedAt', 'acknowledgedAt', 'maintenanceStartedAt', 'resolvedAt', 'closedAt', 'completionNote', 'productionDowntimeReason'];
  return { ...Object.fromEntries(keys.map(key => [key, order[key] ?? null])), assignedTo: order.assignedTo?.name || null,
    activities: (order.activities || []).map(({ id, action, message, status, createdAt }) => ({ id, action, message, status, createdAt })),
    photos: (order.attachments || []).filter(a => a.mimeType?.startsWith('image/')).map(({ id, kind, originalName }) => ({ id, kind, originalName })) };
}

export function createCmmsBridge({ db, config = cmmsConfig(), fetchImpl = fetch }) {
  db.exec(`CREATE TABLE IF NOT EXISTS cmms_submissions (request_id TEXT PRIMARY KEY, scope TEXT NOT NULL, actor TEXT NOT NULL, fingerprint TEXT NOT NULL, order_id TEXT, created_at TEXT NOT NULL);`);
  let session, loginPromise;
  const busy = new Set();
  async function request(path, { method = 'GET', body, plant, token, binary = false } = {}) {
    let response;
    try {
      response = await fetchImpl(`${config.url}${binary ? '' : '/api'}${path}`, { method, redirect: 'error', signal: AbortSignal.timeout(15000),
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(plant ? { 'X-CMMS-Plant': plant } : {}), ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}) },
        body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body) });
    } catch { throw fail(502, 'CMMS connection interrupted. Refresh work orders before retrying a submission.'); }
    if (!response.ok) throw fail(response.status === 401 ? 401 : 502, 'CMMS rejected the request. Check the connection account and CMMS permissions.');
    if (binary) {
      const type = response.headers.get('content-type')?.split(';')[0];
      if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(type)) throw fail(502, 'CMMS did not return a supported image.');
      const reader = response.body.getReader(); const chunks = []; let size = 0;
      try {
        while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 8 * 1024 * 1024) throw fail(502, 'CMMS image exceeds 8 MB.'); chunks.push(value); }
      } finally { await reader.cancel().catch(() => {}); }
      return { bytes: Buffer.concat(chunks), type };
    }
    try { return await response.json(); } catch { throw fail(502, 'CMMS returned an invalid response.'); }
  }
  async function login() {
    if (!loginPromise) loginPromise = request('/auth/login', { method: 'POST', body: { username: config.username, password: config.password } }).then(result => {
      if (!result.token || result.user?.role !== 'requester' || result.user?.department?.toLowerCase() !== 'production') throw fail(503, 'Configure a dedicated CMMS Production requester account.');
      session = result;
      return result;
    }).finally(() => { loginPromise = null; });
    return loginPromise;
  }
  async function upstream(path, options = {}) {
    const auth = session || await login();
    try { return await request(path, { ...options, token: auth.token }); }
    catch (error) {
      if (error.status !== 401) throw error;
      session = null;
      // An explicit authentication rejection is safe to retry; network failures are not.
      const refreshed = await login();
      return request(path, { ...options, token: refreshed.token });
    }
  }
  function mapping(req) {
    if (!req.user?.lines?.includes(req.line)) throw fail(403, 'Your account has no access to this line.');
    const map = config.lines[req.line];
    if (!config.url || !config.username || !config.password || !map) throw fail(503, 'CMMS is not connected for this line. Ask your administrator to configure the Sugihara CMMS connection.');
    return map;
  }
  const belongs = (order, map) => order.plantId === map.plant && order.responsibleDepartment === 'Production' && map.machineIds.includes(order.machineId);
  async function detail(id, map) {
    const order = await upstream(`/work-orders/${encodeURIComponent(id)}`, { plant: map.plant });
    if (!belongs(order, map)) throw fail(403, 'This work order belongs to another line.');
    return order;
  }
  async function metadata(map) {
    const data = await upstream('/master-data', { plant: map.plant });
    return { machines: data.machines.filter(m => m.active && m.department === 'Production' && map.machineIds.includes(m.id) && data.sections.some(s => s.id === m.sectionId && s.active && s.department === 'Production')),
      issueCategories: data.issueCategories.filter(c => c.active && c.department === 'Production') };
  }
  async function handle(req, res) {
    try {
      const map = mapping(req);
      const options = { plant: map.plant };
      if (req.method === 'GET' && !req.params.id) {
        const [orders, master] = await Promise.all([upstream('/work-orders', options), metadata(map)]);
        return res.json({ ...master, orders: orders.filter(o => belongs(o, map)).map(publicOrder), fetchedAt: new Date().toISOString() });
      }
      if (req.method === 'GET') {
        const order = await detail(req.params.id, map);
        if (req.params.photoId) {
          const photo = order.attachments?.find(a => a.id === req.params.photoId);
          const prefix = `/uploads/work-orders/${encodeURIComponent(order.id)}/`;
          if (!photo || typeof photo.url !== 'string' || !photo.url.startsWith(prefix) || !/^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*$/.test(photo.url.slice(prefix.length))) throw fail(404, 'Photo not found.');
          const image = await upstream(photo.url, { ...options, binary: true });
          return res.type(image.type).send(image.bytes);
        }
        return res.json(publicOrder(order));
      }
      if (!['operator', 'management', 'developer'].includes(req.user.role)) throw fail(403, 'This account is read-only.');
      const p = req.body;
      if (!p || !/^[a-f0-9-]{36}$/i.test(p.requestId || '')) throw fail(400, 'A valid submission identifier is required.');
      if (typeof p.issueDescription !== 'string' || !p.issueDescription.trim() || p.issueDescription.length > 4000) throw fail(400, 'Enter an issue description of up to 4,000 characters.');
      if (!['A', 'B'].includes(p.shiftGroup) || !['low', 'medium', 'high', 'critical'].includes(p.priority)) throw fail(400, 'Select a shift group and priority.');
      const photo = p.photo;
      if (!photo || !['image/jpeg', 'image/png', 'image/webp'].includes(photo.type) || typeof photo.data !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(photo.data)) throw fail(400, 'Add a JPEG, PNG or WebP issue photo.');
      const bytes = Buffer.from(photo.data, 'base64');
      if (!bytes.length || bytes.length > 8 * 1024 * 1024) throw fail(400, 'Issue photos must be at most 8 MB.');
      const validImage = photo.type === 'image/jpeg' ? bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255])) : photo.type === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
      if (!validImage) throw fail(400, 'The photo content does not match its image format.');
      const { machines, issueCategories } = await metadata(map);
      const machine = machines.find(m => m.id === p.machineId);
      const category = issueCategories.find(c => c.id === p.issueCategoryId);
      if (!machine || !category) throw fail(400, 'Select a configured line machine and issue category.');
      const scope = JSON.stringify([config.url, map.plant, req.line]);
      const fingerprint = createHash('sha256').update(JSON.stringify([p.machineId, p.issueCategoryId, p.issueDescription, p.priority, p.shiftGroup, photo.type, photo.data])).digest('hex');
      const previous = db.prepare('SELECT * FROM cmms_submissions WHERE request_id=?').get(p.requestId);
      if (previous && (previous.scope !== scope || previous.actor !== req.user.id || previous.fingerprint !== fingerprint)) throw fail(409, 'This submission identifier is already in use. Restore the original form or start a new request.');
      if (busy.has(p.requestId)) throw fail(409, 'This work order is still submitting. Please wait.');
      busy.add(p.requestId);
      try {
        let order;
        const marker = `[Checksheet request: ${p.requestId}]`;
        if (previous?.order_id) order = await detail(previous.order_id, map);
        else if (previous) {
          const orders = await upstream('/work-orders', options);
          order = orders.find(o => belongs(o, map) && o.description?.includes(marker));
          if (!order) throw fail(409, 'The previous submission is unconfirmed. Check CMMS before issuing another request. This request will not be sent twice.');
        } else {
          const actor = session || await login();
          db.prepare('INSERT INTO cmms_submissions VALUES(?,?,?,?,NULL,?)').run(p.requestId, scope, req.user.id, fingerprint, new Date().toISOString());
          order = await upstream('/work-orders', { ...options, method: 'POST', body: {
            type: 'maintenance', requesterId: actor.user.id, responsibleDepartment: 'Production', reportedByDepartment: 'Production', reportedByName: req.user.name,
            machineId: machine.id, sectionId: machine.sectionId, machineName: machine.name, area: machine.area,
            issueCategoryId: category.id, issueDescription: p.issueDescription.trim(), description: `${p.issueDescription.trim()}\n\nIssued from Smart Checksheet · ${req.line} · ${req.user.name}\n${marker}`,
            workDate: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(new Date()), shiftGroup: p.shiftGroup, priority: p.priority
          } });
        }
        if (!belongs(order, map) || !order.id) throw fail(502, 'CMMS returned an unexpected work order. Check CMMS before submitting again.');
        db.prepare('UPDATE cmms_submissions SET order_id=? WHERE request_id=?').run(order.id, p.requestId);
        const filename = `checksheet-${p.requestId}.${{ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[photo.type]}`;
        order = await detail(order.id, map);
        if (!order.attachments?.some(a => a.originalName === filename)) {
          const form = new FormData(); form.append('kind', 'issue'); form.append('attachments', new Blob([bytes], { type: photo.type }), filename);
          try { await upstream(`/work-orders/${encodeURIComponent(order.id)}/attachments`, { ...options, method: 'POST', body: form }); }
          catch { throw fail(502, `Work order ${order.number} was created, but its photo is unconfirmed. Retry this same form to finish without creating another work order.`); }
        }
        return res.status(201).json({ order: publicOrder(await detail(order.id, map)) });
      } finally { busy.delete(p.requestId); }
    } catch (error) { return res.status(error.status === 401 ? 502 : error.status || 502).json({ error: error.status ? error.message : 'CMMS is unavailable. Please try refreshing.' }); }
  }
  return handle;
}
