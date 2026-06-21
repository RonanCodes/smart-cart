import { describe, expect, it } from 'vitest'
import type { PlannedWeek } from '../planner/types'
import { buildPlanDiff } from './diff'

/** A tiny week builder: `day -> dish` pairs into a PlannedWeek. */
function week(days: Array<[string, string]>): PlannedWeek {
  return {
    days: days.map(([day, meal]) => ({
      day,
      meal,
      recipeRef: meal ? day : '',
    })),
  }
}

describe('buildPlanDiff', () => {
  it('returns one change per day whose dish changed', () => {
    const before = week([
      ['Monday', 'Pasta Bake'],
      ['Tuesday', 'Tacos'],
      ['Wednesday', 'Pasta Carbonara'],
    ])
    const after = week([
      ['Monday', 'Pasta Bake'],
      ['Tuesday', 'Stir Fry'],
      ['Wednesday', 'Curry'],
    ])
    expect(buildPlanDiff(before, after)).toEqual([
      { day: 'Tuesday', removedTitle: 'Tacos', addedTitle: 'Stir Fry' },
      {
        day: 'Wednesday',
        removedTitle: 'Pasta Carbonara',
        addedTitle: 'Curry',
      },
    ])
  })

  it('skips unchanged days', () => {
    const same = week([
      ['Monday', 'Pasta Bake'],
      ['Tuesday', 'Tacos'],
    ])
    expect(buildPlanDiff(same, same)).toEqual([])
  })

  it('reads a cleared day as old -> empty (eating out)', () => {
    const before = week([['Wednesday', 'Risotto']])
    const after = week([['Wednesday', '']])
    expect(buildPlanDiff(before, after)).toEqual([
      { day: 'Wednesday', removedTitle: 'Risotto', addedTitle: '' },
    ])
  })

  it('reads a filled day as empty -> new', () => {
    const before = week([['Wednesday', '']])
    const after = week([['Wednesday', 'Risotto']])
    expect(buildPlanDiff(before, after)).toEqual([
      { day: 'Wednesday', removedTitle: '', addedTitle: 'Risotto' },
    ])
  })

  it('preserves calendar order from the before week', () => {
    const before = week([
      ['Monday', 'A'],
      ['Tuesday', 'B'],
      ['Wednesday', 'C'],
    ])
    const after = week([
      ['Monday', 'A2'],
      ['Tuesday', 'B'],
      ['Wednesday', 'C2'],
    ])
    expect(buildPlanDiff(before, after).map((c) => c.day)).toEqual([
      'Monday',
      'Wednesday',
    ])
  })

  it('ignores days present in only one week', () => {
    const before = week([['Monday', 'A']])
    const after = week([
      ['Monday', 'A'],
      ['Tuesday', 'New'],
    ])
    expect(buildPlanDiff(before, after)).toEqual([])
  })
})
