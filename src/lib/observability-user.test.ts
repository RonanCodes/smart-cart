import { describe, it, expect } from 'vitest'
import { toObservabilityUser } from './observability-user'

describe('toObservabilityUser', () => {
  it('returns null for a signed-out request (null)', () => {
    expect(toObservabilityUser(null)).toBeNull()
  })

  it('returns null for a signed-out request (undefined)', () => {
    expect(toObservabilityUser(undefined)).toBeNull()
  })

  it('maps a real user to { id, email }', () => {
    expect(
      toObservabilityUser({ id: 'usr_123', email: 'ada@example.com' }),
    ).toEqual({ id: 'usr_123', email: 'ada@example.com' })
  })

  it('includes the dev synthetic user', () => {
    expect(
      toObservabilityUser({ id: 'dev-user', email: 'dev@souso.local' }),
    ).toEqual({ id: 'dev-user', email: 'dev@souso.local' })
  })

  it('trims whitespace on id and email', () => {
    expect(toObservabilityUser({ id: '  usr_1 ', email: ' a@b.co ' })).toEqual({
      id: 'usr_1',
      email: 'a@b.co',
    })
  })

  it('keeps a user with email but no id (email-only is still useful)', () => {
    expect(toObservabilityUser({ email: 'a@b.co' })).toEqual({
      id: '',
      email: 'a@b.co',
    })
  })

  it('keeps a user with id but no email', () => {
    expect(toObservabilityUser({ id: 'usr_1' })).toEqual({
      id: 'usr_1',
      email: '',
    })
  })

  it('returns null when neither id nor email is usable', () => {
    expect(toObservabilityUser({ id: '', email: '' })).toBeNull()
    expect(toObservabilityUser({ id: '   ', email: null })).toBeNull()
    expect(toObservabilityUser({})).toBeNull()
  })
})
