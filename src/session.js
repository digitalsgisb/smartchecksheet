// Losing the network or restarting the server does not invalidate a tablet's cookie.
export async function revalidateSession(checkSession, onExpired) {
  try { await checkSession(); return true; }
  catch (error) {
    if (error.status === 401) onExpired();
    return false;
  }
}
