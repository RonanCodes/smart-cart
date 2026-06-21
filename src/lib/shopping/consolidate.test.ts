import { describe, expect, it } from 'vitest'
import {
  CHILD_PORTION_FACTOR,
  consolidate,
  estimatedItems,
  sharedAcrossMeals,
  targetServings,
} from './consolidate'
import { splitQtyAndUnit } from './parse'
import type { ShoppingRecipe } from './types'

function recipe(
  id: string,
  title: string,
  servings: number | null,
  ingredients: ShoppingRecipe['ingredients'],
): ShoppingRecipe {
  return { id, title, servings, ingredients }
}

describe('targetServings + child factor', () => {
  it('exposes a 0.5 child factor', () => {
    expect(CHILD_PORTION_FACTOR).toBe(0.5)
  })

  it('counts a child as half an adult', () => {
    expect(targetServings({ adults: 2, children: 2 })).toBe(3)
    expect(targetServings({ adults: 2 })).toBe(2)
    expect(targetServings({ adults: 1, children: 1 })).toBe(1.5)
  })

  it('clamps negatives to zero', () => {
    expect(targetServings({ adults: -1, children: -3 })).toBe(0)
  })
})

describe('consolidate — scaling', () => {
  it('scales quantities by target / recipe servings', () => {
    const r = recipe('r1', 'Pasta', 2, [
      { name: 'pasta', qty: '200', unit: 'g' },
    ])
    const list = consolidate([r], { adults: 4 })
    const pasta = list.lines.find((l) => l.name === 'pasta')!
    expect(pasta.totalQty).toBe(400)
    expect(pasta.unit).toBe('g')
    expect(pasta.displayAmount).toBe('400 g')
  })

  it('scales down for a smaller household', () => {
    const r = recipe('r1', 'Pasta', 4, [
      { name: 'pasta', qty: '400', unit: 'g' },
    ])
    const list = consolidate([r], { adults: 2 })
    expect(list.lines[0]!.totalQty).toBe(200)
  })

  it('does not scale when recipe servings are missing or zero', () => {
    const r = recipe('r1', 'Soup', null, [
      { name: 'stock', qty: '500', unit: 'ml' },
    ])
    const list = consolidate([r], { adults: 8 })
    expect(list.lines[0]!.totalQty).toBe(500)
  })
})

describe('consolidate — fraction/range parsing in context', () => {
  it('scales a fraction quantity', () => {
    const r = recipe('r1', 'Cake', 2, [
      { name: 'butter', qty: '1/2', unit: 'kg' },
    ])
    const list = consolidate([r], { adults: 4 })
    // 0.5 kg * (4/2) = 1 kg -> rendered as kg
    expect(list.lines[0]!.displayAmount).toBe('1 kg')
  })

  it('uses the upper range bound', () => {
    const r = recipe('r1', 'Stew', 1, [
      { name: 'carrot', qty: '2-3', unit: '' },
    ])
    const list = consolidate([r], { adults: 1 })
    expect(list.lines[0]!.totalQty).toBe(3)
  })
})

describe('consolidate — unit normalisation', () => {
  it('adds g and kg into one total', () => {
    const r1 = recipe('r1', 'A', 1, [{ name: 'flour', qty: '500', unit: 'g' }])
    const r2 = recipe('r2', 'B', 1, [{ name: 'flour', qty: '1', unit: 'kg' }])
    const list = consolidate([r1, r2], { adults: 1 })
    const flour = list.lines[0]!
    expect(flour.totalQty).toBe(1.5)
    expect(flour.unit).toBe('kg')
    expect(flour.extraAmounts).toBeUndefined()
  })

  it('adds tsp and tbsp into one spoon total', () => {
    const r1 = recipe('r1', 'A', 1, [{ name: 'cumin', qty: '1', unit: 'tbsp' }])
    const r2 = recipe('r2', 'B', 1, [{ name: 'cumin', qty: '1', unit: 'tsp' }])
    const list = consolidate([r1, r2], { adults: 1 })
    // 3 tsp + 1 tsp = 4 tsp -> '4 tsp'
    expect(list.lines[0]!.displayAmount).toBe('4 tsp')
  })
})

describe('consolidate — cross-recipe merge / interlink', () => {
  it('merges the same ingredient and lists the meals that use it', () => {
    const r1 = recipe('r1', 'Curry', 2, [{ name: 'Onion', qty: '1', unit: '' }])
    const r2 = recipe('r2', 'Soup', 2, [{ name: 'onion', qty: '2', unit: '' }])
    const r3 = recipe('r3', 'Salad', 2, [
      { name: 'onion ', qty: '1', unit: '' },
    ])
    const list = consolidate([r1, r2, r3], { adults: 2 })
    const onion = list.lines.find((l) => l.name.toLowerCase() === 'onion')!
    expect(onion.totalQty).toBe(4)
    expect(onion.usedInMeals).toEqual(['Curry', 'Salad', 'Soup'])
  })

  it('keeps incompatible-unit collisions as separate sub-amounts', () => {
    const r1 = recipe('r1', 'A', 1, [
      { name: 'garlic', qty: '2', unit: 'cloves' },
    ])
    const r2 = recipe('r2', 'B', 1, [{ name: 'garlic', qty: '15', unit: 'g' }])
    const list = consolidate([r1, r2], { adults: 1 })
    const garlic = list.lines[0]!
    // largest base value is the 15 g bucket -> primary; cloves -> extra
    expect(garlic.totalQty).toBe(15)
    expect(garlic.unit).toBe('g')
    expect(garlic.extraAmounts).toEqual(['2 cloves'])
    expect(garlic.displayAmount).toBe('15 g + 2 cloves')
  })
})

describe('consolidate — unparseable handling', () => {
  it('lists an unparseable quantity without a number', () => {
    const r = recipe('r1', 'A', 1, [{ name: 'salt', qty: 'a pinch', unit: '' }])
    const list = consolidate([r], { adults: 1 })
    const salt = list.lines[0]!
    expect(salt.totalQty).toBeUndefined()
    expect(salt.unparsed).toEqual(['a pinch'])
    expect(salt.displayAmount).toBe('(a pinch)')
  })

  it('combines a numeric part with an unparseable note across recipes', () => {
    const r1 = recipe('r1', 'A', 1, [{ name: 'pepper', qty: '2', unit: 'g' }])
    const r2 = recipe('r2', 'B', 1, [
      { name: 'pepper', qty: 'to taste', unit: '' },
    ])
    const list = consolidate([r1, r2], { adults: 1 })
    const pepper = list.lines[0]!
    expect(pepper.totalQty).toBe(2)
    expect(pepper.displayAmount).toBe('2 g (to taste)')
  })

  it('falls back to a neutral amount when nothing is specified', () => {
    const r = recipe('r1', 'A', 1, [{ name: 'salt', unit: '' }])
    const list = consolidate([r], { adults: 1 })
    expect(list.lines[0]!.displayAmount).toBe('(unspecified amount)')
  })

  it('drops cooking water "from the tap" (it is a recipe step, not a grocery)', () => {
    const r = recipe('r1', 'A', 1, [
      { name: 'tap water', qty: '1200', unit: 'ml' },
      { name: 'boiling water', qty: '900', unit: 'ml' },
      { name: 'salt', qty: '5', unit: 'g' },
    ])
    const list = consolidate([r], { adults: 1 })
    expect(list.lines.map((l) => l.name)).toEqual(['salt'])
  })

  it('merges chili / chilli spelling variants into one line, summing amounts', () => {
    const r = recipe('r1', 'A', 1, [
      { name: 'chili flakes', qty: '10', unit: 'g' },
      { name: 'chilli flakes', qty: '20', unit: 'g' },
    ])
    const list = consolidate([r], { adults: 1 })
    expect(list.lines).toHaveLength(1)
    expect(list.lines[0]!.totalQty).toBe(30)
    expect(list.lines[0]!.unit).toBe('g')
  })

  it('drops a zero amount rather than rendering "0 tsp"', () => {
    const r = recipe('r1', 'A', 1, [
      { name: 'chilli flakes', qty: '0', unit: 'tsp' },
    ])
    const list = consolidate([r], { adults: 1 })
    expect(list.lines).toHaveLength(1)
    expect(list.lines[0]!.displayAmount).toBe('(unspecified amount)')
  })
})

describe('consolidate — selectors + determinism', () => {
  const recipes = [
    recipe('r1', 'Curry', 2, [
      { name: 'onion', qty: '1', unit: '' },
      { name: 'rice', qty: '150', unit: 'g' },
    ]),
    recipe('r2', 'Soup', 2, [
      { name: 'onion', qty: '1', unit: '' },
      { name: 'stock', qty: '500', unit: 'ml' },
    ]),
  ]

  it('reports shared ingredients (used in >1 meal)', () => {
    const list = consolidate(recipes, { adults: 2 })
    const shared = sharedAcrossMeals(list)
    expect(shared.map((l) => l.name)).toEqual(['onion'])
  })

  it('counts estimated items', () => {
    const list = consolidate(recipes, { adults: 2 })
    expect(estimatedItems(list)).toBe(3)
    expect(list.estimatedItems).toBe(3)
  })

  it('is deterministic and alphabetically ordered', () => {
    const a = consolidate(recipes, { adults: 2 })
    const b = consolidate([...recipes].reverse(), { adults: 2 })
    expect(a.lines.map((l) => l.name)).toEqual(['onion', 'rice', 'stock'])
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('skips ingredients with an empty name', () => {
    const r = recipe('r1', 'A', 1, [{ name: '  ', qty: '1', unit: '' }])
    const list = consolidate([r], { adults: 1 })
    expect(list.lines).toHaveLength(0)
  })
})

describe('consolidate — Dutch packed-qty path (the #292 bug)', () => {
  // The seeded AH / Jumbo recipes pack the amount AND the unit into ONE `qty`
  // field with no separate unit ("300 g", "1 el", "1 teen", "snufje"). The
  // server splits that with `splitQtyAndUnit` before consolidating; mirror that
  // here so the end-to-end shape (amounts present, never blank-when-known) is
  // locked, not just the individual helpers.
  function dutch(
    id: string,
    title: string,
    servings: number | null,
    raw: Array<{ name: string; qty?: string }>,
  ): ShoppingRecipe {
    return recipe(
      id,
      title,
      servings,
      raw.map((i) => {
        const s = splitQtyAndUnit(i.qty)
        return { name: i.name, qty: s.qty, unit: s.unit }
      }),
    )
  }

  it('produces a real amount for every ingredient that has a packed one', () => {
    const r = dutch('r1', 'Broccoli-pasta', 4, [
      { name: 'broccoli', qty: '300 g' },
      { name: 'citroen', qty: '1' },
      { name: 'dijonmosterd', qty: '1 el' },
      { name: 'knoflook', qty: '1 teen' },
      { name: 'melk', qty: '200 ml' },
      { name: 'zout', qty: 'snufje' },
    ])
    const list = consolidate([r], { adults: 4 })
    const byName = Object.fromEntries(
      list.lines.map((l) => [l.name, l.displayAmount]),
    )
    expect(byName['broccoli']).toBe('300 g')
    expect(byName['citroen']).toBe('1')
    expect(byName['dijonmosterd']).toBe('1 tbsp') // 1 el normalises to 1 tbsp
    expect(byName['knoflook']).toBe('1 teen')
    expect(byName['melk']).toBe('200 ml')
    // 'snufje' has no number, so the line stays unspecified (the '+' affordance
    // at the persist layer), never an invented amount.
    expect(byName['zout']).toBe('(unspecified amount)')
  })

  it('sums a packed amount across recipes that share an ingredient', () => {
    const r1 = dutch('r1', 'Pasta', 4, [{ name: 'broccoli', qty: '300 g' }])
    const r2 = dutch('r2', 'Stamppot', 4, [{ name: 'broccoli', qty: '200 g' }])
    const list = consolidate([r1, r2], { adults: 4 })
    expect(list.lines).toHaveLength(1)
    expect(list.lines[0]!.displayAmount).toBe('500 g')
  })
})
