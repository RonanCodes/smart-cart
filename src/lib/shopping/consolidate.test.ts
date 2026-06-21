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

describe('consolidate — grams correctness (portion-scaled SUM across recipes)', () => {
  it('consolidates the same ingredient across recipes to the SUM of scaled grams', () => {
    // flour appears in three recipes at different per-recipe servings. The list
    // must show the SUM of each recipe's PORTION-SCALED grams, not a raw sum and
    // not any one recipe's amount.
    //   r1: 100 g @ 2 servings, target 2 -> 100 * 2/2 = 100 g
    //   r2: 300 g @ 4 servings, target 2 -> 300 * 2/4 = 150 g
    //   r3: 250 g @ 1 serving,  target 2 -> 250 * 2/1 = 500 g
    // expected total = 100 + 150 + 500 = 750 g (stays in grams, no kg rollover).
    const r1 = recipe('r1', 'A', 2, [{ name: 'flour', qty: '100', unit: 'g' }])
    const r2 = recipe('r2', 'B', 4, [{ name: 'flour', qty: '300', unit: 'g' }])
    const r3 = recipe('r3', 'C', 1, [{ name: 'flour', qty: '250', unit: 'g' }])
    const list = consolidate([r1, r2, r3], { adults: 2 })

    const flour = list.lines.find((l) => l.name === 'flour')!
    expect(list.lines).toHaveLength(1)
    expect(flour.totalQty).toBe(750)
    expect(flour.unit).toBe('g')
    expect(flour.displayAmount).toBe('750 g')
    expect(flour.usedInMeals).toEqual(['A', 'B', 'C'])
  })

  it('sums kg + g contributions into one mass total', () => {
    // 500 g (r1, 1 serving, target 2 -> 1000 g) + 1 kg (r2, 1 serving -> 2000 g)
    // = 3000 g = 3 kg.
    const r1 = recipe('r1', 'A', 1, [{ name: 'sugar', qty: '500', unit: 'g' }])
    const r2 = recipe('r2', 'B', 1, [{ name: 'sugar', qty: '1', unit: 'kg' }])
    const list = consolidate([r1, r2], { adults: 2 })
    const sugar = list.lines[0]!
    expect(sugar.totalQty).toBe(3)
    expect(sugar.unit).toBe('kg')
  })
})

/**
 * INGREDIENTS <-> RECIPES: the consolidation never invents or silently drops a
 * real ingredient. Every consolidated cart-line name must trace back to a real
 * recipe ingredient name (under the same lower-case/spelling-variant de-dupe key
 * the engine uses). The ONLY allowed removals are the clean-list noise filters:
 * cooking water "from the tap" and empty names. This is the guard that no junk
 * line gets introduced between the recipes and the cart.
 */
describe('consolidate — ingredients trace back to real recipe ingredients (no junk)', () => {
  // A small week fixture spanning shared ingredients, spelling variants, casing,
  // a tap-water line (must drop), and a blank-name line (must drop).
  const week: Array<ShoppingRecipe> = [
    recipe('r1', 'Curry', 2, [
      { name: 'Onion', qty: '1', unit: '' },
      { name: 'chili flakes', qty: '10', unit: 'g' },
      { name: 'rice', qty: '150', unit: 'g' },
      { name: 'tap water', qty: '500', unit: 'ml' }, // dropped (clean-list)
    ]),
    recipe('r2', 'Soup', 2, [
      { name: 'onion ', qty: '2', unit: '' }, // merges with 'Onion'
      { name: 'chilli flakes', qty: '5', unit: 'g' }, // merges with 'chili flakes'
      { name: 'stock', qty: '500', unit: 'ml' },
      { name: '  ', qty: '1', unit: '' }, // blank name dropped
    ]),
  ]

  /** The de-dupe key set the engine uses, computed from the raw recipe names. */
  function dedupeKey(name: string): string {
    return name.trim().toLowerCase().replace(/\s+/g, ' ')
  }

  it('every cart line name traces back to a real recipe ingredient name', () => {
    const list = consolidate(week, { adults: 2 })

    // The set of real ingredient keys present in the recipes (after clean-list's
    // only allowed removals: tap water + blank names).
    const realKeys = new Set<string>()
    for (const r of week) {
      for (const ing of r.ingredients) {
        if (ing.name.trim() === '') continue
        if (/\bwater\b/i.test(ing.name)) continue // tap-water style removal
        // chili/chilli collapse to one key, like the engine's spelling map.
        realKeys.add(dedupeKey(ing.name).replace(/\bchili\b/, 'chilli'))
      }
    }

    // Every emitted line maps to a real ingredient key — nothing invented.
    for (const line of list.lines) {
      const key = dedupeKey(line.name).replace(/\bchili\b/, 'chilli')
      expect(realKeys.has(key)).toBe(true)
    }

    // And no real grocery was dropped: the four distinct real groceries survive
    // (onion, chilli flakes, rice, stock), with water + blank gone.
    const names = list.lines.map((l) => l.name.toLowerCase())
    expect(names.sort()).toEqual(['chili flakes', 'onion', 'rice', 'stock'])
    expect(names.some((n) => /\bwater\b/.test(n))).toBe(false)
  })

  it('merges duplicates so a shared ingredient yields exactly one line', () => {
    const list = consolidate(week, { adults: 2 })
    // onion (Onion + onion ) and chilli flakes (chili + chilli) each collapse to
    // ONE line — no duplicate cart entries invented.
    expect(
      list.lines.filter((l) => l.name.toLowerCase() === 'onion'),
    ).toHaveLength(1)
    expect(
      list.lines.filter((l) => /chill?i flakes/i.test(l.name)),
    ).toHaveLength(1)
  })
})
