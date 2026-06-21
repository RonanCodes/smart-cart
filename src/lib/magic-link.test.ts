import { describe, it, expect } from 'vitest'
import {
  magicLinkRedirectTarget,
  readMagicLinkMetadata,
  ONBOARDED_DESTINATION,
  NEW_USER_DESTINATION,
} from './magic-link'

describe('magicLinkRedirectTarget', () => {
  it('sends an onboarded user (has household) to /week', () => {
    expect(magicLinkRedirectTarget({ hasHousehold: true })).toBe('/week')
    expect(magicLinkRedirectTarget({ hasHousehold: true })).toBe(
      ONBOARDED_DESTINATION,
    )
  })

  it('sends a new user (no household) to /onboarding', () => {
    expect(magicLinkRedirectTarget({ hasHousehold: false })).toBe('/onboarding')
    expect(magicLinkRedirectTarget({ hasHousehold: false })).toBe(
      NEW_USER_DESTINATION,
    )
  })

  it('never lands an onboarded user on the old /app IA (#273)', () => {
    expect(magicLinkRedirectTarget({ hasHousehold: true })).not.toBe('/app')
  })
})

describe('readMagicLinkMetadata', () => {
  it('reads the otp flow with its code', () => {
    expect(readMagicLinkMetadata({ flow: 'otp', otp: '123456' })).toEqual({
      flow: 'otp',
      otp: '123456',
    })
  })

  it('reads the approval flow', () => {
    expect(readMagicLinkMetadata({ flow: 'approval' })).toEqual({
      flow: 'approval',
    })
  })

  it('drops a non-string otp', () => {
    expect(readMagicLinkMetadata({ flow: 'otp', otp: 123456 })).toEqual({
      flow: 'otp',
      otp: undefined,
    })
  })

  it('defaults to approval for missing or malformed metadata', () => {
    expect(readMagicLinkMetadata(undefined)).toEqual({ flow: 'approval' })
    expect(readMagicLinkMetadata(null)).toEqual({ flow: 'approval' })
    expect(readMagicLinkMetadata('nope')).toEqual({ flow: 'approval' })
    expect(readMagicLinkMetadata({ other: 1 })).toEqual({ flow: 'approval' })
  })
})
