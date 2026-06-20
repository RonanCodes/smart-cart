import { describe, it, expect, vi } from 'vitest'
import { planFeedbackWrite, ratingToFeedbackRow } from './meal-feedback'
import {
  applyFeedbackWrite,
  mapFeedbackRows,
  ratingFromColumn,
  ratingToColumn,
} from './meal-feedback-server'

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

  it('inserts a note-only row (no thumb): a note alone is feedback', () => {
    const row = ratingToFeedbackRow({
      recipeId: 'r1',
      mealPlanId: 'p1',
      rating: null,
      note: 'not pizza every week',
    })
    expect(planFeedbackWrite(null, row)).toEqual({
      kind: 'insert',
      row: {
        recipeId: 'r1',
        mealPlanId: 'p1',
        rating: null,
        note: 'not pizza every week',
      },
    })
  })
})

describe('rating column translation (note-only sentinel)', () => {
  it('stores a thumb as its literal and a note-only row as empty string', () => {
    expect(ratingToColumn('up')).toBe('up')
    expect(ratingToColumn('down')).toBe('down')
    // A note-only row has no thumb -> empty string in the NOT NULL column.
    expect(ratingToColumn(null)).toBe('')
  })

  it('reads a thumb back and treats the empty sentinel as no thumb', () => {
    expect(ratingFromColumn('up')).toBe('up')
    expect(ratingFromColumn('down')).toBe('down')
    expect(ratingFromColumn('')).toBeNull()
    expect(ratingFromColumn(null)).toBeNull()
  })
})

describe('applyFeedbackWrite — the real meal_feedback write (mock db)', () => {
  // Minimal chainable mock of the drizzle db, capturing what each verb received.
  function mockDb() {
    const insertValues = vi.fn().mockResolvedValue(undefined)
    const insert = vi.fn().mockReturnValue({ values: insertValues })

    const updateWhere = vi.fn().mockResolvedValue(undefined)
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere })
    const update = vi.fn().mockReturnValue({ set: updateSet })

    const deleteWhere = vi.fn().mockResolvedValue(undefined)
    const del = vi.fn().mockReturnValue({ where: deleteWhere })

    return {
      db: { insert, update, delete: del } as never,
      insert,
      insertValues,
      update,
      updateSet,
      del,
      deleteWhere,
    }
  }

  const table = { id: 'col-id' } as never
  const eq = (a: unknown, b: unknown) => ({ a, b })

  it('submitting a note writes it to meal_feedback (insert with a thumb)', async () => {
    const m = mockDb()
    const row = ratingToFeedbackRow({
      recipeId: 'r1',
      mealPlanId: 'p1',
      rating: 'up',
      note: 'loved it',
    })
    await applyFeedbackWrite({
      db: m.db,
      table,
      eq,
      householdId: 'hh1',
      action: planFeedbackWrite(null, row),
      now: new Date(0),
    })
    expect(m.insert).toHaveBeenCalledOnce()
    const written = m.insertValues.mock.calls[0]![0]
    expect(written.note).toBe('loved it')
    expect(written.rating).toBe('up')
    expect(written.recipeId).toBe('r1')
    expect(written.householdId).toBe('hh1')
  })

  it('a note-only submit persists the note with an empty rating sentinel', async () => {
    const m = mockDb()
    const row = ratingToFeedbackRow({
      recipeId: 'r2',
      mealPlanId: 'p1',
      rating: null,
      note: 'too much garlic',
    })
    await applyFeedbackWrite({
      db: m.db,
      table,
      eq,
      householdId: 'hh1',
      action: planFeedbackWrite(null, row),
      now: new Date(0),
    })
    expect(m.insert).toHaveBeenCalledOnce()
    const written = m.insertValues.mock.calls[0]![0]
    expect(written.note).toBe('too much garlic')
    // No thumb -> the NOT NULL column gets the empty-string sentinel.
    expect(written.rating).toBe('')
  })

  it('updating just the note updates the existing row in place', async () => {
    const m = mockDb()
    const row = ratingToFeedbackRow({
      recipeId: 'r3',
      mealPlanId: 'p1',
      rating: null,
      note: 'edited note',
    })
    await applyFeedbackWrite({
      db: m.db,
      table,
      eq,
      householdId: 'hh1',
      action: planFeedbackWrite('mf-existing', row),
      now: new Date(0),
    })
    expect(m.insert).not.toHaveBeenCalled()
    expect(m.update).toHaveBeenCalledOnce()
    const set = m.updateSet.mock.calls[0]![0]
    expect(set.note).toBe('edited note')
    expect(set.rating).toBe('')
  })

  it('emptying both thumb and note deletes the row (no stale signal)', async () => {
    const m = mockDb()
    const row = ratingToFeedbackRow({
      recipeId: 'r4',
      mealPlanId: 'p1',
      rating: null,
      note: '  ',
    })
    await applyFeedbackWrite({
      db: m.db,
      table,
      eq,
      householdId: 'hh1',
      action: planFeedbackWrite('mf-existing', row),
    })
    expect(m.del).toHaveBeenCalledOnce()
    expect(m.insert).not.toHaveBeenCalled()
    expect(m.update).not.toHaveBeenCalled()
  })
})

describe('mapFeedbackRows — rehydrate on reload', () => {
  it('returns a saved note-only row so it shows again on reload', () => {
    const states = mapFeedbackRows([
      { recipeId: 'r1', rating: '', note: 'not pizza every week' },
      { recipeId: 'r2', rating: 'down', note: 'too spicy' },
    ])
    expect(states).toEqual([
      { recipeId: 'r1', rating: null, note: 'not pizza every week' },
      { recipeId: 'r2', rating: 'down', note: 'too spicy' },
    ])
  })

  it('drops rows with no recipe id', () => {
    const states = mapFeedbackRows([
      { recipeId: '', rating: 'up', note: null },
      { recipeId: 'r1', rating: 'up', note: null },
    ])
    expect(states).toEqual([{ recipeId: 'r1', rating: 'up', note: null }])
  })
})
