import { describe, it, expect } from 'vitest'
import { deriveShoppingView } from './shopping-server'
import type { PlanDayRef, PlanRecipe } from './shopping-server'

/**
 * Tests for the pure derivation glue between the DB shapes and the shopping
 * engine. The DB itself is not exercised: we hand `deriveShoppingView` the same
 * shapes the server handler would, and assert the consolidation + portion
 * scaling + shared-meal selection behave.
 */

function recipe(over: Partial<PlanRecipe> & { id: string }): PlanRecipe {
  return {
    title: over.title ?? over.id,
    servings: over.servings ?? null,
    ingredients: over.ingredients ?? [],
    ...over,
  }
}

function mapOf(...recipes: Array<PlanRecipe>): Map<string, PlanRecipe> {
  return new Map(recipes.map((r) => [r.id, r]))
}

describe('deriveShoppingView', () => {
  it('returns an empty list when no day references a recipe', () => {
    const days: Array<PlanDayRef> = [{}, { recipeRef: undefined }]
    const { list, shared } = deriveShoppingView(days, new Map(), {
      adults: 2,
    })
    expect(list.lines).toEqual([])
    expect(list.estimatedItems).toBe(0)
    expect(shared).toEqual([])
  })

  it('skips a day whose recipe is missing from the catalogue', () => {
    const days: Array<PlanDayRef> = [{ recipeRef: 'gone' }]
    const { list } = deriveShoppingView(days, new Map(), { adults: 2 })
    expect(list.lines).toEqual([])
  })

  it('consolidates ingredients across the planned recipes', () => {
    const recipes = mapOf(
      recipe({
        id: 'r1',
        title: 'Pasta',
        servings: 2,
        ingredients: [
          { name: 'Onion', qty: '1' },
          { name: 'Pasta', qty: '200', unit: 'g' },
        ],
      }),
      recipe({
        id: 'r2',
        title: 'Soup',
        servings: 2,
        ingredients: [{ name: 'Onion', qty: '2' }],
      }),
    )
    const days: Array<PlanDayRef> = [{ recipeRef: 'r1' }, { recipeRef: 'r2' }]
    // 2 adults => target 2 servings; both recipes are written for 2 so no scale.
    const { list } = deriveShoppingView(days, recipes, { adults: 2 })

    const onion = list.lines.find((l) => l.name === 'Onion')
    expect(onion).toBeDefined()
    // 1 (pasta) + 2 (soup) = 3 onions, merged into one line across both meals.
    expect(onion?.totalQty).toBe(3)
    expect(onion?.usedInMeals).toEqual(['Pasta', 'Soup'])
  })

  it('scales quantities by the household portions', () => {
    const recipes = mapOf(
      recipe({
        id: 'r1',
        title: 'Curry',
        servings: 2,
        ingredients: [{ name: 'Rice', qty: '100', unit: 'g' }],
      }),
    )
    const days: Array<PlanDayRef> = [{ recipeRef: 'r1' }]
    // 4 adults vs a 2-serving recipe => factor 2 => 200 g rice.
    const { list } = deriveShoppingView(days, recipes, { adults: 4 })
    const rice = list.lines.find((l) => l.name === 'Rice')
    expect(rice?.totalQty).toBe(200)
    expect(rice?.unit).toBe('g')
    expect(list.targetServings).toBe(4)
  })

  it('counts a child as a fraction of an adult portion', () => {
    const recipes = mapOf(
      recipe({
        id: 'r1',
        title: 'Stew',
        servings: 2,
        ingredients: [{ name: 'Carrot', qty: '2' }],
      }),
    )
    const days: Array<PlanDayRef> = [{ recipeRef: 'r1' }]
    // 2 adults + 1 child (0.5) = 2.5 target / 2 servings => factor 1.25 => 2.5.
    const { list } = deriveShoppingView(days, recipes, {
      adults: 2,
      children: 1,
    })
    expect(list.targetServings).toBe(2.5)
    const carrot = list.lines.find((l) => l.name === 'Carrot')
    expect(carrot?.totalQty).toBe(2.5)
  })

  it('surfaces only multi-meal ingredients as shared', () => {
    const recipes = mapOf(
      recipe({
        id: 'r1',
        title: 'Pasta',
        servings: 2,
        ingredients: [
          { name: 'Garlic', qty: '2' },
          { name: 'Basil', qty: '1' },
        ],
      }),
      recipe({
        id: 'r2',
        title: 'Pizza',
        servings: 2,
        ingredients: [{ name: 'Garlic', qty: '1' }],
      }),
    )
    const days: Array<PlanDayRef> = [{ recipeRef: 'r1' }, { recipeRef: 'r2' }]
    const { shared } = deriveShoppingView(days, recipes, { adults: 2 })
    expect(shared.map((l) => l.name)).toEqual(['Garlic'])
    expect(shared[0]?.usedInMeals).toEqual(['Pasta', 'Pizza'])
  })

  it('carries a packed "350 g" qty through (the #238 quantity-blank bug)', () => {
    // The seeded AH / Jumbo recipes pack the value AND unit into one `qty`
    // string with no separate `unit`. Before the fix these parsed as unparsable
    // notes and the amount vanished from the saved list; now the derivation
    // splits them so the scaled amount survives.
    const recipes = mapOf(
      recipe({
        id: 'r1',
        title: 'Curry',
        servings: 2,
        ingredients: [
          { name: 'kikkererwten', qty: '400 g' },
          { name: 'kokosmelk', qty: '200 ml' },
          { name: 'olijfolie', qty: '2 el' },
          { name: 'naan', qty: '4' },
        ],
      }),
    )
    const days: Array<PlanDayRef> = [{ recipeRef: 'r1' }]
    const { list } = deriveShoppingView(days, recipes, { adults: 2 })

    const chick = list.lines.find((l) => l.name === 'kikkererwten')
    expect(chick?.totalQty).toBe(400)
    expect(chick?.unit).toBe('g')
    expect(chick?.displayAmount).toBe('400 g')

    const coco = list.lines.find((l) => l.name === 'kokosmelk')
    expect(coco?.totalQty).toBe(200)
    expect(coco?.unit).toBe('ml')

    // '2 el' (Dutch eetlepel) normalises into the spoon dimension.
    const oil = list.lines.find((l) => l.name === 'olijfolie')
    expect(oil?.displayAmount).not.toBe('(unspecified amount)')

    const naan = list.lines.find((l) => l.name === 'naan')
    expect(naan?.totalQty).toBe(4)
  })

  it('treats a recipe cooked on two days as two contributions', () => {
    const recipes = mapOf(
      recipe({
        id: 'r1',
        title: 'Omelette',
        servings: 2,
        ingredients: [{ name: 'Eggs', qty: '4' }],
      }),
    )
    const days: Array<PlanDayRef> = [{ recipeRef: 'r1' }, { recipeRef: 'r1' }]
    const { list } = deriveShoppingView(days, recipes, { adults: 2 })
    const eggs = list.lines.find((l) => l.name === 'Eggs')
    // Cooked twice for 2 people => 8 eggs.
    expect(eggs?.totalQty).toBe(8)
  })
})
