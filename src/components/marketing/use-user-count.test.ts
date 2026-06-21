import { describe, it, expect } from 'vitest'
import { easeOutCubic, countUpValue } from './use-user-count'

describe('easeOutCubic', () => {
  it('anchors at 0 and 1 and clamps out-of-range input', () => {
    expect(easeOutCubic(0)).toBe(0)
    expect(easeOutCubic(1)).toBe(1)
    expect(easeOutCubic(-5)).toBe(0)
    expect(easeOutCubic(5)).toBe(1)
  })
  it('eases out (past the midpoint by t=0.5)', () => {
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5)
  })
})

describe('countUpValue', () => {
  it('returns the start at t=0 and the target at t=1', () => {
    expect(countUpValue(40, 50, 0)).toBe(40)
    expect(countUpValue(40, 50, 1)).toBe(50)
  })
  it('is an integer mid-animation, between from and to', () => {
    const v = countUpValue(40, 50, 0.5)
    expect(Number.isInteger(v)).toBe(true)
    expect(v).toBeGreaterThanOrEqual(40)
    expect(v).toBeLessThanOrEqual(50)
  })
  it('counts up by one cleanly (the common signup case)', () => {
    expect(countUpValue(88, 89, 0)).toBe(88)
    expect(countUpValue(88, 89, 1)).toBe(89)
  })
})
