import { describe, it, expect } from 'vitest'
import { inferSkipDays, resolveSkipDays, skipDaysToOverride } from './skip-days'
import type { PlannedDay } from './types'

/**
 * Build a 7-day plan (Monday-first) where the weekday indices in `skipIdx` are
 * skipped (empty recipeRef) and the rest are home dinners.
 */
function plan(skipIdx: Array<number>): Array<PlannedDay> {
  const days = [
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
    'Sunday',
  ]
  return days.map((day, i) =>
    skipIdx.includes(i)
      ? { day, meal: '', recipeRef: '', type: 'out' as const }
      : { day, meal: `Dish ${i}`, recipeRef: `r${i}`, type: 'home' as const },
  )
}

describe('inferSkipDays (majority skip-day learning)', () => {
  it('infers nothing with too little history (< minPlans)', () => {
    expect(inferSkipDays([plan([4])])).toEqual(new Set())
    expect(inferSkipDays([])).toEqual(new Set())
  })

  it('marks a weekday skipped when a strict majority of recent plans skip it', () => {
    // Friday (idx 4) skipped in 3 of 4 plans -> majority.
    const plans = [plan([4]), plan([4]), plan([4]), plan([])]
    expect(inferSkipDays(plans)).toEqual(new Set([4]))
  })

  it('does NOT mark a weekday skipped on an exact half (not a strict majority)', () => {
    // Friday skipped in 2 of 4 -> 2*2 = 4, not > 4, so not a majority.
    const plans = [plan([4]), plan([4]), plan([]), plan([])]
    expect(inferSkipDays(plans)).toEqual(new Set())
  })

  it('infers multiple skipped weekdays independently', () => {
    // Friday (4) skipped in all 3; Saturday (5) skipped in 2 of 3 -> both.
    const plans = [plan([4, 5]), plan([4, 5]), plan([4])]
    expect(inferSkipDays(plans)).toEqual(new Set([4, 5]))
  })

  it('treats an empty recipeRef as skipped even without an out type', () => {
    const cleared: Array<PlannedDay> = plan([]).map((d, i) =>
      i === 2 ? { ...d, recipeRef: '', meal: '' } : d,
    )
    const plans = [cleared, cleared, plan([])]
    expect(inferSkipDays(plans)).toEqual(new Set([2]))
  })

  it('honours the lookback window (older plans beyond it are ignored)', () => {
    // Newest 2 plans never skip Friday; older 3 always do. lookback 2 -> none.
    const plans = [plan([]), plan([]), plan([4]), plan([4]), plan([4])]
    expect(inferSkipDays(plans, { lookback: 2 })).toEqual(new Set())
  })

  it('counts only plans that cover a weekday (short plans do not dilute)', () => {
    const short: Array<PlannedDay> = plan([]).slice(0, 5) // no Sat/Sun
    // Sunday (6) is only covered by the two full plans, both skip it -> majority.
    const plans = [short, plan([6]), plan([6])]
    expect(inferSkipDays(plans)).toEqual(new Set([6]))
  })
})

describe('skipDaysToOverride', () => {
  it('returns undefined when nothing is skipped (strict no-op)', () => {
    expect(skipDaysToOverride(new Set())).toBeUndefined()
  })

  it('maps skipped indices to out and leaves the rest as holes', () => {
    const override = skipDaysToOverride(new Set([4]))
    expect(override).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      'out',
      undefined,
      undefined,
    ])
  })
})

describe('resolveSkipDays (manual override wins, auto is fallback)', () => {
  it('falls back to the inferred set when there is no manual override', () => {
    expect(resolveSkipDays(null, new Set([4]))).toEqual(new Set([4]))
    expect(resolveSkipDays(undefined, new Set([2, 5]))).toEqual(new Set([2, 5]))
  })

  it('uses the manual override verbatim when set, ignoring the inference', () => {
    expect(resolveSkipDays([0, 1], new Set([4]))).toEqual(new Set([0, 1]))
  })

  it('honours an EMPTY manual override as "skip no days" (suppresses inference)', () => {
    expect(resolveSkipDays([], new Set([4, 5]))).toEqual(new Set())
  })

  it('drops out-of-range indices from the manual override', () => {
    expect(resolveSkipDays([4, 9, -1, 2.5], new Set())).toEqual(new Set([4]))
  })

  it('is a strict no-op for a fresh household (no override + no inference)', () => {
    expect(resolveSkipDays(null, new Set())).toEqual(new Set())
  })
})
