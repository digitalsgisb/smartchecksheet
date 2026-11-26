// A screen can keep receiving data and still be minutes behind (data queued on a slow link; ABB7 TV, 26/11: 12 min).
// Each state carries the server's clock. The smallest gap seen on this connection is this device's clock difference
// plus normal delay; a state arriving more than limitMs later than that is old, and the screen should reconnect.
export function createLagCheck({ limitMs = 15000, now = Date.now } = {}) {
  let base = Infinity;
  return serverTime => {
    if (!Number.isFinite(serverTime)) return false;
    const gap = now() - serverTime;
    base = Math.min(base, gap);
    return gap - base > limitMs;
  };
}
