import { describe, it, expect } from 'vitest'
import { applySimilarSwap, planHasDay } from './apply-similar-swap'
import type { PlanDay } from './apply-similar-swap'

const week: Array<PlanDay> = [
  { day: 'Monday', meal: 'Tacos', recipeRef: 'r-tacos' },
  { day: 'Tuesday', meal: 'Pasta', recipeRef: 'r-pasta' },
  { day: 'Wednesday', meal: '', recipeRef: undefined },
]

describe('applySimilarSwap', () => {
  it('replaces only the named day with the chosen recipe', () => {
    const next = applySimilarSwap(week, 'Tuesday', {
      id: 'r-curry',
      title: 'Thai Green Curry',
    })
    expect(next).toEqual([
      { day: 'Monday', meal: 'Tacos', recipeRef: 'r-tacos' },
      { day: 'Tuesday', meal: 'Thai Green Curry', recipeRef: 'r-curry' },
      { day: 'Wednesday', meal: '', recipeRef: undefined },
    ])
  })

  it('does not mutate the input array or its day objects', () => {
    const before = structuredClone(week)
    applySimilarSwap(week, 'Monday', { id: 'r-x', title: 'X' })
    expect(week).toEqual(before)
  })

  it('leaves the week unchanged when the day is not present', () => {
    const next = applySimilarSwap(week, 'Sunday', { id: 'r-x', title: 'X' })
    expect(next).toEqual(week)
  })

  it('can fill a skipped (eating-out) day', () => {
    const next = applySimilarSwap(week, 'Wednesday', {
      id: 'r-soup',
      title: 'Soup',
    })
    expect(next[2]).toEqual({
      day: 'Wednesday',
      meal: 'Soup',
      recipeRef: 'r-soup',
    })
  })
})

describe('planHasDay', () => {
  it('is true for a present day and false otherwise', () => {
    expect(planHasDay(week, 'Monday')).toBe(true)
    expect(planHasDay(week, 'Friday')).toBe(false)
  })
})
