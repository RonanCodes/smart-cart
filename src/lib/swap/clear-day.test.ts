import { describe, it, expect } from 'vitest'
import { clearDay, planHasDay, isDayActive, activeDays } from './clear-day'
import type { PlanDay } from './clear-day'

/**
 * Tests for the pure "remove / skip a dinner" plan edit (#255). No DB: we hand
 * `clearDay` a plain plan and assert the target day is emptied + marked 'out',
 * every other day is untouched, and the derived "active days" exclude the cleared
 * day (the rule the shopping list + cart read).
 */

function week(): Array<PlanDay> {
  return [
    { day: 'Monday', meal: 'Pasta', recipeRef: 'r1', type: 'home' },
    { day: 'Tuesday', meal: 'Soup', recipeRef: 'r2', type: 'busy' },
    { day: 'Wednesday', meal: 'Curry', recipeRef: 'r3', type: 'home' },
  ]
}

describe('clearDay', () => {
  it('empties the target day and marks it eating-out', () => {
    const next = clearDay(week(), 'Tuesday')
    const tue = next.find((d) => d.day === 'Tuesday')!
    expect(tue.recipeRef).toBe('')
    expect(tue.meal).toBe('')
    expect(tue.type).toBe('out')
  })

  it('leaves every other day untouched (recipe + type preserved)', () => {
    const next = clearDay(week(), 'Tuesday')
    expect(next.find((d) => d.day === 'Monday')).toEqual({
      day: 'Monday',
      meal: 'Pasta',
      recipeRef: 'r1',
      type: 'home',
    })
    expect(next.find((d) => d.day === 'Wednesday')).toEqual({
      day: 'Wednesday',
      meal: 'Curry',
      recipeRef: 'r3',
      type: 'home',
    })
  })

  it('does not mutate the input', () => {
    const days = week()
    clearDay(days, 'Monday')
    expect(days.find((d) => d.day === 'Monday')!.recipeRef).toBe('r1')
  })

  it('keeps the day slot in the week (Sunday/weekend never dropped)', () => {
    const days = [
      ...week(),
      { day: 'Sunday', meal: 'Roast', recipeRef: 'r7', type: 'home' as const },
    ]
    const next = clearDay(days, 'Sunday')
    // Same number of days: a skipped Sunday is still a Sunday, just empty.
    expect(next).toHaveLength(4)
    expect(next.find((d) => d.day === 'Sunday')!.recipeRef).toBe('')
  })

  it('is a no-op-shaped change when the day is not in the plan', () => {
    const next = clearDay(week(), 'Friday')
    expect(next.map((d) => d.recipeRef)).toEqual(['r1', 'r2', 'r3'])
  })

  it('clearing an already-empty day stays empty', () => {
    const days = clearDay(week(), 'Monday')
    const again = clearDay(days, 'Monday')
    expect(again.find((d) => d.day === 'Monday')!.recipeRef).toBe('')
    expect(again.find((d) => d.day === 'Monday')!.type).toBe('out')
  })
})

describe('planHasDay', () => {
  it('is true for a day in the plan and false otherwise', () => {
    expect(planHasDay(week(), 'Monday')).toBe(true)
    expect(planHasDay(week(), 'Friday')).toBe(false)
  })
})

describe('isDayActive / activeDays', () => {
  it('an active day has a recipe; a cleared day does not', () => {
    expect(isDayActive({ recipeRef: 'r1' })).toBe(true)
    expect(isDayActive({ recipeRef: '' })).toBe(false)
    expect(isDayActive({})).toBe(false)
  })

  it('excludes a cleared/skipped day from the contributing set', () => {
    // This is the rule the shopping list + cart rely on: a removed day's
    // ingredients must not reach the list or the cart.
    const next = clearDay(week(), 'Tuesday')
    const active = activeDays(next)
    expect(active.map((d) => d.day)).toEqual(['Monday', 'Wednesday'])
    // Tuesday's recipe (r2) is gone, so it can never contribute ingredients.
    expect(active.some((d) => d.recipeRef === 'r2')).toBe(false)
  })

  it('a week with every day skipped contributes nothing', () => {
    let days = week()
    for (const d of ['Monday', 'Tuesday', 'Wednesday']) days = clearDay(days, d)
    expect(activeDays(days)).toEqual([])
  })
})
