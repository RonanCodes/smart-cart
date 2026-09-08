import { describe, expect, it } from 'vitest'
import { maskPhone, normalisePhone, pickRandomIndex } from './demo-phone'

describe('normalisePhone', () => {
  it('keeps an international number with a +', () => {
    expect(normalisePhone('+31 6 1234 5689')).toBe('+31612345689')
  })

  it('turns a Dutch local 06 mobile into +316…', () => {
    expect(normalisePhone('06 12 34 56 89')).toBe('+31612345689')
    expect(normalisePhone('0612345689')).toBe('+31612345689')
  })

  it('adds + to a country-code number typed without it', () => {
    expect(normalisePhone('31612345689')).toBe('+31612345689')
    expect(normalisePhone('1 415 555 0123')).toBe('+14155550123')
  })

  it('strips punctuation and spaces', () => {
    expect(normalisePhone('+31-(6)-12.34.56.89')).toBe('+31612345689')
  })

  it('rejects empty / too-short input', () => {
    expect(normalisePhone('')).toBeNull()
    expect(normalisePhone('   ')).toBeNull()
    expect(normalisePhone('12345')).toBeNull()
  })
})

describe('maskPhone', () => {
  it('reveals only the last two digits', () => {
    expect(maskPhone('+31612345689')).toBe('•••• ••89')
  })

  it('handles short numbers without leaking', () => {
    expect(maskPhone('+12')).toBe('•••• ••12')
    expect(maskPhone('+7')).toBe('•••• •••7')
  })
})

describe('pickRandomIndex', () => {
  it('returns -1 for an empty list', () => {
    expect(pickRandomIndex(0)).toBe(-1)
    expect(pickRandomIndex(-3)).toBe(-1)
  })

  it('returns 0 for a single entrant', () => {
    expect(pickRandomIndex(1)).toBe(0)
  })

  it('always returns an in-range index', () => {
    for (let i = 0; i < 500; i++) {
      const idx = pickRandomIndex(7)
      expect(idx).toBeGreaterThanOrEqual(0)
      expect(idx).toBeLessThan(7)
    }
  })

  it('covers the whole range over many draws', () => {
    const seen = new Set<number>()
    for (let i = 0; i < 2000; i++) seen.add(pickRandomIndex(5))
    expect(seen).toEqual(new Set([0, 1, 2, 3, 4]))
  })
})
