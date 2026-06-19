import { describe, expect, it } from 'vitest'
import type { RecipeLite, Swipe, UserProfile } from './types'
import { AdaptiveRecommender, RandomRecommender } from './strategies'
import { simulateSwipe, trueTopN } from './ground-truth'

/** A small synthetic catalogue: 4 cuisines, an ingredient axis (chicken). */
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

function recall(got: Array<RecipeLite>, truth: Array<string>): number {
  if (truth.length === 0) return 1
  const t = new Set(truth)
  return (
    got.filter((r) => t.has(r.id)).length / Math.min(truth.length, got.length)
  )
}

function run(
  rec: {
    nextDeck: (s: Array<Swipe>, k: number) => Array<RecipeLite>
    recommend: (s: Array<Swipe>, n: number) => Array<RecipeLite>
  },
  user: UserProfile,
  swipeCount: number,
): Array<Swipe> {
  const swipes: Array<Swipe> = []
  while (swipes.length < swipeCount) {
    const deck = rec.nextDeck(swipes, 5)
    if (deck.length === 0) break
    for (const r of deck)
      swipes.push({ recipeId: r.id, like: simulateSwipe(user, r) })
  }
  return swipes
}

describe('recsys', () => {
  const recipes = catalogue()
  const user: UserProfile = {
    id: 'u',
    lovedCuisines: ['Italian'],
    dislikedCuisines: [],
    lovedIngredients: [],
    dislikedIngredients: [],
    vegetarian: false,
  }

  it('adaptive converges on a clear single-cuisine taste', () => {
    const rec = new AdaptiveRecommender(recipes)
    const swipes = run(rec, user, 20)
    const truth = trueTopN(user, recipes, 20)
    expect(recall(rec.recommend(swipes, 20), truth)).toBeGreaterThanOrEqual(0.7)
  })

  it('adaptive learns faster than random (more recall by 15 swipes)', () => {
    const adaptive = new AdaptiveRecommender(recipes)
    const random = new RandomRecommender(recipes)
    const truth = trueTopN(user, recipes, 20)
    const aRecall = recall(
      adaptive.recommend(run(adaptive, user, 15), 20),
      truth,
    )
    const rRecall = recall(random.recommend(run(random, user, 15), 20), truth)
    expect(aRecall).toBeGreaterThanOrEqual(rRecall)
  })

  it('explain surfaces the loved cuisine', () => {
    const rec = new AdaptiveRecommender(recipes)
    const taste = rec.explain(run(rec, user, 20))
    expect(taste.lovedCuisines[0]?.cuisine).toBe('Italian')
  })

  it('nextDeck never repeats an already-swiped recipe', () => {
    const rec = new AdaptiveRecommender(recipes)
    const swipes = run(rec, user, 15)
    const next = rec.nextDeck(swipes, 5)
    const seen = new Set(swipes.map((s) => s.recipeId))
    expect(next.every((r) => !seen.has(r.id))).toBe(true)
  })
})
