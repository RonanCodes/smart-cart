import { describe, it, expect } from 'vitest'
import { normaliseNote, ratingToFeedbackRow } from './meal-feedback'

describe('normaliseNote', () => {
  it('returns null for null/undefined', () => {
    expect(normaliseNote(null)).toBeNull()
    expect(normaliseNote(undefined)).toBeNull()
  })

  it('trims and keeps a real note', () => {
    expect(normaliseNote('  not pizza every week  ')).toBe(
      'not pizza every week',
    )
  })

  it('treats a whitespace-only note as null', () => {
    expect(normaliseNote('   ')).toBeNull()
    expect(normaliseNote('')).toBeNull()
  })
})

describe('ratingToFeedbackRow', () => {
  it('maps a thumbs up to the row shape with the recsys literal', () => {
    const row = ratingToFeedbackRow({
      recipeId: 'r1',
      mealPlanId: 'p1',
      rating: 'up',
      note: 'loved it',
    })
    expect(row).toEqual({
      recipeId: 'r1',
      mealPlanId: 'p1',
      rating: 'up',
      note: 'loved it',
    })
  })

  it('maps a thumbs down and normalises a blank note to null', () => {
    const row = ratingToFeedbackRow({
      recipeId: 'r2',
      mealPlanId: 'p1',
      rating: 'down',
      note: '   ',
    })
    expect(row).toEqual({
      recipeId: 'r2',
      mealPlanId: 'p1',
      rating: 'down',
      note: null,
    })
  })

  it('returns null for a cleared rating (no row to write)', () => {
    expect(
      ratingToFeedbackRow({ recipeId: 'r3', mealPlanId: 'p1', rating: null }),
    ).toBeNull()
  })

  it('returns null for an unknown rating value', () => {
    expect(
      ratingToFeedbackRow({
        recipeId: 'r4',
        mealPlanId: 'p1',
        // @ts-expect-error guarding the runtime against a bad value
        rating: 'meh',
      }),
    ).toBeNull()
  })

  it('rating is exactly the literal recsys folds in', () => {
    // recsys/feedback-fold mealFeedbackToSwipe only reacts to 'up' | 'down'.
    const up = ratingToFeedbackRow({
      recipeId: 'r5',
      mealPlanId: 'p1',
      rating: 'up',
    })
    const down = ratingToFeedbackRow({
      recipeId: 'r6',
      mealPlanId: 'p1',
      rating: 'down',
    })
    expect(up?.rating).toBe('up')
    expect(down?.rating).toBe('down')
  })
})
