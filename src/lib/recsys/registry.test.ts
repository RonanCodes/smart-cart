import { describe, expect, it } from 'vitest'
import type { AdaptiveWeights, RecipeLite, Swipe } from './types'
import { isRegistered, makeRecommender, registeredKeys } from './registry'
import { DEFAULT_ADAPTIVE_WEIGHTS } from './config'
import { AdaptiveRecommender } from './strategies'

/** A small synthetic catalogue: 4 cuisines, an ingredient axis (chicken/tofu). */
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
      })
    }
  }
  return out
}

/** Like Italian, dislike Mexican; a clear cuisine signal to score against. */
function sampleSwipes(recipes: Array<RecipeLite>): Array<Swipe> {
  return recipes
    .filter((r) => r.cuisine === 'Italian' || r.cuisine === 'Mexican')
    .slice(0, 20)
    .map((r) => ({ recipeId: r.id, like: r.cuisine === 'Italian' }))
}

describe('recsys registry', () => {
  const recipes = catalogue()

  it('registers all six strategies under their keys', () => {
    expect(registeredKeys()).toEqual([
      'random',
      'maths',
      'vector',
      'hybrid',
      'adaptive',
      'bayesian',
    ])
    for (const key of [
      'random',
      'maths',
      'vector',
      'hybrid',
      'adaptive',
      'bayesian',
    ]) {
      expect(isRegistered(key)).toBe(true)
    }
    expect(isRegistered('nope')).toBe(false)
  })

  it('makeRecommender builds a recommender whose name matches its key', () => {
    for (const key of registeredKeys()) {
      const rec = makeRecommender(key, recipes)
      expect(rec.name).toBe(key)
      // It produces a non-empty ranking from swipes.
      expect(rec.recommend(sampleSwipes(recipes), 5).length).toBeGreaterThan(0)
    }
  })

  it('throws on an unknown key', () => {
    expect(() => makeRecommender('bayesian', recipes)).toThrow(
      /Unknown recommender/,
    )
  })

  it('adaptive at default weights matches the AdaptiveRecommender directly', () => {
    const swipes = sampleSwipes(recipes)
    const viaRegistry = makeRecommender('adaptive', recipes)
      .recommend(swipes, 20)
      .map((r) => r.id)
    const viaClass = new AdaptiveRecommender(recipes)
      .recommend(swipes, 20)
      .map((r) => r.id)
    expect(viaRegistry).toEqual(viaClass)
  })

  it('omitting weights reproduces the explicit-default-weights ranking', () => {
    const swipes = sampleSwipes(recipes)
    const omitted = makeRecommender('adaptive', recipes)
      .recommend(swipes, 20)
      .map((r) => r.id)
    const explicit = makeRecommender(
      'adaptive',
      recipes,
      undefined,
      DEFAULT_ADAPTIVE_WEIGHTS,
    )
      .recommend(swipes, 20)
      .map((r) => r.id)
    expect(omitted).toEqual(explicit)
  })

  /**
   * A catalogue built so the ingredient magnitude competes directly against the
   * cuisine signal: "saffron" is rare (clears the idf gate) and is the confident
   * loved ingredient, while one whole cuisine is disliked. A recipe in the disliked
   * cuisine that carries saffron sits below a plain loved-cuisine recipe at the
   * default magnitude (cuisine wins) but ABOVE it once the magnitude is cranked
   * (ingredient wins). So the top of the ranking flips on the parameter.
   */
  function ingredientCatalogue(): Array<RecipeLite> {
    const out: Array<RecipeLite> = []
    // 50 Persian (will be loved) and 50 Greek (will be disliked). 5 of the Greek
    // recipes carry "saffron" (df 5, below the 100 * 0.12 = 12 gate, so distinctive).
    for (let i = 0; i < 50; i++) {
      out.push({
        id: `p${i}`,
        title: `persian ${i}`,
        cuisine: 'Persian',
        category: 'Main',
        dietaryTags: [],
        ingredients: [{ name: 'pepper' }, { name: 'salt' }],
      })
    }
    for (let i = 0; i < 50; i++) {
      out.push({
        id: `g${i}`,
        title: `greek ${i}`,
        cuisine: 'Greek',
        category: 'Main',
        dietaryTags: [],
        ingredients: [
          ...(i < 5 ? [{ name: 'saffron' }] : [{ name: 'pepper' }]),
          { name: 'salt' },
        ],
      })
    }
    return out
  }

  it('overriding the ingredient magnitude changes adaptive scoring', () => {
    const recs = ingredientCatalogue()
    // Persian net +2 (loved), Greek net -1 (disliked), saffron liked twice never
    // disliked (confident loved ingredient). g0/g1 carry saffron; g5..g9 do not.
    const swipes: Array<Swipe> = [
      { recipeId: 'p0', like: true },
      { recipeId: 'p1', like: true },
      { recipeId: 'g0', like: true },
      { recipeId: 'g1', like: true },
      { recipeId: 'g5', like: false },
      { recipeId: 'g6', like: false },
      { recipeId: 'g7', like: false },
    ]
    const tuned: AdaptiveWeights = {
      ...DEFAULT_ADAPTIVE_WEIGHTS,
      ingredientMagnitude: 50,
    }
    const top = (w?: AdaptiveWeights) =>
      makeRecommender('adaptive', recs, undefined, w).recommend(swipes, 1)[0]
        ?.id
    // Default magnitude (0.5): a plain Persian (loved cuisine) recipe leads, since
    // +cuisine outweighs a small ingredient bump on a disliked-cuisine recipe.
    expect(top()).toMatch(/^p/)
    // Cranked magnitude (50): a saffron Greek recipe leads despite the disliked
    // cuisine, proving the ingredient magnitude is a live parameter.
    expect(top(tuned)).toMatch(/^g/)
  })

  it('overriding the idf gate changes which ingredients count as distinctive', () => {
    // A catalogue where "saffron" is loved-only (liked twice, never disliked) but
    // appears in 30% of recipes. At the default 0.12 gate it sits above the gate and
    // is ignored; widen the gate to 0.5 and it becomes a distinctive loved signal.
    const recs: Array<RecipeLite> = []
    for (let i = 0; i < 100; i++) {
      const hasSaffron = i < 30
      recs.push({
        id: `x${i}`,
        title: `dish ${i}`,
        cuisine: i % 2 === 0 ? 'Persian' : 'Other',
        category: 'Main',
        dietaryTags: [],
        ingredients: [
          ...(hasSaffron ? [{ name: 'saffron' }] : [{ name: 'pepper' }]),
          { name: 'salt' },
        ],
      })
    }
    // Like two saffron dishes; never dislike one.
    const swipes: Array<Swipe> = [
      { recipeId: 'x0', like: true },
      { recipeId: 'x2', like: true },
    ]
    const narrow = makeRecommender('adaptive', recs).explain(swipes)
    const wide = makeRecommender('adaptive', recs, undefined, {
      ...DEFAULT_ADAPTIVE_WEIGHTS,
      idfGate: 0.5,
    }).explain(swipes)
    expect(narrow.lovedIngredients).not.toContain('saffron')
    expect(wide.lovedIngredients).toContain('saffron')
  })
})
