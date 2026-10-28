import test from 'node:test';
import assert from 'node:assert/strict';
import { filterOrders, needsDowntimeReason } from '../src/workOrderView.js';

const jobs = [
  { id: 'open', status: 'open', plantId: 'port-klang', location: 'Forming', area: 'Bay 1', reportedByName: 'Ali', updatedAt: '2026-10-27T01:00:00Z' },
  { id: 'resolved', status: 'resolved', plantId: 'sendayan', location: 'Assembly', area: 'Bay 2', updatedAt: '2026-10-27T02:00:00Z' },
  { id: 'closed', status: 'closed', plantId: 'port-klang', location: 'Forming', updatedAt: '2026-10-27T03:00:00Z' },
  { id: 'returned', status: 'returned', plantId: 'sendayan', updatedAt: '2026-10-27T04:00:00Z' },
  { id: 'cancelled', status: 'cancelled', plantId: 'sendayan', updatedAt: '2026-10-27T05:00:00Z' }
];
test('active, verification and history views preserve returned jobs as active', () => {
  assert.deepEqual(filterOrders(jobs).map(o => o.id), ['resolved', 'returned', 'open']);
  assert.deepEqual(filterOrders(jobs, { view: 'verify' }).map(o => o.id), ['resolved']);
  assert.deepEqual(filterOrders(jobs, { view: 'history' }).map(o => o.id), ['cancelled', 'closed']);
  assert.equal(filterOrders(jobs, { view: 'all' }).length, 5);
});
test('place search and combined filters find the correct jobs without changing source data', () => {
  assert.deepEqual(filterOrders(jobs, { search: ' BAY 1 ' }).map(o => o.id), ['open']);
  assert.deepEqual(filterOrders(jobs, { search: 'ali' }).map(o => o.id), ['open']);
  assert.deepEqual(filterOrders(jobs, { view: 'all', plant: 'port-klang', location: 'Forming', status: 'closed' }).map(o => o.id), ['closed']);
  assert.equal(filterOrders(jobs, { plant: 'sendayan', search: 'Port Klang' }).length, 0);
  assert.deepEqual(jobs.map(o => o.id), ['open', 'resolved', 'closed', 'returned', 'cancelled']);
});
test('verification reason follows the CMMS 60-minute rule and existing saved reasons', () => {
  const now = Date.parse('2026-10-27T02:00:00Z');
  const order = { responsibleDepartment: 'Production', createdAt: '2026-10-27T01:00:00Z' };
  assert.equal(needsDowntimeReason(order, now), true);
  assert.equal(needsDowntimeReason({ ...order, productionDowntimeReason: 'Waiting for parts' }, now), false);
  assert.equal(needsDowntimeReason({ ...order, createdAt: '2026-10-27T01:30:00Z' }, now), false);
});
