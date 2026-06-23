import { describe, it, expect } from 'vitest'
import { isUserCountMilestone } from './milestone'

// The milestone predicate that decides when admins get a celebration email.
// A milestone is 150, then every 25 after (175, 200, 225, ...). Because the
// user count climbs one at a time, a true result here fires exactly once.
describe('isUserCountMilestone', () => {
  it('is true at 150 and every 25 after', () => {
    expect(isUserCountMilestone(150)).toBe(true)
    expect(isUserCountMilestone(175)).toBe(true)
    expect(isUserCountMilestone(200)).toBe(true)
    expect(isUserCountMilestone(225)).toBe(true)
    expect(isUserCountMilestone(500)).toBe(true)
  })

  it('is false below 150 and for in-between counts', () => {
    expect(isUserCountMilestone(149)).toBe(false)
    expect(isUserCountMilestone(151)).toBe(false)
    expect(isUserCountMilestone(160)).toBe(false)
    expect(isUserCountMilestone(100)).toBe(false)
    expect(isUserCountMilestone(125)).toBe(false)
  })
})
