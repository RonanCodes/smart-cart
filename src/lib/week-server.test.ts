import { describe, it, expect } from 'vitest'
import { composeWeekBootstrap, shouldGenerateForOffset } from './week-server'
import type { WeekView } from './week-server'
import type { MealFeedbackState } from './meal-feedback-server'

/**
 * The /week loader was a 3-call client Promise.all (loadWeek + listMealFeedback +
 * countMissingFromWeek). #251 batches that into ONE server round-trip via
 * loadWeekBootstrap, which composes the same three reads server-side. The DB /
 * session chain inside those reads is unchanged and not re-tested here; what we
 * assert is the pure reshape glue: the batched payload is byte-for-byte the shape
 * the old 3-call loader returned, so swapping it in is behaviour-neutral.
 */

const WEEK: WeekView = {
  planId: 'plan-1',
  weekStart: '2026-06-15',
  days: [
    {
      day: 'Monday',
      meal: 'Pasta',
      recipeRef: 'r1',
      cuisine: 'italian',
      prepMinutes: 20,
      calories: 500,
      protein: 18,
      imageUrl: 'https://img/r1.jpg',
      videoUrl: null,
      alternatives: [],
    },
  ],
}

const FEEDBACK: Array<MealFeedbackState> = [
  { recipeId: 'r1', rating: 'up', note: 'loved it' },
]

describe('composeWeekBootstrap (#251 batched /week loader shape)', () => {
  it('returns exactly { week, feedback, missingFromList }', () => {
    const out = composeWeekBootstrap(WEEK, FEEDBACK, { missing: 3 })
    expect(Object.keys(out).sort()).toEqual([
      'feedback',
      'missingFromList',
      'week',
    ])
  })

  it('matches the old 3-call loader payload byte-for-byte', () => {
    // What the old loader returned:
    //   const [week, feedback, missing] = await Promise.all([...])
    //   return { week, feedback, missingFromList: missing.missing }
    const week = WEEK
    const feedback = FEEDBACK
    const missing = { missing: 3 }
    const oldShape = {
      week,
      feedback,
      missingFromList: missing.missing,
    }
    expect(composeWeekBootstrap(week, feedback, missing)).toEqual(oldShape)
  })

  it('passes the week and feedback arrays through unchanged (same references)', () => {
    const out = composeWeekBootstrap(WEEK, FEEDBACK, { missing: 0 })
    expect(out.week).toBe(WEEK)
    expect(out.feedback).toBe(FEEDBACK)
  })

  it('unwraps missing.missing into the flat missingFromList number', () => {
    expect(composeWeekBootstrap(WEEK, [], { missing: 0 }).missingFromList).toBe(
      0,
    )
    expect(composeWeekBootstrap(WEEK, [], { missing: 7 }).missingFromList).toBe(
      7,
    )
  })

  it('preserves an empty feedback list', () => {
    const out = composeWeekBootstrap(WEEK, [], { missing: 1 })
    expect(out.feedback).toEqual([])
  })
})

describe('shouldGenerateForOffset (#week-control: never auto-generate)', () => {
  it('never auto-generates any week — the user builds explicitly', () => {
    // #week-control: /week shows the empty state with a "Build my week" CTA
    // instead of auto-generating, so clearing the week / a "Start fresh" reset
    // sticks. Onboarding builds the first week explicitly (completeOnboarding).
    expect(shouldGenerateForOffset(0)).toBe(false)
    expect(shouldGenerateForOffset(1)).toBe(false)
    expect(shouldGenerateForOffset(-1)).toBe(false)
    expect(shouldGenerateForOffset(0.9)).toBe(false)
  })
})
