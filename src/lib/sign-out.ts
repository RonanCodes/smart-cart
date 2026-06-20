/**
 * Pure helpers for the server-side /sign-out route. Kept out of the route file
 * so the cookie-forwarding + redirect logic can be unit-tested without booting a
 * real Better Auth instance or the server-fn/session chain.
 */

/**
 * Read every Set-Cookie header from a Response in a runtime-portable way.
 * Workers / undici expose getSetCookie() which preserves MULTIPLE cookies;
 * older runtimes only give the comma-joined single get('set-cookie'). We never
 * comma-split (a cookie's Expires date contains a comma), so we just pass the
 * single value through as one cookie when getSetCookie is absent.
 */
export function readSetCookies(res: Response): string[] {
  if (typeof res.headers.getSetCookie === 'function') {
    return res.headers.getSetCookie()
  }
  const single = res.headers.get('set-cookie')
  return single ? [single] : []
}

/**
 * Build the 302-to-'/' redirect that carries the session-clearing Set-Cookie(s)
 * Better Auth emitted. Splitting this out keeps the route handler a thin wrapper
 * and lets us assert the redirect shape directly.
 */
export function buildSignOutRedirect(setCookies: string[]): Response {
  const headers = new Headers({ Location: '/' })
  for (const cookie of setCookies) headers.append('Set-Cookie', cookie)
  return new Response(null, { status: 302, headers })
}
