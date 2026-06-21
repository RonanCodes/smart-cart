import { describe, it, expect } from 'vitest'
import { planDayForDow, todayHasCookedDinner } from './scheduled-nudges-core'
import type { PlanDay } from './scheduled-nudges-core'

const week: Array<PlanDay> = [
  { day: 'Monday', meal: 'Pasta', recipeRef: 'r1', type: 'home' },
  { day: 'Tuesday', meal: 'Curry', recipeRef: 'r2', type: 'busy' },
  { day: 'Wednesday', meal: '', recipeRef: '', type: 'out' },
  { day: 'Thursday', meal: 'Stew', recipeRef: 'r4', type: 'home' },
  { day: 'Friday', meal: 'Tacos', recipeRef: 'r5', type: 'home' },
  { day: 'Saturday', meal: 'Pizza', recipeRef: 'r6', type: 'home' },
  { day: 'Sunday', meal: 'Roast', recipeRef: 'r7', type: 'home' },
]

describe('planDayForDow (Sunday-0 -> Monday-first labels)', () => {
  it('maps each dow to the right plan day', () => {
    expect(planDayForDow(week, 1)?.day).toBe('Monday')
    expect(planDayForDow(week, 2)?.day).toBe('Tuesday')
    expect(planDayForDow(week, 3)?.day).toBe('Wednesday')
    expect(planDayForDow(week, 6)?.day).toBe('Saturday')
    expect(planDayForDow(week, 0)?.day).toBe('Sunday')
  })
  it('returns null when the labelled day is missing', () => {
    expect(planDayForDow([], 1)).toBeNull()
  })
})

describe('todayHasCookedDinner', () => {
  it('true for a home/busy day with a recipe', () => {
    expect(todayHasCookedDinner(week, 1)).toBe(true) // Monday home
    expect(todayHasCookedDinner(week, 2)).toBe(true) // Tuesday busy
    expect(todayHasCookedDinner(week, 0)).toBe(true) // Sunday home
  })
  it('false for an eating-out day', () => {
    expect(todayHasCookedDinner(week, 3)).toBe(false) // Wednesday out
  })
  it('false when the day has no recipeRef', () => {
    const w: Array<PlanDay> = [{ day: 'Monday', meal: 'TBD', type: 'home' }]
    expect(todayHasCookedDinner(w, 1)).toBe(false)
  })
  it('false when the plan has no such day', () => {
    expect(todayHasCookedDinner([], 1)).toBe(false)
  })
})
