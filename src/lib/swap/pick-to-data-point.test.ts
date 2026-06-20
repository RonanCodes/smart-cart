import { describe, it, expect, vi } from 'vitest'
import {
  pickToSwipeRows,
  recordPickDataPoint,
  SWAP_SWIPE_ROUND,
} from './pick-to-data-point'
import type { PickSwipeRow, SwipeStore } from './pick-to-data-point'

describe('pickToSwipeRows', () => {
  it('maps a pick to a single LIKE row for the chosen recipe', () => {
    const rows = pickToSwipeRows({
      householdId: 'hh-1',
      chosenRecipeId: 'r-curry',
    })
    expect(rows).toEqual([
      {
        householdId: 'hh-1',
        recipeId: 'r-curry',
        direction: 'like',
        round: SWAP_SWIPE_ROUND,
      },
    ])
  })

  it('stamps the swap round marker, distinct from onboarding (0)', () => {
    const [row] = pickToSwipeRows({ householdId: 'hh', chosenRecipeId: 'r' })
    expect(row!.round).toBe(SWAP_SWIPE_ROUND)
    expect(row!.round).not.toBe(0)
  })

  it('emits nothing when the chosen recipe or household is missing', () => {
    expect(pickToSwipeRows({ householdId: '', chosenRecipeId: 'r' })).toEqual(
      [],
    )
    expect(pickToSwipeRows({ householdId: 'hh', chosenRecipeId: '' })).toEqual(
      [],
    )
  })

  it('never emits a dislike (no implicit soft-negative for the swapped-away meal)', () => {
    const rows = pickToSwipeRows({ householdId: 'hh', chosenRecipeId: 'r' })
    const directions = rows.map((r) => r.direction as string)
    expect(directions).not.toContain('dislike')
  })
})

/** A mock SwipeStore that records inserts and answers existence from a seed set. */
function mockStore(seed: Array<PickSwipeRow> = []) {
  const inserts: Array<PickSwipeRow & { id: string }> = []
  const seenKey = (r: {
    householdId: string
    recipeId: string
    direction: string
  }) => `${r.householdId}|${r.recipeId}|${r.direction}`
  const seeded = new Set(seed.map(seenKey))
  const store: SwipeStore = {
    hasSwipe: vi.fn(async (r) => seeded.has(seenKey(r))),
    insertSwipe: vi.fn(async (r) => {
      inserts.push(r)
    }),
  }
  return { store, inserts }
}

describe('recordPickDataPoint', () => {
  it('writes the expected recipe_swipe LIKE row for a fresh pick', async () => {
    const { store, inserts } = mockStore()
    let n = 0
    const res = await recordPickDataPoint(
      store,
      { householdId: 'hh-1', chosenRecipeId: 'r-curry' },
      () => `id-${++n}`,
    )

    expect(res).toEqual({ inserted: 1, skipped: 0 })
    expect(inserts).toEqual([
      {
        id: 'id-1',
        householdId: 'hh-1',
        recipeId: 'r-curry',
        direction: 'like',
        round: SWAP_SWIPE_ROUND,
      },
    ])
  })

  it('is idempotent: skips the write when a like already exists for the recipe', async () => {
    const { store, inserts } = mockStore([
      {
        householdId: 'hh-1',
        recipeId: 'r-curry',
        direction: 'like',
        round: 0,
      },
    ])
    const res = await recordPickDataPoint(
      store,
      { householdId: 'hh-1', chosenRecipeId: 'r-curry' },
      () => 'id-x',
    )

    expect(res).toEqual({ inserted: 0, skipped: 1 })
    expect(inserts).toEqual([])
    expect(store.insertSwipe).not.toHaveBeenCalled()
  })

  it('does nothing (no existence check, no insert) for an empty pick', async () => {
    const { store } = mockStore()
    const res = await recordPickDataPoint(
      store,
      { householdId: '', chosenRecipeId: '' },
      () => 'id-x',
    )

    expect(res).toEqual({ inserted: 0, skipped: 0 })
    expect(store.hasSwipe).not.toHaveBeenCalled()
    expect(store.insertSwipe).not.toHaveBeenCalled()
  })

  it('scopes the existence check to the household + recipe + direction', async () => {
    const { store } = mockStore()
    await recordPickDataPoint(
      store,
      { householdId: 'hh-9', chosenRecipeId: 'r-tacos' },
      () => 'id-1',
    )
    expect(store.hasSwipe).toHaveBeenCalledWith({
      householdId: 'hh-9',
      recipeId: 'r-tacos',
      direction: 'like',
    })
  })
})
