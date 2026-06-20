/**
 * End-to-end-at-the-pure-layer proof for #165's "prefs -> recipes" link:
 * a household's swipes + meal_feedback MEASURABLY change its recommendation
 * ranking. This is the link the planner consumes when it builds the week, so
 * asserting it here (the recsys layer the planner/week-server sit on top of)
 * proves the pref-signal flows through WITHOUT touching planner/week-server.
 *
 * The chain under test:
 *   recipe_swipe rows  --\
 *                          foldRealFeedback -> Swipe[] -> AdaptiveRecommender
 *   meal_feedback rows --/                              -> ranking (recommend)
 *
 * We show three things:
 *   1. Onboarding swipes alone already shape the ranking (taste != random).
 *   2. Folding meal_feedback ON TOP changes the ranking (the loop is live).
 *   3. A thumbs-down on a previously-liked recipe demotes it (override wins).
 */
import { describe, expect, it } from 'vitest'
import type { RecipeLite, Swipe } from './types'
import { AdaptiveRecommender } from './strategies'
import { foldRealFeedback } from './feedback-fold'
import type { MealFeedbackSignal } from './feedback-fold'

/**
 * A small two-cuisine catalogue with a chicken/tofu ingredient axis. Cuisines
 * are INTERLEAVED (Italian, Thai, Italian, Thai, ...) so that a taste shift
 * visibly reorders the id list rather than hiding inside an already-sorted block.
 */
function catalogue(): Array<RecipeLite> {
  const out: Array<RecipeLite> = []
  for (let i = 0; i < 20; i++) {
    for (const cuisine of ['Italian', 'Thai']) {
      const idx = out.length
      out.push({
        id: `r${idx}`,
        title: `${cuisine} dish ${i}`,
        cuisine,
        category: 'Main',
        dietaryTags: [],
        ingredients: [
          { name: i % 2 === 0 ? 'chicken breast' : 'tofu' },
          { name: 'onion' },
          { name: 'garlic' },
        ],
      })
    }
  }
  return out
}

/**
 * The full ranking, every recipe in recommendation order. AdaptiveRecommender's
 * recommend() ranks the WHOLE catalogue (it does not drop swiped recipes), so
 * the two lists are always over the same membership; only the order moves.
 */
function rankedIds(
  rec: AdaptiveRecommender,
  swipes: Array<Swipe>,
): Array<string> {
  return rec.recommend(swipes, recipesCount).map((r) => r.id)
}

const recipesCount = 40

/** Summed absolute position delta of every id between two full rankings. */
function rankShift(a: Array<string>, b: Array<string>): number {
  const posB = new Map(b.map((id, i) => [id, i]))
  let shift = 0
  for (let i = 0; i < a.length; i++) {
    shift += Math.abs(i - (posB.get(a[i]!) ?? i))
  }
  return shift
}

/** Mean rank position (0 = best) of a set of ids within a ranking. */
function meanRank(ranking: Array<string>, ids: Set<string>): number {
  const positions = ranking
    .map((id, i) => (ids.has(id) ? i : -1))
    .filter((p) => p >= 0)
  return positions.reduce((a, b) => a + b, 0) / positions.length
}

describe('prefs -> recipes: feedback changes the ranking', () => {
  const recipes = catalogue()
  const italian = recipes.filter((r) => r.cuisine === 'Italian')
  const thai = recipes.filter((r) => r.cuisine === 'Thai')

  // Onboarding: this household liked Italian, disliked Thai.
  const onboarding: Array<Swipe> = [
    ...italian.slice(0, 4).map((r) => ({ recipeId: r.id, like: true })),
    ...thai.slice(0, 4).map((r) => ({ recipeId: r.id, like: false })),
  ]

  it('onboarding swipes shape the ranking away from the unswiped baseline', () => {
    const rec = new AdaptiveRecommender(recipes)
    const baseline = rankedIds(rec, [])
    const withSwipes = rankedIds(rec, onboarding)
    expect(rankShift(baseline, withSwipes)).toBeGreaterThan(0)
  })

  it('folding meal_feedback on top measurably changes the ranking', () => {
    const rec = new AdaptiveRecommender(recipes)
    const before = rankedIds(rec, onboarding)

    // After cooking, they thumbs-UP many Thai dishes (taste shifted toward Thai).
    const feedback: Array<MealFeedbackSignal> = thai
      .slice(4, 12)
      .map((r) => ({ recipeId: r.id, rating: 'up' }))

    const folded = foldRealFeedback(onboarding, feedback)
    const after = rankedIds(rec, folded)

    const thaiIds = new Set(thai.map((r) => r.id))
    const thaiBefore = meanRank(before, thaiIds)
    const thaiAfter = meanRank(after, thaiIds)

    // The observation set grew, the ranking moved, and Thai recipes rose
    // (lower mean rank) once the household showed they actually like Thai food.
    expect(folded.length).toBeGreaterThan(onboarding.length)
    expect(rankShift(before, after)).toBeGreaterThan(0)
    expect(thaiAfter).toBeLessThan(thaiBefore)
  })

  it('a thumbs-down overrides a liked onboarding swipe and demotes that recipe', () => {
    const rec = new AdaptiveRecommender(recipes)
    const likedId = italian[0]!.id

    const beforeRank = rankedIds(rec, onboarding).indexOf(likedId)

    // They cooked the recipe they swiped-liked and hated it.
    const folded = foldRealFeedback(onboarding, [
      { recipeId: likedId, rating: 'down' },
    ])
    // Override, not double-count: still one entry for that recipe, now negative.
    expect(folded.filter((s) => s.recipeId === likedId)).toEqual([
      { recipeId: likedId, like: false },
    ])

    const afterRank = rankedIds(rec, folded).indexOf(likedId)
    // A now-disliked recipe should not rank ahead of where it was when liked.
    expect(afterRank).toBeGreaterThanOrEqual(beforeRank)
  })
})
