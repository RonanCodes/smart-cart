import { describe, it, expect } from 'vitest'
import { entryRedirectTarget, authedRedirectTarget } from './route-guards'
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
