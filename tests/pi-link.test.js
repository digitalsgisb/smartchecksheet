import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { requireNoOverlap, shiftSchedule } from '../server/domain.js';
import { createRelayStatus } from '../server/relayStatus.js';
import { createLineRegistry } from '../server/lineRegistry.js';

const shift = (date, name, overtime, extra = {}) => ({ id: `${date.replaceAll('-', '')}-${name}-SDY2`, date, shift: name, overtime, ...shiftSchedule(date, name, overtime), ...extra });

test('a queued shift that starts inside the running shift is refused with a plain reason', () => {
  const day = shift('2026-11-25', 'Day', true, { status: 'active' }), at0148 = Date.parse('2026-11-25T09:00:00+08:00');
  // The 24/11 case: Night without OT (16:15) queued while the Day shift has OT until 20:00.
  assert.throws(() => requireNoOverlap(shift('2026-11-25', 'Night', false), day, at0148), { message: 'Day shift runs until 20:00 (OT), but this Night shift starts at 16:15. Check WITH OT and the date.' });
  const night = shift('2026-11-25', 'Night', true);
  assert.equal(requireNoOverlap(night, day, at0148), night, 'Night with OT starts when the Day OT ends');
  assert.equal(requireNoOverlap(shift('2026-11-25', 'Day', false), day, at0148).id, day.id, 'editing the same shift is not an overlap');
  assert.ok(requireNoOverlap(shift('2026-11-25', 'Night', false), { ...day, status: 'ended' }, at0148), 'an ended shift does not block');
  assert.ok(requireNoOverlap(shift('2026-11-25', 'Night', false), null, at0148));
  assert.ok(requireNoOverlap(shift('2026-11-25', 'Night', false), day, Date.parse('2026-11-25T16:20:00+08:00')), 'a form starting now is left to the Pi and the shift override');
});

test('relay health comes from the heartbeat, turns silent after 10 minutes and is separate from events', () => {
  let clock = Date.parse('2026-11-25T08:00:00Z');
  const relays = createRelayStatus({ db: new DatabaseSync(':memory:'), now: () => clock });
  assert.deepEqual(relays.status('SDY1'), { seenAt: null, lastEventAt: null, waiting: null, refused: null, lastError: '', healthy: false });
  relays.heartbeat('SDY1', { waiting: 4973, refused: 1, last_error: 'HTTP 403:   error code: 1010\n', relay: 'SmartChecksheet-Relay/2', extra: 'ignored' });
  assert.deepEqual(relays.status('SDY1'), { seenAt: '2026-11-25T08:00:00.000Z', lastEventAt: null, waiting: 4973, refused: 1, lastError: 'HTTP 403: error code: 1010', healthy: true });
  relays.delivered('SDY1'); clock += 11 * 60000;
  assert.equal(relays.status('SDY1').healthy, false);
  assert.equal(relays.status('SDY1').lastEventAt, '2026-11-25T08:00:00.000Z');
  relays.heartbeat('SDY1', { waiting: -5, refused: 'x' });
  assert.equal(relays.status('SDY1').waiting, 0); assert.equal(relays.status('SDY1').healthy, true);
});

test('the Pi installer uses the saved Tailscale address and refuses the public HTTPS address', () => {
  const reply = () => ({ code: 200, headers: {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; }, setHeader(name, value) { this.headers[name] = value; }, send(body) { this.body = body; return this; } });
  const db = new DatabaseSync(':memory:'), registry = createLineRegistry({ db, env: { CHECKSHEET_SECRET_KEY: 'k'.repeat(40), CHECKSHEET_PI_URL: 'http://100.64.0.5:3700' }, fileLines: () => [] });
  const call = (name, req) => { const res = reply(); registry[name]({ user: { role: 'developer', name: 'Dev' }, params: {}, query: {}, body: {}, protocol: 'https', headers: { host: 'smartchecksheet.example.org' }, ...req }, res); return res; };
  call('addLine', { body: { line: 'SDY1', groupId: 'conversion-port-klang' } });
  call('saveMachine', { params: { line: 'SDY1' }, body: { host: '100.64.0.21', username: 'checksheet', password: 'broker-secret-1', productionLine: 'SDY1' } });
  assert.equal(registry.piServerUrl(), 'http://100.64.0.5:3700');
  const installer = call('downloadInstaller', { params: { line: 'SDY1' } });
  assert.equal(installer.code, 200);
  assert.match(Buffer.from(installer.body.match(/relay\.env" <<'SMARTCHECKSHEET_FILE'\n([\s\S]*?)\nSMARTCHECKSHEET_FILE/)[1].replaceAll('\n', ''), 'base64').toString(), /CHECKSHEET_EVENTS_URL=http:\/\/100\.64\.0\.5:3700\/api\/integrations\/events/);
  const blocked = call('downloadInstaller', { params: { line: 'SDY1' }, query: { server: 'https://smartchecksheet.example.org' } });
  assert.equal(blocked.code, 400); assert.match(blocked.body.error, /Cloudflare blocks it/);
});
