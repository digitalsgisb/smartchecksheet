// Renew the browser cookie on authenticated requests; server sessions never time out.
export const sessionCookieMaxAge = 400 * 24 * 60 * 60;
export function sessionCookie(token) {
  return `pd_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${sessionCookieMaxAge}${process.env.COOKIE_SECURE === 'true' ? '; Secure' : ''}`;
}
