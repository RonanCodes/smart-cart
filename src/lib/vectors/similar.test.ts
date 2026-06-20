import { describe, expect, it } from 'vitest'
import { passesHardFilter, postProcessNeighbours } from './similar'
import type { Neighbour, SimilarRecipe } from './similar'

/**
 * Unit tests for the pure neighbour post-processing. Everything here runs against
 * a STUBBED scored-neighbour list and an in-memory recipe map, so there is no DB
 * and no I/O. The scorer itself (similar-score.ts) and the I/O orchestration
 * (similarRecipes) are covered separately.
 */

function recipe(over: Partial<SimilarRecipe> & { id: string }): SimilarRecipe {
  return {
    title: over.title ?? `Recipe ${over.id}`,
    cuisine: over.cuisine ?? 'italian',
    category: over.category ?? null,
    dietaryTags: over.dietaryTags ?? [],
    ingredients: over.ingredients ?? [{ name: 'tomato' }],
    prepMinutes: over.prepMinutes ?? null,
    calories: over.calories ?? null,
    ...over,
  }
}

function mapOf(...recipes: Array<SimilarRecipe>): Map<string, SimilarRecipe> {
  return new Map(recipes.map((r) => [r.id, r]))
}

describe('passesHardFilter', () => {
  it('drops a recipe whose ingredient contains an allergen', () => {
    const r = recipe({ id: 'r', ingredients: [{ name: 'Peanut butter' }] })
    expect(passesHardFilter(r, { allergies: ['peanut'] })).toBe(false)
  })

  it('keeps a recipe with no allergen present', () => {
    const r = recipe({ id: 'r', ingredients: [{ name: 'tofu' }] })
    expect(passesHardFilter(r, { allergies: ['peanut'] })).toBe(true)
  })

  it('requires a vegetarian tag for a vegetarian household', () => {
    const meaty = recipe({ id: 'm', dietaryTags: [] })
    const veg = recipe({ id: 'v', dietaryTags: ['vegetarian'] })
    expect(passesHardFilter(meaty, { diet: 'vegetarian' })).toBe(false)
    expect(passesHardFilter(veg, { diet: 'vegetarian' })).toBe(true)
  })

  it('a vegan household accepts only vegan, not merely vegetarian', () => {
    const veg = recipe({ id: 'v', dietaryTags: ['vegetarian'] })
    const vegan = recipe({ id: 'vn', dietaryTags: ['vegan'] })
    expect(passesHardFilter(veg, { diet: 'vegan' })).toBe(false)
    expect(passesHardFilter(vegan, { diet: 'vegan' })).toBe(true)
  })

  it('a vegetarian household accepts a vegan recipe', () => {
    const vegan = recipe({ id: 'vn', dietaryTags: ['vegan'] })
    expect(passesHardFilter(vegan, { diet: 'vegetarian' })).toBe(true)
  })

  it('an empty profile is permissive', () => {
    const r = recipe({ id: 'r', ingredients: [{ name: 'peanut' }] })
    expect(passesHardFilter(r, {})).toBe(true)
  })
})

describe('postProcessNeighbours', () => {
  const neighbours: Array<Neighbour> = [
    { id: 'self', score: 1.0 },
    { id: 'a', score: 0.9 },
    { id: 'b', score: 0.8 },
    { id: 'c', score: 0.7 },
  ]

  it('excludes the query recipe itself', () => {
    const recipes = mapOf(
      recipe({ id: 'self' }),
      recipe({ id: 'a' }),
      recipe({ id: 'b' }),
      recipe({ id: 'c' }),
    )
    const out = postProcessNeighbours(neighbours, recipes, 'self', {})
    expect(out.map((r) => r.id)).toEqual(['a', 'b', 'c'])
  })

  it('drops neighbours we have no recipe row for', () => {
    const recipes = mapOf(recipe({ id: 'self' }), recipe({ id: 'a' }))
    const out = postProcessNeighbours(neighbours, recipes, 'self', {})
    // b and c have no row, so they are excluded rather than returned unfiltered.
    expect(out.map((r) => r.id)).toEqual(['a'])
  })

  it('applies the allergy hard filter to neighbours', () => {
    const recipes = mapOf(
      recipe({ id: 'self' }),
      recipe({ id: 'a', ingredients: [{ name: 'Peanut sauce' }] }),
      recipe({ id: 'b', ingredients: [{ name: 'basil' }] }),
      recipe({ id: 'c', ingredients: [{ name: 'crushed peanuts' }] }),
    )
    const out = postProcessNeighbours(neighbours, recipes, 'self', {
      allergies: ['peanut'],
    })
    expect(out.map((r) => r.id)).toEqual(['b'])
  })

  it('applies the vegetarian diet hard filter to neighbours', () => {
    const recipes = mapOf(
      recipe({ id: 'self' }),
      recipe({ id: 'a', dietaryTags: [] }),
      recipe({ id: 'b', dietaryTags: ['vegetarian'] }),
      recipe({ id: 'c', dietaryTags: ['vegan'] }),
    )
    const out = postProcessNeighbours(neighbours, recipes, 'self', {
      diet: 'vegetarian',
    })
    expect(out.map((r) => r.id)).toEqual(['b', 'c'])
  })

  it('keeps the scorer nearest-first order by default (similarity)', () => {
    const recipes = mapOf(
      recipe({ id: 'self' }),
      recipe({ id: 'a', prepMinutes: 40 }),
      recipe({ id: 'b', prepMinutes: 10 }),
      recipe({ id: 'c', prepMinutes: 25 }),
    )
    const out = postProcessNeighbours(neighbours, recipes, 'self', {})
    expect(out.map((r) => r.id)).toEqual(['a', 'b', 'c'])
  })

  it('"faster" re-ranks by prep time ascending', () => {
    const recipes = mapOf(
      recipe({ id: 'self' }),
      recipe({ id: 'a', prepMinutes: 40 }),
      recipe({ id: 'b', prepMinutes: 10 }),
      recipe({ id: 'c', prepMinutes: 25 }),
    )
    const out = postProcessNeighbours(
      neighbours,
      recipes,
      'self',
      {},
      {
        sort: 'faster',
      },
    )
    expect(out.map((r) => r.id)).toEqual(['b', 'c', 'a'])
  })

  it('"lighter" re-ranks by calories ascending', () => {
    const recipes = mapOf(
      recipe({ id: 'self' }),
      recipe({ id: 'a', calories: 800 }),
      recipe({ id: 'b', calories: 300 }),
      recipe({ id: 'c', calories: 550 }),
    )
    const out = postProcessNeighbours(
      neighbours,
      recipes,
      'self',
      {},
      {
        sort: 'lighter',
      },
    )
    expect(out.map((r) => r.id)).toEqual(['b', 'c', 'a'])
  })

  it('sorts recipes missing the re-rank field last (faster)', () => {
    const recipes = mapOf(
      recipe({ id: 'self' }),
      recipe({ id: 'a', prepMinutes: null }),
      recipe({ id: 'b', prepMinutes: 15 }),
      recipe({ id: 'c', prepMinutes: null }),
    )
    const out = postProcessNeighbours(
      neighbours,
      recipes,
      'self',
      {},
      {
        sort: 'faster',
      },
    )
    // b (known prep) leads; the two nulls keep similarity order behind it.
    expect(out.map((r) => r.id)).toEqual(['b', 'a', 'c'])
  })

  it('tie-breaks a re-rank on similarity score', () => {
    const recipes = mapOf(
      recipe({ id: 'self' }),
      recipe({ id: 'a', prepMinutes: 20 }), // score 0.9
      recipe({ id: 'b', prepMinutes: 20 }), // score 0.8
      recipe({ id: 'c', prepMinutes: 20 }), // score 0.7
    )
    const out = postProcessNeighbours(
      neighbours,
      recipes,
      'self',
      {},
      {
        sort: 'faster',
      },
    )
    // Equal prep, so the more-similar recipe stays first.
    expect(out.map((r) => r.id)).toEqual(['a', 'b', 'c'])
  })

  it('truncates to the requested limit', () => {
    const recipes = mapOf(
      recipe({ id: 'self' }),
      recipe({ id: 'a' }),
      recipe({ id: 'b' }),
      recipe({ id: 'c' }),
    )
    const out = postProcessNeighbours(
      neighbours,
      recipes,
      'self',
      {},
      {
        limit: 2,
      },
    )
    expect(out.map((r) => r.id)).toEqual(['a', 'b'])
  })

  it('returns the similarity score alongside each neighbour', () => {
    const recipes = mapOf(recipe({ id: 'self' }), recipe({ id: 'a' }))
    const out = postProcessNeighbours(
      [
        { id: 'self', score: 1.0 },
        { id: 'a', score: 0.87 },
      ],
      recipes,
      'self',
      {},
    )
    expect(out).toEqual([expect.objectContaining({ id: 'a', score: 0.87 })])
  })

  it('combines allergy + diet filters then re-ranks (the swap path)', () => {
    const recipes = mapOf(
      recipe({ id: 'self' }),
      // dropped: not vegetarian
      recipe({ id: 'a', dietaryTags: [], prepMinutes: 5 }),
      // dropped: vegetarian but peanut allergen
      recipe({
        id: 'b',
        dietaryTags: ['vegetarian'],
        ingredients: [{ name: 'peanut oil' }],
        prepMinutes: 5,
      }),
      // kept
      recipe({
        id: 'c',
        dietaryTags: ['vegetarian'],
        ingredients: [{ name: 'chickpea' }],
        prepMinutes: 30,
      }),
      // kept, faster
      recipe({
        id: 'd',
        dietaryTags: ['vegan'],
        ingredients: [{ name: 'lentil' }],
        prepMinutes: 12,
      }),
    )
    const out = postProcessNeighbours(
      [
        { id: 'self', score: 1.0 },
        { id: 'a', score: 0.95 },
        { id: 'b', score: 0.9 },
        { id: 'c', score: 0.85 },
        { id: 'd', score: 0.8 },
      ],
      recipes,
      'self',
      { allergies: ['peanut'], diet: 'vegetarian' },
      { sort: 'faster' },
    )
    expect(out.map((r) => r.id)).toEqual(['d', 'c'])
  })
})
