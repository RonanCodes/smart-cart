import { describe, it, expect } from 'vitest'
import { healWeekPlan } from './heal-week-plan'
import type {
  HealPlanDay,
  HealReplacement,
  PickServableAlternative,
} from './heal-week-plan'

const SERVABLE = new Set(['ah-1', 'ah-2', 'ah-3', 'jumbo-1', 'jumbo-2'])

/**
 * A deterministic picker that hands out servable ids in a fixed order, skipping
 * any already in use, so the no-repeat behaviour is observable in the test.
 */
function makePicker(order: Array<HealReplacement>): PickServableAlternative {
  return (_day, excludeIds) => order.find((r) => !excludeIds.has(r.id)) ?? null
}

describe('healWeekPlan', () => {
  it('replaces a removed non-dinner AH recipe (crackers) with a servable dinner', () => {
    const week: Array<HealPlanDay> = [
      {
        day: 'Monday',
        meal: 'Koolhydraatarme crackers',
        recipeRef: 'ah-R1197752',
        type: 'home',
      },
    ]
    const picker = makePicker([{ id: 'ah-1', title: 'Pasta' }])

    const result = healWeekPlan(week, SERVABLE, picker)

    expect(result.changed).toBe(true)
    expect(result.days[0]).toEqual({
      day: 'Monday',
      meal: 'Pasta',
      recipeRef: 'ah-1',
      type: 'home',
    })
  })

  it('replaces a day whose recipe is not servable with a servable alternative', () => {
    const week: Array<HealPlanDay> = [
      { day: 'Monday', meal: 'Tacos', recipeRef: 'ah-1', type: 'home' },
      {
        day: 'Tuesday',
        meal: 'Bread Pudding with Jack Daniels Sauce',
        recipeRef: 'foodcom-999',
        type: 'home',
      },
      { day: 'Wednesday', meal: 'Pasta', recipeRef: 'ah-2', type: 'home' },
    ]
    const picker = makePicker([{ id: 'ah-3', title: 'Sea Bass' }])

    const result = healWeekPlan(week, SERVABLE, picker)

    expect(result.changed).toBe(true)
    expect(result.days[1]).toEqual({
      day: 'Tuesday',
      meal: 'Sea Bass',
      recipeRef: 'ah-3',
      type: 'home',
    })
    // The servable days are untouched.
    expect(result.days[0]).toEqual(week[0])
    expect(result.days[2]).toEqual(week[2])
  })

  it('leaves an all-servable plan unchanged (no new revision)', () => {
    const week: Array<HealPlanDay> = [
      { day: 'Monday', meal: 'Tacos', recipeRef: 'ah-1', type: 'home' },
      { day: 'Tuesday', meal: 'Pasta', recipeRef: 'jumbo-1', type: 'busy' },
      { day: 'Wednesday', meal: '', recipeRef: '', type: 'out' },
    ]

    const result = healWeekPlan(week, SERVABLE, () => {
      throw new Error('picker must not be called for a servable plan')
    })

    expect(result.changed).toBe(false)
    expect(result.days).toEqual(week)
  })

  it('never touches a skipped / out day even when its recipeRef is absent', () => {
    const week: Array<HealPlanDay> = [
      { day: 'Monday', meal: '', recipeRef: '', type: 'out' },
      { day: 'Tuesday', meal: '', recipeRef: undefined, type: 'out' },
    ]

    const result = healWeekPlan(week, SERVABLE, () => {
      throw new Error('picker must not be called for out days')
    })

    expect(result.changed).toBe(false)
    expect(result.days).toEqual(week)
  })

  it('honours no-repeat when healing several broken days in one pass', () => {
    const week: Array<HealPlanDay> = [
      { day: 'Monday', meal: 'Old A', recipeRef: 'foodcom-1', type: 'home' },
      { day: 'Tuesday', meal: 'Keep', recipeRef: 'ah-1', type: 'home' },
      { day: 'Wednesday', meal: 'Old B', recipeRef: 'foodcom-2', type: 'home' },
    ]
    // Picker always prefers ah-1 (already in the week), then ah-2, then ah-3.
    const picker = makePicker([
      { id: 'ah-1', title: 'Taken' },
      { id: 'ah-2', title: 'Curry' },
      { id: 'ah-3', title: 'Stew' },
    ])

    const result = healWeekPlan(week, SERVABLE, picker)

    expect(result.changed).toBe(true)
    // ah-1 is already in use (Tuesday), so the two healed days take ah-2 then ah-3,
    // never duplicating ah-1 or each other.
    expect(result.days[0]!.recipeRef).toBe('ah-2')
    expect(result.days[2]!.recipeRef).toBe('ah-3')
    expect(result.days[1]).toEqual(week[1])
  })

  it('leaves a broken day untouched when no servable alternative is available', () => {
    const week: Array<HealPlanDay> = [
      { day: 'Monday', meal: 'Old', recipeRef: 'foodcom-1', type: 'home' },
    ]
    const picker: PickServableAlternative = () => null

    const result = healWeekPlan(week, SERVABLE, picker)

    expect(result.changed).toBe(false)
    expect(result.days).toEqual(week)
  })

  it('does not mutate the input days', () => {
    const week: Array<HealPlanDay> = [
      { day: 'Monday', meal: 'Old', recipeRef: 'foodcom-1', type: 'home' },
    ]
    const before = structuredClone(week)
    healWeekPlan(week, SERVABLE, makePicker([{ id: 'ah-1', title: 'New' }]))
    expect(week).toEqual(before)
  })
})
