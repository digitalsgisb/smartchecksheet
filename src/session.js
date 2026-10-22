// Losing the network or restarting the server does not invalidate a tablet's cookie.
export function isSessionRejected(error) {
  return error.status === 401 && (['SESSION_MISSING', 'SESSION_INVALID'].includes(error.code) || error.message === 'Please sign in.');
}

export async function confirmLogin(checkSession) {
  try { return await checkSession(); }
  catch (error) {
    if (error.code === 'SESSION_INVALID') throw new Error('Your password was accepted, but the server rejected the new session. Ask your administrator to check session storage on the server. (SESSION_INVALID)');
    if (isSessionRejected(error)) throw new Error('Your password was accepted, but this browser did not keep the sign-in session. Open this site directly in Chrome or Safari, allow cookies, and use the HTTPS address. (SESSION_MISSING)');
    throw new Error('Unable to confirm your sign-in because the server connection failed. Please try again.');
  }
}

export async function revalidateSession(checkSession, onExpired) {
  try { await checkSession(); return true; }
  catch (error) {
    if (isSessionRejected(error)) onExpired(error);
    return false;
  }
}
