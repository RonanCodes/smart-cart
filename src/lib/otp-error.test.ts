import { describe, it, expect } from 'vitest'
import { mapVerifyError, isExpectedOtpError } from './otp-error'

// #387: a WRONG OTP (Better Auth INVALID_OTP, HTTP 400) is expected user
// behaviour, NOT a Sentry exception. `isExpectedOtpError` is the gate the auth
// handlers use to choose log.warn (breadcrumb) over log.error (Sentry capture).

describe('mapVerifyError', () => {
  it('maps INVALID_OTP / 400 to invalid', () => {
    expect(
      mapVerifyError({
        code: 'INVALID_OTP',
        status: 400,
        message: 'Invalid OTP',
      }),
    ).toBe('invalid')
  })
  it('maps OTP_EXPIRED to expired', () => {
    expect(mapVerifyError({ code: 'OTP_EXPIRED' })).toBe('expired')
  })
  it('maps 403 / too many to rate_limited', () => {
    expect(mapVerifyError({ status: 403 })).toBe('rate_limited')
    expect(mapVerifyError({ message: 'Too many requests' })).toBe(
      'rate_limited',
    )
  })
  it('falls back to unknown for an unexpected failure', () => {
    expect(mapVerifyError({ status: 500, message: 'boom' })).toBe('unknown')
  })
})

describe('isExpectedOtpError — the Sentry-noise gate (#387)', () => {
  it('treats a wrong OTP (INVALID_OTP 400) as EXPECTED (not a Sentry exception)', () => {
    expect(
      isExpectedOtpError({
        code: 'INVALID_OTP',
        status: 400,
        message: 'Invalid OTP',
      }),
    ).toBe(true)
  })

  it('treats an expired OTP as expected', () => {
    expect(isExpectedOtpError({ code: 'OTP_EXPIRED', status: 400 })).toBe(true)
  })

  it('treats a rate-limited verify (403) as expected', () => {
    expect(
      isExpectedOtpError({ status: 403, message: 'Too many requests' }),
    ).toBe(true)
  })

  it('treats a 5xx server failure as UNEXPECTED (stays a Sentry exception)', () => {
    expect(isExpectedOtpError({ status: 500, message: 'Internal error' })).toBe(
      false,
    )
  })

  it('treats an unknown failure with no status as unexpected', () => {
    expect(isExpectedOtpError({ message: 'network down' })).toBe(false)
    expect(isExpectedOtpError(new Error('TypeError: fetch failed'))).toBe(false)
  })

  it('treats any other 4xx client error as expected (no Sentry)', () => {
    expect(isExpectedOtpError({ status: 422, message: 'Unprocessable' })).toBe(
      true,
    )
  })
})
