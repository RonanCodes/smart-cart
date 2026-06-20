import { describe, it, expect } from 'vitest'
import {
  normalizeCookDays,
  clampHouseholdCount,
  ALL_DAYS,
} from './onboarding-rhythm'

describe('normalizeCookDays', () => {
  it('sorts and dedupes a valid selection', () => {
    expect(normalizeCookDays([4, 0, 1, 4, 3])).toEqual([0, 1, 3, 4])
  })

  it('defaults an empty selection to all 7 days', () => {
    expect(normalizeCookDays([])).toEqual([...ALL_DAYS])
  })

  it('drops out-of-range and non-integer values', () => {
    expect(normalizeCookDays([-1, 7, 2.5, 3, 99])).toEqual([3])
  })

  it('returns all 7 when every value is invalid', () => {
    expect(normalizeCookDays([-1, 7, 8])).toEqual([...ALL_DAYS])
  })

  it('keeps a typical Mon/Tue/Thu/Fri/Sun pattern', () => {
    // Mon=0, Tue=1, Thu=3, Fri=4, Sun=6
    expect(normalizeCookDays([0, 1, 3, 4, 6])).toEqual([0, 1, 3, 4, 6])
  })
})

describe('clampHouseholdCount', () => {
  it('floors adults at the given minimum', () => {
    expect(clampHouseholdCount(0, 1)).toBe(1)
    expect(clampHouseholdCount(-3, 1)).toBe(1)
  })

  it('allows children to be zero', () => {
    expect(clampHouseholdCount(0, 0)).toBe(0)
  })

  it('rounds fractional input', () => {
    expect(clampHouseholdCount(2.4, 0)).toBe(2)
    expect(clampHouseholdCount(2.6, 0)).toBe(3)
  })

  it('caps at the max', () => {
    expect(clampHouseholdCount(50, 1, 12)).toBe(12)
  })

  it('falls back to min for non-finite input', () => {
    expect(clampHouseholdCount(Number.NaN, 1)).toBe(1)
  })
})
