import { describe, it, expect } from 'vitest'
import { readSetCookies, buildSignOutRedirect } from './sign-out'

describe('readSetCookies', () => {
  it('reads a single Set-Cookie from a response', () => {
    const res = new Response(null, {
      headers: {
        'set-cookie': 'better-auth.session_token=; Max-Age=0; Path=/',
      },
    })
    expect(readSetCookies(res)).toEqual([
      'better-auth.session_token=; Max-Age=0; Path=/',
    ])
  })

  it('returns an empty array when no Set-Cookie is present', () => {
    expect(readSetCookies(new Response(null))).toEqual([])
  })
})

describe('buildSignOutRedirect', () => {
  it('302-redirects to / and forwards the session-clearing cookie', () => {
    const clearCookie =
      'better-auth.session_token=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax'
    const res = buildSignOutRedirect([clearCookie])

    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toBe('/')

    const setCookies =
      typeof res.headers.getSetCookie === 'function'
        ? res.headers.getSetCookie()
        : [res.headers.get('set-cookie')]
    expect(setCookies).toContain(clearCookie)
    // The forwarded cookie expires the session (Max-Age=0), which is what makes
    // '/' render the signed-out Landing instead of bouncing back to /app.
    expect(setCookies.join('\n')).toMatch(/Max-Age=0/)
  })

  it('still redirects to / when there is no cookie to clear', () => {
    const res = buildSignOutRedirect([])
    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toBe('/')
  })
})
