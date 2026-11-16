import { createHash, timingSafeEqual } from 'node:crypto';

// One shared password (SHIFT_OVERRIDE_PASSWORD) lets an operator end the current shift early and start a new one.
// Only a hash is kept in memory; wrong tries are limited per line so the password cannot be guessed from a tablet.
const hash = value => createHash('sha256').update(value).digest();
export function createShiftOverride({ password = '', now = Date.now, maxTries = 5, windowMs = 15 * 60000 } = {}) {
  const secret = password ? hash(password) : null;
  const failures = new Map();
  return {
    enabled: Boolean(secret),
    check(line, value) {
      if (!secret) throw new Error('Shift override is not set up on this server. Ask the developer.');
      const at = now(); const recent = (failures.get(line) || []).filter(time => at - time < windowMs);
      if (recent.length >= maxTries) { failures.set(line, recent); throw new Error('Too many wrong passwords. Try again in 15 minutes.'); }
      if (typeof value !== 'string' || !value || value.length > 200 || !timingSafeEqual(hash(value), secret)) { recent.push(at); failures.set(line, recent); throw new Error('Wrong override password.'); }
      failures.delete(line);
    }
  };
}
