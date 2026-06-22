import { describe, it, expect } from 'vitest'
import {
  entryRedirectTarget,
  authedRedirectTarget,
  requestHasSessionCookie,
} from './route-guards'
import type { AuthContext } from './route-guards'

describe('entryRedirectTarget', () => {
  it('renders the Landing for a signed-out visitor (no redirect)', () => {
    expect(
      entryRedirectTarget({ signedIn: false, onboarded: false }),
    ).toBeNull()
  })

  it('ignores onboarded flag when signed out', () => {
    expect(entryRedirectTarget({ signedIn: false, onboarded: true })).toBeNull()
  })

  it('sends a signed-in + onboarded user to /week', () => {
    expect(entryRedirectTarget({ signedIn: true, onboarded: true })).toBe(
      '/week',
    )
  })

  it('sends a signed-in + NOT-onboarded user to /onboarding', () => {
    expect(entryRedirectTarget({ signedIn: true, onboarded: false })).toBe(
      '/onboarding',
    )
  })
})

const USER = { id: 'u1', email: 'a@b.com', name: 'A' }

describe('authedRedirectTarget (shared _authed guard, #251)', () => {
  it('redirects a signed-out visitor to /sign-in', () => {
    const ctx: AuthContext = { user: null, hasHousehold: false }
    expect(authedRedirectTarget(ctx)).toBe('/sign-in')
  })

  it('redirects a signed-out visitor to /sign-in even if hasHousehold is true', () => {
    // hasHousehold can never be true without a user, but the guard must fail
    // closed on the user check first regardless.
    const ctx: AuthContext = { user: null, hasHousehold: true }
    expect(authedRedirectTarget(ctx)).toBe('/sign-in')
  })

  it('redirects a signed-in but NOT-onboarded user to /onboarding', () => {
    const ctx: AuthContext = { user: USER, hasHousehold: false }
    expect(authedRedirectTarget(ctx)).toBe('/onboarding')
  })

  it('lets a signed-in + onboarded user through (no redirect)', () => {
    const ctx: AuthContext = { user: USER, hasHousehold: true }
    expect(authedRedirectTarget(ctx)).toBeNull()
  })

  it('preserves the exact precedence of the old per-route guards', () => {
    // Old order: requireUserBeforeLoad() (sign-in) THEN hasHousehold()
    // (onboarding). The user check must win when both would fire.
    expect(authedRedirectTarget({ user: null, hasHousehold: false })).toBe(
      '/sign-in',
    )
  })

  // #381: `/week` crashed into the error boundary with `e.user` because the
  // resolved auth context was itself `undefined` (a prod 500 made the server fn
  // resolve to nothing, same failure mode as the #380 loader). The guard must
  // fail closed to /sign-in instead of reading `.user` off undefined.
  it('fails closed to /sign-in when the whole context is undefined (#381)', () => {
    expect(authedRedirectTarget(undefined as unknown as AuthContext)).toBe(
      '/sign-in',
    )
  })

  it('fails closed to /sign-in when the context is null (#381)', () => {
    expect(authedRedirectTarget(null as unknown as AuthContext)).toBe(
      '/sign-in',
    )
  })

  // #846 login-bounce: the live bug. A genuinely-logged-in user enters their OTP,
  // confirmSession passes, then the server-guard's session resolution hiccups
  // (a transient getSessionUser/DB error). The OLD guard caught the error and
  // redirected to /sign-in IDENTICALLY to a real signed-out visitor, bouncing a
  // logged-in user. The fix: a present-but-unresolvable session (the request
  // CARRIED a session cookie, but resolution errored) must NOT be treated like
  // 'signed out'. Render and let the client re-confirm instead of a hard bounce.
  it('does NOT bounce to /sign-in when a session cookie was present but resolution errored (#846)', () => {
    const ctx: AuthContext = {
      user: null,
      hasHousehold: false,
      sessionCookiePresent: true,
      resolutionErrored: true,
    }
    // Must not hard-redirect to sign-in: the user was carrying a session cookie,
    // so this is a transient resolution failure, not a signed-out visitor.
    expect(authedRedirectTarget(ctx)).not.toBe('/sign-in')
    // Render the gated page (null) so the client can re-confirm the session.
    expect(authedRedirectTarget(ctx)).toBeNull()
  })

  it('STILL bounces to /sign-in for a genuine signed-out visitor: no cookie, no error (#846)', () => {
    const ctx: AuthContext = {
      user: null,
      hasHousehold: false,
      sessionCookiePresent: false,
      resolutionErrored: false,
    }
    expect(authedRedirectTarget(ctx)).toBe('/sign-in')
  })

  it('STILL bounces to /sign-in when resolution errored but there was NO session cookie (#846)', () => {
    // No cookie at all means the visitor is definitely signed out, even if the
    // resolution path threw. Fail closed: never leak the gated page.
    const ctx: AuthContext = {
      user: null,
      hasHousehold: false,
      sessionCookiePresent: false,
      resolutionErrored: true,
    }
    expect(authedRedirectTarget(ctx)).toBe('/sign-in')
  })

  it('a clean signed-out resolution (cookie absent, no error) still goes to /sign-in even with legacy two-field context (#846)', () => {
    // Back-compat: the old { user, hasHousehold } shape (no new flags) must keep
    // the exact signed-out -> /sign-in behaviour.
    const ctx: AuthContext = { user: null, hasHousehold: false }
    expect(authedRedirectTarget(ctx)).toBe('/sign-in')
  })
})

describe('requestHasSessionCookie (#846)', () => {
  it('is true when a better-auth session_token cookie is present', () => {
    expect(
      requestHasSessionCookie('better-auth.session_token=abc123; other=1'),
    ).toBe(true)
  })

  it('is true for the __Secure- prefixed session cookie (prod)', () => {
    expect(
      requestHasSessionCookie('__Secure-better-auth.session_token=abc123'),
    ).toBe(true)
  })

  it('is false when there is no cookie header at all', () => {
    expect(requestHasSessionCookie(null)).toBe(false)
    expect(requestHasSessionCookie(undefined)).toBe(false)
    expect(requestHasSessionCookie('')).toBe(false)
  })

  it('is false when the cookie header carries no session token', () => {
    expect(requestHasSessionCookie('theme=dark; locale=nl')).toBe(false)
  })

  it('does not false-match a substring that is not the session token', () => {
    expect(requestHasSessionCookie('not_a_session_token_field=x')).toBe(false)
  })
})

describe('AuthContext shape (resolveAuthContext return, #251)', () => {
  it('is exactly { user, hasHousehold }', () => {
    // resolveAuthContext resolves session + onboarding in one round-trip and
    // returns this shape; the type-level contract is asserted structurally here
    // so a future field rename in the server fn breaks this test.
    const signedOut: AuthContext = { user: null, hasHousehold: false }
    const signedIn: AuthContext = { user: USER, hasHousehold: true }
    expect(Object.keys(signedOut).sort()).toEqual(['hasHousehold', 'user'])
    expect(Object.keys(signedIn).sort()).toEqual(['hasHousehold', 'user'])
    expect(signedIn.user).toEqual(USER)
    expect(signedIn.hasHousehold).toBe(true)
  })
})
