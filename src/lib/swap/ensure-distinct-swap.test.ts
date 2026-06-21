import { describe, it, expect } from 'vitest'
import { ensureDistinctSwap } from './ensure-distinct-swap'

describe('ensureDistinctSwap', () => {
  it('keeps a chosen recipe that already differs from the current one', () => {
    const res = ensureDistinctSwap({
      chosenId: 'r-curry',
      currentRecipeId: 'r-tacos',
      rankedCandidateIds: ['r-pasta', 'r-soup'],
    })
    expect(res).toEqual({ recipeId: 'r-curry', degenerate: false })
    // The load-bearing guarantee: the result is never the current recipe.
    expect(res.recipeId).not.toBe('r-tacos')
  })

  it('falls back to the next-best DISTINCT recipe when the pick collides', () => {
    // The request picked the day's own current recipe (a stale list / duplicated
    // id). The swap must still move to a different recipe.
    const currentRecipeId = 'r-tacos'
    const res = ensureDistinctSwap({
      chosenId: currentRecipeId,
      currentRecipeId,
      rankedCandidateIds: ['r-tacos', 'r-pasta', 'r-soup'],
    })
    expect(res.recipeId).not.toBe(currentRecipeId)
    expect(res).toEqual({ recipeId: 'r-pasta', degenerate: false })
  })

  it('skips other days recipes so a swap never duplicates another day', () => {
    const res = ensureDistinctSwap({
      chosenId: 'r-tacos',
      currentRecipeId: 'r-tacos',
      // r-pasta is on another day, so it must be skipped; r-soup is the first free.
      rankedCandidateIds: ['r-tacos', 'r-pasta', 'r-soup'],
      avoidIds: ['r-pasta'],
    })
    expect(res.recipeId).toBe('r-soup')
    expect(res.degenerate).toBe(false)
  })

  it('flags degenerate (keeps current) only when nothing distinct is left', () => {
    const res = ensureDistinctSwap({
      chosenId: 'r-tacos',
      currentRecipeId: 'r-tacos',
      // The only candidates are the current recipe and an already-used day.
      rankedCandidateIds: ['r-tacos', 'r-pasta'],
      avoidIds: ['r-pasta'],
    })
    expect(res).toEqual({ recipeId: 'r-tacos', degenerate: true })
  })

  it('treats an empty chosen id as a collision and resolves a distinct pick', () => {
    const res = ensureDistinctSwap({
      chosenId: '',
      currentRecipeId: 'r-tacos',
      rankedCandidateIds: ['r-tacos', 'r-curry'],
    })
    expect(res.recipeId).toBe('r-curry')
    expect(res.recipeId).not.toBe('r-tacos')
  })
})
