import { describe, expect, it } from 'vitest'
import type { RecipeLite, Swipe } from './types'
import {
  foldRealFeedback,
  foldStats,
  mealFeedbackToSwipe,
} from './feedback-fold'
import { AdaptiveRecommender } from './strategies'

describe('mealFeedbackToSwipe', () => {
  it('maps thumbs-up to a positive swipe', () => {
    expect(mealFeedbackToSwipe({ recipeId: 'r1', rating: 'up' })).toEqual({
      recipeId: 'r1',
      like: true,
    })
  })

  it('maps thumbs-down to a negative swipe', () => {
    expect(mealFeedbackToSwipe({ recipeId: 'r1', rating: 'down' })).toEqual({
      recipeId: 'r1',
      like: false,
    })
  })

  it('ignores a rating that is neither up nor down', () => {
    expect(mealFeedbackToSwipe({ recipeId: 'r1', rating: 'meh' })).toBeNull()
  })
})

describe('foldRealFeedback', () => {
  const onboarding: Array<Swipe> = [
    { recipeId: 'a', like: true },
    { recipeId: 'b', like: false },
    { recipeId: 'c', like: true },
  ]

  it('returns onboarding swipes unchanged when there is no real feedback', () => {
    expect(foldRealFeedback(onboarding, [])).toEqual(onboarding)
  })

  it('returns a copy, not the same array reference', () => {
    const out = foldRealFeedback(onboarding, [])
    expect(out).not.toBe(onboarding)
  })

  it('appends net-new feedback as extra observations', () => {
    const out = foldRealFeedback(onboarding, [
      { recipeId: 'd', rating: 'up' },
      { recipeId: 'e', rating: 'down' },
    ])
    expect(out).toHaveLength(5)
    expect(out).toContainEqual({ recipeId: 'd', like: true })
    expect(out).toContainEqual({ recipeId: 'e', like: false })
  })

  it('lets meal feedback override an onboarding swipe on the same recipe', () => {
    // Onboarding liked "a"; after cooking it they thumbs-down it.
    const out = foldRealFeedback(onboarding, [
      { recipeId: 'a', rating: 'down' },
    ])
    expect(out).toHaveLength(3) // no double-count
    const aEntries = out.filter((s) => s.recipeId === 'a')
    expect(aEntries).toEqual([{ recipeId: 'a', like: false }])
  })

  it('keeps onboarding order when overriding in place', () => {
    const out = foldRealFeedback(onboarding, [{ recipeId: 'b', rating: 'up' }])
    expect(out.map((s) => s.recipeId)).toEqual(['a', 'b', 'c'])
    expect(out[1]).toEqual({ recipeId: 'b', like: true })
  })

  it('honours the LAST meal feedback on a recipe (most recent wins)', () => {
    const out = foldRealFeedback(
      [{ recipeId: 'x', like: true }],
      [
        { recipeId: 'x', rating: 'down' },
        { recipeId: 'x', rating: 'up' },
      ],
    )
    expect(out).toEqual([{ recipeId: 'x', like: true }])
  })

  it('skips neutral ratings entirely', () => {
    const out = foldRealFeedback(onboarding, [
      { recipeId: 'z', rating: 'skip' },
    ])
    expect(out).toEqual(onboarding)
  })
})

describe('foldStats', () => {
  const onboarding: Array<Swipe> = [
    { recipeId: 'a', like: true },
    { recipeId: 'b', like: false },
  ]

  it('reports zero effect with no feedback', () => {
    expect(foldStats(onboarding, [])).toEqual({
      onboarding: 2,
      feedbackSignals: 0,
      overrides: 0,
      netNew: 0,
      total: 2,
    })
  })

  it('counts overrides vs net-new observations', () => {
    const stats = foldStats(onboarding, [
      { recipeId: 'a', rating: 'down' }, // override
      { recipeId: 'c', rating: 'up' }, // net-new
      { recipeId: 'd', rating: 'down' }, // net-new
      { recipeId: 'e', rating: 'meh' }, // ignored
    ])
    expect(stats).toEqual({
      onboarding: 2,
      feedbackSignals: 3,
      overrides: 1,
      netNew: 2,
      total: 4,
    })
  })
})

/**
 * The pref -> recipe -> ranking link, end-to-end (#165 part 3).
 *
 * The recsys unit tests already prove swipes -> ranking. This block proves the
 * load-bearing #165 claim explicitly: a household's REAL meal feedback, folded
 * on top of onboarding swipes, MEASURABLY changes which recipes the recommender
 * ranks for their week. We feed the folded observation set into the same
 * AdaptiveRecommender the live planner uses and assert the top-N ranking moves.
 */
describe('pref -> ranking link: folded feedback changes the week', () => {
  /** Two-cuisine catalogue so a taste flip is observable in the ranking. */
  function catalogue(): Array<RecipeLite> {
    const out: Array<RecipeLite> = []
    let id = 0
    for (const cuisine of ['Italian', 'Thai']) {
      for (let i = 0; i < 12; i++) {
        out.push({
          id: `${cuisine.toLowerCase()}-${id++}`,
          title: `${cuisine} dish ${i}`,
          cuisine,
          category: 'Main',
          dietaryTags: [],
          ingredients: [{ name: 'onion' }, { name: 'garlic' }],
        })
      }
    }
    return out
  }

  const recipes = catalogue()
  const italianIds = recipes
    .filter((r) => r.cuisine === 'Italian')
    .map((r) => r.id)

  /** Onboarding: this household liked Italian, disliked Thai. */
  const onboarding: Array<Swipe> = recipes.map((r) => ({
    recipeId: r.id,
    like: r.cuisine === 'Italian',
  }))

  function topIds(swipes: Array<Swipe>, n: number): Array<string> {
    const rec = new AdaptiveRecommender(recipes)
    return rec.recommend(swipes, n).map((r) => r.id)
  }

  it('feedback that flips taste reorders the week ranking', () => {
    // After cooking, they thumbs-DOWN every Italian dish and thumbs-UP Thai.
    const feedback = recipes.map((r) => ({
      recipeId: r.id,
      rating: r.cuisine === 'Italian' ? 'down' : 'up',
    }))

    const before = topIds(onboarding, 6)
    const folded = foldRealFeedback(onboarding, feedback)
    const after = topIds(folded, 6)

    // The folded observation set is a real taste flip, so the top-6 must change.
    expect(after).not.toEqual(before)
    // And it must move TOWARDS the newly-loved cuisine: more Thai than before.
    const thaiBefore = before.filter((id) => !italianIds.includes(id)).length
    const thaiAfter = after.filter((id) => !italianIds.includes(id)).length
    expect(thaiAfter).toBeGreaterThan(thaiBefore)
  })

  it('no feedback leaves the week ranking unchanged (baseline)', () => {
    const before = topIds(onboarding, 6)
    const after = topIds(foldRealFeedback(onboarding, []), 6)
    expect(after).toEqual(before)
  })
})
