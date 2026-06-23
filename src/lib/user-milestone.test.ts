import { describe, it, expect } from 'vitest'
import { isUserCountMilestone } from './user-milestone'

// A milestone is a total user count >= 150 where (count - 150) is a multiple of
// 25: 150, 175, 200, 225, 250, ... Because signups increment the count by one,
// each milestone count happens exactly once, so the celebration fires once.

describe('isUserCountMilestone', () => {
  it('is true at 150 (the first milestone)', () => {
    expect(isUserCountMilestone(150)).toBe(true)
  })

  it('is true at every 25th count after 150', () => {
    expect(isUserCountMilestone(175)).toBe(true)
    expect(isUserCountMilestone(200)).toBe(true)
    expect(isUserCountMilestone(225)).toBe(true)
    expect(isUserCountMilestone(250)).toBe(true)
    expect(isUserCountMilestone(500)).toBe(true)
  })

  it('is false just below the first milestone', () => {
    expect(isUserCountMilestone(149)).toBe(false)
  })

  it('is false just above a milestone', () => {
    expect(isUserCountMilestone(151)).toBe(false)
    expect(isUserCountMilestone(160)).toBe(false)
  })

  it('is false below 150 even on a multiple of 25', () => {
    expect(isUserCountMilestone(100)).toBe(false)
    expect(isUserCountMilestone(125)).toBe(false)
  })

  it('is false for zero / negative / non-integer counts', () => {
    expect(isUserCountMilestone(0)).toBe(false)
    expect(isUserCountMilestone(-25)).toBe(false)
    expect(isUserCountMilestone(150.5)).toBe(false)
  })
})
