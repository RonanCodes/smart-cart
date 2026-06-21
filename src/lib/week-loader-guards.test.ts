import { describe, it, expect } from 'vitest'
import { isWeekView, missingCount, weekDays } from './week-loader-guards'
import type { WeekView } from './week-server'

/**
 * Regression tests for the /week crashes that all share one root: the loader /
 * render path read deeply into a server-fn result that resolved to `undefined`
 * (a prod 500), throwing `t.week` / `t.days` (#380) and `.missing` (#384) into
 * the React error boundary on mobile. The fix coerces a malformed result into a
 * safe shape; these lock that behaviour.
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
      imageUrl: null,
      videoUrl: null,
      alternatives: [],
    },
  ],
}

describe('isWeekView (#380 t.week / t.days guard)', () => {
  it('accepts a real week view', () => {
    expect(isWeekView(WEEK)).toBe(true)
  })

  it('rejects undefined (the prod-500 failure mode that crashed on t.week)', () => {
    expect(isWeekView(undefined)).toBe(false)
  })

  it('rejects null', () => {
    expect(isWeekView(null)).toBe(false)
  })

  it('rejects a partial week with no days array (would crash on t.days)', () => {
    expect(isWeekView({ planId: 'p1' })).toBe(false)
  })

  it('rejects a 500-ish envelope with no planId', () => {
    expect(isWeekView({ ok: false, error: 'boom' })).toBe(false)
  })
})

describe('missingCount (#384 .missing guard)', () => {
  it('reads a real count', () => {
    expect(missingCount({ missing: 3 })).toBe(3)
  })

  it('returns 0 for undefined (the loader crash: undefined.missing)', () => {
    expect(missingCount(undefined)).toBe(0)
  })

  it('returns 0 for null', () => {
    expect(missingCount(null)).toBe(0)
  })

  it('returns 0 when .missing is missing or not a number', () => {
    expect(missingCount({})).toBe(0)
    expect(missingCount({ missing: 'lots' })).toBe(0)
    expect(missingCount({ missing: NaN })).toBe(0)
  })

  it('clamps a negative count to 0', () => {
    expect(missingCount({ missing: -2 })).toBe(0)
  })

  it('truncates a fractional count', () => {
    expect(missingCount({ missing: 3.9 })).toBe(3)
  })
})

describe('weekDays (#380 render-path days guard)', () => {
  it('returns the days of a real week', () => {
    expect(weekDays(WEEK)).toHaveLength(1)
  })

  it('returns [] for null / undefined instead of throwing', () => {
    expect(weekDays(null)).toEqual([])
    expect(weekDays(undefined)).toEqual([])
  })

  it('returns [] when days is not an array', () => {
    expect(weekDays({ planId: 'p1' } as unknown as WeekView)).toEqual([])
  })
})
