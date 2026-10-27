import { createHash } from 'node:crypto';

const fail = (status, message) => Object.assign(new Error(message), { status });
export function cmmsConfig(env = process.env) {
  const url = env.CMMS_API_URL?.trim().replace(/\/+$/, '') || '';
  if (url) {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') throw new Error('CMMS_API_URL must be an HTTP(S) origin without credentials or a path.');
  }
  return { url, username: env.CMMS_USERNAME || '', password: env.CMMS_PASSWORD || '' };
}

// Deliberately expose a small work-order projection, never CMMS users or tokens.
export function publicOrder(order) {
  const keys = ['id', 'plantId', 'number', 'title', 'machineId', 'machineName', 'area', 'location', 'status', 'priority', 'issueDescription', 'issueCategoryName', 'responsibleDepartment', 'shiftGroup', 'workDate', 'reportedByName', 'createdAt', 'updatedAt', 'acknowledgedAt', 'maintenanceStartedAt', 'resolvedAt', 'closedAt', 'completionNote', 'maintenanceActualMinutes', 'productionDowntimeReason'];
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
  async function mapping(req) {
    if (!req.user?.lines?.includes(req.line)) throw fail(403, 'Your account has no access to this line.');
    if (!config.url || !config.username || !config.password) throw fail(503, 'CMMS is not connected. Ask your administrator to configure the Sugihara CMMS connection.');
    const auth = session || await login();
    const plants = auth.user.plantAccess === 'both' ? ['port-klang', 'sendayan'] : [auth.user.plantAccess];
    if (plants.some(plant => !['port-klang', 'sendayan'].includes(plant))) throw fail(503, 'Configure plant access on the CMMS requester account.');
    return { plant: plants.length === 1 ? plants[0] : 'all', plants, requesterId: auth.user.id, requesterName: auth.user.name || config.username };
  }
  const belongs = (order, map) => map.plants.includes(order.plantId) && order.requesterId === map.requesterId;
  async function detail(id, map) {
    const order = await upstream(`/work-orders/${encodeURIComponent(id)}`, { plant: map.plant });
    if (!belongs(order, map)) throw fail(403, 'This work order does not belong to the connected CMMS requester account.');
    return order;
  }
  async function metadata(map) {
    const data = await upstream('/master-data', { plant: map.plant });
    return { machines: data.machines.filter(m => m.active && m.department === 'Production' && data.sections.some(s => s.id === m.sectionId && s.active && s.department === 'Production')).map(m => ({ ...m, plantId: map.plant })),
      issueCategories: data.issueCategories.filter(c => c.active && c.department === 'Production').map(c => ({ ...c, plantId: map.plant })) };
  }
  async function handle(req, res) {
    try {
      const account = await mapping(req);
      if (req.method === 'GET' && !req.params.id) {
        const [orders, masters] = await Promise.all([upstream('/work-orders', { plant: account.plant }), Promise.all(account.plants.map(plant => metadata({ plant })))]);
        return res.json({ plants: account.plants, requesterName: account.requesterName, machines: masters.flatMap(m => m.machines), issueCategories: masters.flatMap(m => m.issueCategories), orders: orders.filter(o => belongs(o, account)).map(publicOrder), fetchedAt: new Date().toISOString() });
      }
      if (req.method === 'GET') {
        const order = await detail(req.params.id, account);
        if (req.params.photoId) {
          const photo = order.attachments?.find(a => a.id === req.params.photoId);
          const prefix = `/uploads/work-orders/${encodeURIComponent(order.id)}/`;
          if (!photo || typeof photo.url !== 'string' || !photo.url.startsWith(prefix) || !/^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*$/.test(photo.url.slice(prefix.length))) throw fail(404, 'Photo not found.');
          const image = await upstream(photo.url, { plant: order.plantId, binary: true });
          return res.type(image.type).send(image.bytes);
        }
        return res.json(publicOrder(order));
      }
      if (!['operator', 'management', 'developer'].includes(req.user.role)) throw fail(403, 'This account is read-only.');
      if (req.method === 'PATCH' && req.params.id) {
        const p = req.body || {};
        if (!['closed', 'returned'].includes(p.status)) throw fail(400, 'Choose Verify & Close or Return to Maintenance.');
        if (typeof p.note !== 'string' || p.note.length > 2000 || typeof (p.productionDowntimeReason ?? '') !== 'string' || (p.productionDowntimeReason || '').length > 2000) throw fail(400, 'Verification notes must be at most 2,000 characters.');
        if (p.status === 'returned' && !p.note.trim()) throw fail(400, 'Explain what still needs repair before returning this job.');
        if (p.status === 'closed' && !['location', 'repair', 'operation'].every(key => p.checks?.[key] === true)) throw fail(400, 'Confirm the equipment location, repair evidence and operating condition before closing.');
        const lock = `verify:${req.params.id}`;
        if (busy.has(lock)) throw fail(409, 'Verification is already in progress. Refresh this job before retrying.');
        busy.add(lock);
        try {
          const current = await detail(req.params.id, account);
          if (current.status !== 'resolved') throw fail(409, 'Only a job awaiting verification can be closed or returned. Refresh this job.');
          if (!p.expectedUpdatedAt || p.expectedUpdatedAt !== current.updatedAt) throw fail(409, 'This job changed while you were reviewing it. Refresh and review the latest details.');
          const reason = (p.productionDowntimeReason || '').trim();
          if (p.status === 'closed' && current.responsibleDepartment === 'Production' && Math.round((Date.now() - Date.parse(current.createdAt)) / 60000) >= 60 && !current.productionDowntimeReason && !reason) throw fail(400, 'Enter why this work order took 60 minutes or more before closing.');
          const note = `${p.status === 'closed' ? 'Verified and closed' : 'Returned to maintenance'} by ${req.user.name} via Smart Checksheet (${req.line}).${p.status === 'closed' ? ' Equipment/location, repair evidence and operating condition checked.' : ''}${p.note.trim() ? `\n${p.note.trim()}` : ''}`;
          await upstream(`/work-orders/${encodeURIComponent(current.id)}/status`, { method: 'PATCH', plant: current.plantId, body: { status: p.status, actorId: account.requesterId, note, ...(reason ? { productionDowntimeReason: reason } : {}) } });
          return res.json({ order: publicOrder(await detail(current.id, account)) });
        } finally { busy.delete(lock); }
      }
      const p = req.body;
      const plant = p?.plant || (account.plants.length === 1 ? account.plants[0] : '');
      if (!account.plants.includes(plant)) throw fail(400, 'Select a plant permitted for the connected CMMS requester account.');
      const map = { ...account, plant, plants: [plant] };
      const options = { plant };
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
      if (!machine || !category) throw fail(400, 'Select an active Production machine and issue category from CMMS.');
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
