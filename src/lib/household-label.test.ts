import { describe, it, expect } from 'vitest'
import { householdPortionsLabel } from './household-label'

/**
 * #373 — the week card hard-coded "🍽 2" for every household, which a tester read
 * as "this only feeds 2 people total" even though their household was 2 adults +
 * kids. The label must be DERIVED from the stored household (adults + children),
 * and must read as "who this cooks for", never as a bare ambiguous "2".
 */
describe('householdPortionsLabel', () => {
  it('reads as adults for an adults-only household, not a bare number', () => {
    expect(householdPortionsLabel({ adults: 2, children: 0 })).toBe('2 adults')
  })

  it('singular adult', () => {
    expect(householdPortionsLabel({ adults: 1, children: 0 })).toBe('1 adult')
  })

  it('shows adults + children when there are kids (the #373 repro)', () => {
    // The whole point: 2 adults + 2 kids must NOT collapse to "2".
    expect(householdPortionsLabel({ adults: 2, children: 2 })).toBe(
      '2 adults + 2 kids',
    )
  })

  it('singular child', () => {
    expect(householdPortionsLabel({ adults: 2, children: 1 })).toBe(
      '2 adults + 1 kid',
    )
  })

  it('clamps negatives and defaults missing children to 0', () => {
    expect(householdPortionsLabel({ adults: -3 })).toBe('1 adult')
    expect(householdPortionsLabel({ adults: 2, children: -1 })).toBe('2 adults')
  })

  it('floors a zero-adult household to at least one cook', () => {
    expect(householdPortionsLabel({ adults: 0, children: 3 })).toBe(
      '1 adult + 3 kids',
    )
  })
})
