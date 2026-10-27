export const statuses = { open: 'Open', acknowledged: 'Acknowledged', in_progress: 'In progress', pending_material: 'Pending material', on_hold: 'On hold', resolved: 'Awaiting verification', closed: 'Closed', returned: 'Returned', cancelled: 'Cancelled' };
export const finished = status => ['closed', 'cancelled'].includes(status);
export const plantLabel = plant => ({ 'sendayan': 'Sendayan', 'port-klang': 'Port Klang' }[plant] || 'Plant not recorded');
export const stamp = value => value ? new Date(value).toLocaleString('en-GB', { timeZone: 'Asia/Kuala_Lumpur', dateStyle: 'medium', timeStyle: 'short' }) : '—';
export function filterOrders(orders, { view = 'active', search = '', plant = '', location = '', status = '' } = {}) {
  const query = search.trim().toLowerCase();
  return orders.filter(o => (view === 'all' || (view === 'history' ? finished(o.status) : view === 'verify' ? o.status === 'resolved' : !finished(o.status)))
    && (!plant || o.plantId === plant) && (!location || o.location === location) && (!status || o.status === status)
    && (!query || [o.number, o.machineName, o.issueDescription, o.location, o.area, o.reportedByName, plantLabel(o.plantId)].some(value => String(value || '').toLowerCase().includes(query))))
    .sort((a, b) => Date.parse(b.updatedAt || b.createdAt || 0) - Date.parse(a.updatedAt || a.createdAt || 0));
}
export function needsDowntimeReason(order, now = Date.now()) {
  return order.responsibleDepartment === 'Production' && !order.productionDowntimeReason && Math.round((now - Date.parse(order.createdAt)) / 60000) >= 60;
}
