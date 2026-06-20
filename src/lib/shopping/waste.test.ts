import { describe, expect, it } from 'vitest'
import { consolidate } from './consolidate'
import type { ShoppingRecipe } from './types'
import { hasExactAmount, reuseLabel, summariseWaste, wasteLevel } from './waste'

function recipe(
  id: string,
  title: string,
  servings: number | null,
  ingredients: ShoppingRecipe['ingredients'],
): ShoppingRecipe {
  return { id, title, servings, ingredients }
}

/** A small week: coriander spans 3 meals, onion 2, rice + salt single-meal. */
const week = [
  recipe('r1', 'Curry', 2, [
    { name: 'coriander', qty: '1', unit: 'bunch' },
    { name: 'onion', qty: '1', unit: '' },
    { name: 'rice', qty: '150', unit: 'g' },
  ]),
  recipe('r2', 'Soup', 2, [
    { name: 'coriander', qty: '1', unit: 'bunch' },
    { name: 'onion', qty: '1', unit: '' },
    { name: 'salt', qty: 'a pinch', unit: '' },
  ]),
  recipe('r3', 'Salad', 2, [{ name: 'coriander', qty: '1', unit: 'bunch' }]),
]

describe('summariseWaste — shared ingredients', () => {
  it('counts ingredients used across more than one meal', () => {
    const summary = summariseWaste(consolidate(week, { adults: 2 }))
    // coriander (3 meals) + onion (2 meals) are shared; rice + salt are not.
    expect(summary.sharedIngredientCount).toBe(2)
  })

  it('sums the extra meals covered by reuse', () => {
    const summary = summariseWaste(consolidate(week, { adults: 2 }))
    // coriander covers 2 extra meals, onion covers 1 -> 3 extra buys avoided.
    expect(summary.reusedMealCoverage).toBe(3)
  })

  it('reports no savings for an empty list', () => {
    const summary = summariseWaste(consolidate([], { adults: 2 }))
    expect(summary.hasSavings).toBe(false)
    expect(summary.sharedIngredientCount).toBe(0)
    expect(summary.estimatePct).toBe(0)
    expect(summary.totalItems).toBe(0)
  })

  it('reports no shared savings when every ingredient is single-meal', () => {
    const solo = [
      recipe('r1', 'A', 2, [{ name: 'rice', qty: '100', unit: 'g' }]),
      recipe('r2', 'B', 2, [{ name: 'pasta', qty: '100', unit: 'g' }]),
    ]
    const summary = summariseWaste(consolidate(solo, { adults: 2 }))
    expect(summary.sharedIngredientCount).toBe(0)
    expect(summary.reusedMealCoverage).toBe(0)
    // still has exact-amount savings (both lines carry a number)
    expect(summary.hasSavings).toBe(true)
  })
})

describe('summariseWaste — exact amounts', () => {
  it('counts only lines with a concrete summed quantity', () => {
    const summary = summariseWaste(consolidate(week, { adults: 2 }))
    // coriander (no parseable bunch qty stays numeric? it is '1' -> numeric),
    // onion (numeric), rice (numeric) carry numbers; salt is 'a pinch' only.
    // coriander=1, onion=1, rice=150 -> 3 exact; salt -> 0.
    expect(summary.exactAmountCount).toBe(3)
    expect(summary.totalItems).toBe(4)
  })

  it('hasExactAmount is false for an unparsed-only line', () => {
    const list = consolidate(
      [recipe('r1', 'A', 1, [{ name: 'salt', qty: 'a pinch', unit: '' }])],
      { adults: 1 },
    )
    expect(hasExactAmount(list.lines[0]!)).toBe(false)
  })
})

describe('summariseWaste — estimate', () => {
  it('blends share + exact ratios, clamped 0-100', () => {
    const summary = summariseWaste(consolidate(week, { adults: 2 }))
    // shareRatio = 2/4 = 0.5, exactRatio = 3/4 = 0.75
    // 0.5*0.6 + 0.75*0.4 = 0.3 + 0.3 = 0.6 -> 60
    expect(summary.estimatePct).toBe(60)
  })

  it('is deterministic for the same list', () => {
    const a = summariseWaste(consolidate(week, { adults: 2 }))
    const b = summariseWaste(consolidate([...week].reverse(), { adults: 2 }))
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })
})

describe('wasteLevel buckets', () => {
  it('maps the estimate to coarse words', () => {
    expect(wasteLevel(summariseWaste(consolidate([], { adults: 2 })))).toBe(
      'none',
    )
    // week estimate is 60 -> great
    expect(wasteLevel(summariseWaste(consolidate(week, { adults: 2 })))).toBe(
      'great',
    )
  })
})

describe('reuseLabel', () => {
  it('labels a shared ingredient with its meal count', () => {
    const list = consolidate(week, { adults: 2 })
    const coriander = list.lines.find((l) => l.name === 'coriander')!
    expect(reuseLabel(coriander)).toBe('Used in 3 meals, nothing left over')
  })

  it('returns null for a single-meal ingredient', () => {
    const list = consolidate(week, { adults: 2 })
    const rice = list.lines.find((l) => l.name === 'rice')!
    expect(reuseLabel(rice)).toBeNull()
  })
})
