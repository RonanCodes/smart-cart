import { describe, expect, it } from 'vitest'
import type { InferredTaste, RecipeLite } from './types'
import {
  ingredientSupport,
  recipeWhy,
  recipeWhys,
  shapePreferences,
} from './explain-why'

function recipe(
  id: string,
  cuisine: string | null,
  ingredients: Array<string>,
): RecipeLite {
  return {
    id,
    title: `Recipe ${id}`,
    cuisine,
    category: null,
    dietaryTags: [],
    ingredients: ingredients.map((name) => ({ name })),
  }
}

const taste: InferredTaste = {
  lovedCuisines: [{ cuisine: 'Mexican', weight: 5 }],
  dislikedCuisines: ['Fish'],
  lovedIngredients: ['chicken'],
  dislikedIngredients: ['anchovy'],
  vegetarianLikelihood: 0,
}

describe('recipeWhy', () => {
  it('adds a loved-cuisine signal with the net like count', () => {
    const why = recipeWhy(recipe('r1', 'Mexican', ['rice']), taste)
    const cuisine = why.signals.find((s) => s.kind === 'loved-cuisine')
    expect(cuisine).toMatchObject({ token: 'Mexican', contribution: 5 })
    expect(cuisine?.label).toBe('+ loved cuisine Mexican (5 net likes)')
  })

  it('uses singular "like" when the net weight is 1', () => {
    const single: InferredTaste = {
      ...taste,
      lovedCuisines: [{ cuisine: 'Mexican', weight: 1 }],
    }
    const why = recipeWhy(recipe('r1', 'Mexican', []), single)
    expect(why.signals[0]?.label).toBe('+ loved cuisine Mexican (1 net like)')
  })

  it('adds a loved-ingredient signal (default magnitude 0.5)', () => {
    const why = recipeWhy(recipe('r2', null, ['Chicken Thigh']), taste)
    const ing = why.signals.find((s) => s.kind === 'loved-ingredient')
    expect(ing).toMatchObject({ token: 'chicken', contribution: 0.5 })
  })

  it('penalises a disliked cuisine', () => {
    const why = recipeWhy(recipe('r3', 'Fish', []), taste)
    const dis = why.signals.find((s) => s.kind === 'disliked-cuisine')
    expect(dis).toMatchObject({ token: 'Fish', contribution: -1 })
  })

  it('penalises a disliked ingredient', () => {
    const why = recipeWhy(recipe('r4', null, ['anchovy paste']), taste)
    const dis = why.signals.find((s) => s.kind === 'disliked-ingredient')
    expect(dis).toMatchObject({ token: 'anchovy', contribution: -0.5 })
  })

  it('sums signal contributions into the score', () => {
    // Mexican (+5) + chicken (+0.5) = 5.5
    const why = recipeWhy(recipe('r5', 'Mexican', ['chicken breast']), taste)
    expect(why.score).toBeCloseTo(5.5)
  })

  it('orders signals strongest-magnitude first', () => {
    const why = recipeWhy(recipe('r6', 'Mexican', ['chicken']), taste)
    expect(why.signals[0]?.kind).toBe('loved-cuisine')
    expect(why.signals[1]?.kind).toBe('loved-ingredient')
  })

  it('produces no signals for a neutral recipe', () => {
    const why = recipeWhy(recipe('r7', 'Greek', ['lentils']), taste)
    expect(why.signals).toEqual([])
    expect(why.score).toBe(0)
  })

  it('respects custom weights', () => {
    const why = recipeWhy(recipe('r8', 'Fish', ['chicken']), taste, {
      ingredientMagnitude: 1,
      dislikedCuisinePenalty: 2,
    })
    // chicken (+1) + disliked Fish (-2) = -1
    expect(why.score).toBeCloseTo(-1)
  })

  it('ignores cuisine that is neither loved nor disliked', () => {
    const why = recipeWhy(recipe('r9', 'Thai', []), taste)
    expect(why.signals).toEqual([])
  })

  it('only counts an ingredient token once even if it appears twice', () => {
    const why = recipeWhy(
      recipe('r10', null, ['chicken thigh', 'chicken stock']),
      taste,
    )
    expect(
      why.signals.filter((s) => s.kind === 'loved-ingredient'),
    ).toHaveLength(1)
  })
})

describe('recipeWhys', () => {
  it('preserves the recommender order', () => {
    const recipes = [
      recipe('a', 'Greek', []),
      recipe('b', 'Mexican', []),
      recipe('c', null, ['chicken']),
    ]
    const out = recipeWhys(recipes, taste)
    expect(out.map((w) => w.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('ingredientSupport', () => {
  it('counts how many liked recipes contain each wanted token', () => {
    const liked = [
      recipe('a', null, ['chicken breast']),
      recipe('b', null, ['Chicken Thigh', 'rice']),
      recipe('c', null, ['beef']),
    ]
    const counts = ingredientSupport(liked, ['chicken', 'beef'])
    expect(counts.get('chicken')).toBe(2)
    expect(counts.get('beef')).toBe(1)
  })

  it('ignores tokens not in the wanted set', () => {
    const counts = ingredientSupport([recipe('a', null, ['rice'])], ['chicken'])
    expect(counts.has('rice')).toBe(false)
  })
})

describe('shapePreferences', () => {
  it('keeps cuisine net weight and attaches ingredient support counts', () => {
    const liked = [
      recipe('a', 'Mexican', ['chicken breast']),
      recipe('b', 'Mexican', ['chicken stock']),
    ]
    const prefs = shapePreferences(taste, liked)
    expect(prefs.lovedCuisines).toEqual([{ token: 'Mexican', support: 5 }])
    expect(prefs.lovedIngredients).toEqual([{ token: 'chicken', support: 2 }])
    expect(prefs.dislikedCuisines).toEqual(['Fish'])
    expect(prefs.dislikedIngredients).toEqual(['anchovy'])
  })

  it('reports zero support when no liked recipe carries the ingredient', () => {
    const prefs = shapePreferences(taste, [recipe('a', null, ['tofu'])])
    expect(prefs.lovedIngredients).toEqual([{ token: 'chicken', support: 0 }])
  })
})
