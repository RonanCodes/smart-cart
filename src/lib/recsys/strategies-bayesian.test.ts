import { describe, expect, it } from 'vitest'
import type { RecipeLite, Swipe } from './types'
import { BayesianRecommender } from './strategies-bayesian'

/**
 * A small synthetic catalogue with a clear cuisine axis and an ingredient axis,
 * so the Bayesian update has a learnable signal. Mirrors the registry test's shape.
 */
function catalogue(): Array<RecipeLite> {
  const cuisines = ['Italian', 'Thai', 'Mexican', 'Japanese']
  const out: Array<RecipeLite> = []
  let id = 0
  for (const cuisine of cuisines) {
    for (let i = 0; i < 25; i++) {
      const chicken = i % 2 === 0
      out.push({
        id: `r${id++}`,
        title: `${cuisine} dish ${i}`,
        cuisine,
        category: 'Main',
        dietaryTags: i % 5 === 0 ? ['vegetarian'] : [],
        ingredients: [
          { name: chicken ? 'chicken breast' : 'tofu' },
          { name: 'onion' },
          { name: 'garlic' },
        ],
        calories: 400 + (i % 4) * 100,
      })
    }
  }
  return out
}

/** Like every Italian recipe seen, dislike every Mexican one. */
function italianLoverSwipes(recipes: Array<RecipeLite>): Array<Swipe> {
  return recipes
    .filter((r) => r.cuisine === 'Italian' || r.cuisine === 'Mexican')
    .slice(0, 20)
    .map((r) => ({ recipeId: r.id, like: r.cuisine === 'Italian' }))
}

describe('BayesianRecommender', () => {
  const recipes = catalogue()

  it('exposes the registry name', () => {
    expect(new BayesianRecommender(recipes).name).toBe('bayesian')
  })

  it('liking a cuisine raises its recipes up the ranking', () => {
    const rec = new BayesianRecommender(recipes, 7)
    const swipes = italianLoverSwipes(recipes)
    const top = rec.recommend(swipes, 20)
    const italianInTop = top.filter((r) => r.cuisine === 'Italian').length
    const mexicanInTop = top.filter((r) => r.cuisine === 'Mexican').length
    // The liked cuisine should dominate the top of the ranking, the disliked one
    // should be pushed out.
    expect(italianInTop).toBeGreaterThan(mexicanInTop)
    expect(italianInTop).toBeGreaterThanOrEqual(10)
  })

  it('the highest-affinity recipe outranks a disliked-cuisine recipe', () => {
    const rec = new BayesianRecommender(recipes, 7)
    const swipes = italianLoverSwipes(recipes)
    const ranked = rec.recommend(swipes, recipes.length)
    const idx = (cuisine: string) =>
      ranked.findIndex((r) => r.cuisine === cuisine)
    // The first Italian recipe appears before the first Mexican one.
    expect(idx('Italian')).toBeLessThan(idx('Mexican'))
  })

  it('is deterministic given the same seed and swipes', () => {
    const swipes = italianLoverSwipes(recipes)
    const a = new BayesianRecommender(recipes, 7)
      .recommend(swipes, 20)
      .map((r) => r.id)
    const b = new BayesianRecommender(recipes, 7)
      .recommend(swipes, 20)
      .map((r) => r.id)
    expect(a).toEqual(b)
  })

  it('the deck is deterministic given the same seed', () => {
    const seed1 = italianLoverSwipes(recipes).slice(0, 5)
    const a = new BayesianRecommender(recipes, 7)
      .nextDeck(seed1, 5)
      .map((r) => r.id)
    const b = new BayesianRecommender(recipes, 7)
      .nextDeck(seed1, 5)
      .map((r) => r.id)
    expect(a).toEqual(b)
  })

  it('explain() reads the loved cuisine from the fitted posterior', () => {
    const rec = new BayesianRecommender(recipes, 7)
    const taste = rec.explain(italianLoverSwipes(recipes))
    const lovedTop = taste.lovedCuisines[0]?.cuisine
    // The cuisine group is the coarse token, not the raw cuisine string.
    expect(lovedTop).toBe('italian')
  })

  it('with no swipes the ranking is well-formed and stable', () => {
    const rec = new BayesianRecommender(recipes, 7)
    const top = rec.recommend([], 20)
    expect(top).toHaveLength(20)
    // No update has happened: theta is empty so every utility is 0 and the order is
    // the catalogue order. Stable and deterministic.
    expect(top.map((r) => r.id)).toEqual(recipes.slice(0, 20).map((r) => r.id))
  })

  it('a distinctive ingredient liked across cuisines lifts recipes carrying it', () => {
    // Tag a small minority of recipes (under the df gate) with a rare marker
    // ingredient, then like exactly the recipes that carry it. The Bayesian model
    // should learn a positive weight on the marker and lift those recipes.
    const marked = recipes.map((r, i) =>
      i % 5 === 0
        ? {
            ...r,
            ingredients: [...r.ingredients, { name: 'truffle' }],
          }
        : r,
    )
    const isMarked = (r: RecipeLite) =>
      r.ingredients.some((i) => i.name === 'truffle')
    const baseRate = marked.filter(isMarked).length / marked.length
    const rec = new BayesianRecommender(marked, 7)
    // Spread swipes across the whole catalogue (every 3rd recipe), so the like
    // signal is the marker ingredient and not a single cuisine that happens to sit
    // at the front of the list.
    const swipes: Array<Swipe> = marked
      .filter((_, i) => i % 3 === 0)
      .slice(0, 30)
      .map((r) => ({ recipeId: r.id, like: isMarked(r) }))
    const top = rec.recommend(swipes, 20)
    const markedInTop = top.filter(isMarked).length / 20
    // Liking the marker lifts marked recipes well above their catalogue base rate.
    expect(markedInTop).toBeGreaterThan(baseRate)
    expect(markedInTop).toBeGreaterThanOrEqual(0.5)
  })
})
