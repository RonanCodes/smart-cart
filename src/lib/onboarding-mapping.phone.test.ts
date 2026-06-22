import { describe, it, expect } from 'vitest'
import { normalisePhone } from './onboarding-mapping'

describe('normalisePhone', () => {
  it('returns null for empty, whitespace, or too-short input', () => {
    expect(normalisePhone(null)).toBeNull()
    expect(normalisePhone(undefined)).toBeNull()
    expect(normalisePhone('')).toBeNull()
    expect(normalisePhone('   ')).toBeNull()
    expect(normalisePhone('123')).toBeNull()
  })

  it('keeps a plausible number, trimmed (international formats allowed)', () => {
    expect(normalisePhone('  +31 6 12345678 ')).toBe('+31 6 12345678')
    expect(normalisePhone('0612345678')).toBe('0612345678')
    expect(normalisePhone('(020) 123 4567')).toBe('(020) 123 4567')
  })
})
