import { describe, it, expect } from 'vitest'
import { planFeedbackWrite, ratingToFeedbackRow } from './meal-feedback'

/**
 * The write that submitMealFeedback performs is decided purely by
 * planFeedbackWrite(existingId, row). Testing that pair here proves the server
 * fn writes the expected meal_feedback row for each case (first rating, re-rate,
 * clear) without standing up the Start server runtime / a live DB.
 */
describe('planFeedbackWrite — the row submitMealFeedback writes', () => {
  it('inserts a new row with the expected shape on first rating', () => {
    const row = ratingToFeedbackRow({
      recipeId: 'r1',
      mealPlanId: 'p1',
      rating: 'down',
      note: 'too spicy',
    })
    const action = planFeedbackWrite(null, row)
    expect(action).toEqual({
      kind: 'insert',
      row: {
        recipeId: 'r1',
        mealPlanId: 'p1',
        rating: 'down',
        note: 'too spicy',
      },
    })
  })

  it('updates the existing row when re-rating the same dinner (idempotent)', () => {
    const row = ratingToFeedbackRow({
      recipeId: 'r1',
      mealPlanId: 'p1',
      rating: 'up',
      note: null,
    })
    const action = planFeedbackWrite('mf-existing', row)
    expect(action).toEqual({
      kind: 'update',
      id: 'mf-existing',
      row: { recipeId: 'r1', mealPlanId: 'p1', rating: 'up', note: null },
    })
  })

  it('deletes the existing row when the rating is cleared', () => {
    const row = ratingToFeedbackRow({
      recipeId: 'r1',
      mealPlanId: 'p1',
      rating: null,
    })
    expect(planFeedbackWrite('mf-existing', row)).toEqual({
      kind: 'delete',
      id: 'mf-existing',
    })
  })

  it('does nothing when a cleared rating has no prior row', () => {
    const row = ratingToFeedbackRow({
      recipeId: 'r1',
      mealPlanId: 'p1',
      rating: null,
    })
    expect(planFeedbackWrite(null, row)).toEqual({ kind: 'noop' })
  })

  it('the inserted rating is the literal the recommender folds in', () => {
    const up = planFeedbackWrite(
      null,
      ratingToFeedbackRow({ recipeId: 'r', mealPlanId: 'p', rating: 'up' }),
    )
    expect(up.kind === 'insert' && up.row.rating).toBe('up')
  })
})
