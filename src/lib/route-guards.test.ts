import { describe, it, expect } from 'vitest'
import { entryRedirectTarget } from './route-guards'

describe('entryRedirectTarget', () => {
  it('renders the Landing for a signed-out visitor (no redirect)', () => {
    expect(
      entryRedirectTarget({ signedIn: false, onboarded: false }),
    ).toBeNull()
  })

  it('ignores onboarded flag when signed out', () => {
    expect(entryRedirectTarget({ signedIn: false, onboarded: true })).toBeNull()
  })

  it('sends a signed-in + onboarded user to /app', () => {
    expect(entryRedirectTarget({ signedIn: true, onboarded: true })).toBe(
      '/app',
    )
  })

  it('sends a signed-in + NOT-onboarded user to /onboarding', () => {
    expect(entryRedirectTarget({ signedIn: true, onboarded: false })).toBe(
      '/onboarding',
    )
  })
})
