/**
 * Folding REAL household feedback on top of the onboarding swipes.
 *
 * A live household produces two streams of taste signal:
 *   - onboarding `recipe_swipe` rows (the Tinder-style like/dislike/skip), and
 *   - post-meal `meal_feedback` rows (thumbs up/down after actually cooking it).
 *
 * Both reduce to the same thing the recommender already consumes: a `Swipe`
 * (`{ recipeId, like }`). A thumbs-up is an extra positive observation, a
 * thumbs-down an extra negative one. Thin v1: no separate model, no recency
 * weighting beyond last-write-wins. The post-meal signal is the stronger one
 * (they ate the dish, not just glanced at a card), so when a household has both
 * a swipe AND a meal-feedback on the SAME recipe, the meal feedback wins.
 *
 * This module is pure (no DB, no Worker deps) so it runs identically in the
 * benchmark, the unit tests, and the server fn. The synthetic-fixture benchmark
 * never calls it, so the frozen numbers are untouched.
 */
import type { Swipe } from './types'

/** A post-meal thumbs rating, as stored in `meal_feedback.rating`. */
export interface MealFeedbackSignal {
  recipeId: string
  /** 'up' | 'down' — anything else is ignored (no signal). */
  rating: string
}

/** Map a single meal-feedback rating to a swipe-equivalent, or null if neutral. */
export function mealFeedbackToSwipe(fb: MealFeedbackSignal): Swipe | null {
  if (fb.rating === 'up') return { recipeId: fb.recipeId, like: true }
  if (fb.rating === 'down') return { recipeId: fb.recipeId, like: false }
  return null
}

/**
 * Build the full observation set for a household: onboarding swipes with the
 * real meal feedback folded on top.
 *
 * Rules:
 *   - Onboarding swipes are kept in order.
 *   - Each `up`/`down` meal feedback becomes an extra swipe.
 *   - On a per-recipe conflict (a swipe AND a meal feedback for the same recipe),
 *     the meal feedback wins — it is the stronger, more recent signal (they
 *     cooked it). The onboarding swipe for that recipe is replaced in place so
 *     the recipe is never double-counted.
 *   - Multiple meal-feedback rows for one recipe: the LAST one in the array wins
 *     (callers pass them oldest-first, so the most recent thumbs is honoured).
 *
 * Passing an empty `feedback` array returns the onboarding swipes unchanged —
 * that is the "without real feedback" baseline the console compares against.
 */
export function foldRealFeedback(
  onboardingSwipes: Array<Swipe>,
  feedback: Array<MealFeedbackSignal>,
): Array<Swipe> {
  // Collapse meal feedback to one swipe per recipe (last wins).
  const fbByRecipe = new Map<string, Swipe>()
  for (const fb of feedback) {
    const swipe = mealFeedbackToSwipe(fb)
    if (swipe) fbByRecipe.set(swipe.recipeId, swipe)
  }

  if (fbByRecipe.size === 0) return [...onboardingSwipes]

  const result: Array<Swipe> = []
  const consumed = new Set<string>()

  // Keep onboarding swipes in order, replacing any that meal feedback overrides.
  for (const s of onboardingSwipes) {
    const override = fbByRecipe.get(s.recipeId)
    if (override) {
      result.push(override)
      consumed.add(s.recipeId)
    } else {
      result.push(s)
    }
  }

  // Append meal feedback for recipes the household never swiped during onboarding.
  for (const [recipeId, swipe] of fbByRecipe) {
    if (!consumed.has(recipeId)) result.push(swipe)
  }

  return result
}

/** How many extra (net-new) observations the real feedback adds over onboarding. */
export interface FoldStats {
  /** Onboarding swipes count. */
  onboarding: number
  /** Meal-feedback rows that carried a usable up/down signal. */
  feedbackSignals: number
  /** Recipes where meal feedback overrode an onboarding swipe. */
  overrides: number
  /** Recipes seen only via meal feedback (net-new observations). */
  netNew: number
  /** Final observation-set size (onboarding + netNew). */
  total: number
}

/** Describe the effect of folding, for the admin console's "what changed" line. */
export function foldStats(
  onboardingSwipes: Array<Swipe>,
  feedback: Array<MealFeedbackSignal>,
): FoldStats {
  const onboardingIds = new Set(onboardingSwipes.map((s) => s.recipeId))
  const fbByRecipe = new Map<string, Swipe>()
  for (const fb of feedback) {
    const swipe = mealFeedbackToSwipe(fb)
    if (swipe) fbByRecipe.set(swipe.recipeId, swipe)
  }
  let overrides = 0
  let netNew = 0
  for (const recipeId of fbByRecipe.keys()) {
    if (onboardingIds.has(recipeId)) overrides += 1
    else netNew += 1
  }
  return {
    onboarding: onboardingSwipes.length,
    feedbackSignals: fbByRecipe.size,
    overrides,
    netNew,
    total: onboardingSwipes.length + netNew,
  }
}
