import type { Swipe } from '../recsys/types'
import { AdaptiveRecommender } from '../recsys/strategies'
import type {
  PlanOptions,
  PlannedWeek,
  PlannerProfile,
  PlannerRecipe,
} from './types'

/** Monday first, the week always starts Monday (CONTEXT.md hard rule). */
const WEEK_DAYS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
]

/**
 * Diets that forbid meat. A vegetarian or vegan household never sees a recipe
 * that is not tagged accordingly, this is a hard filter, not a nudge.
 */
const VEG_DIETS = new Set(['vegetarian', 'vegan'])

function normalise(s: string): string {
  return s.toLowerCase().trim()
}

/** Every ingredient word of a recipe, lowercased, for allergy matching. */
function ingredientText(r: PlannerRecipe): string {
  return r.ingredients.map((i) => normalise(i.name)).join(' ')
}

/**
 * Hard filter. A recipe is a candidate only if it clears BOTH gates:
 *  - allergies: no allergen string appears in any ingredient name.
 *  - diet: if the household is vegetarian or vegan, the recipe must carry the
 *    matching dietary tag.
 * These recipes are never candidates, so the soft scoring below can never bring
 * them back. We also keep only dinners, the planner plans dinners.
 */
export function hardFilter(
  recipes: Array<PlannerRecipe>,
  profile: PlannerProfile,
): Array<PlannerRecipe> {
  const allergies = (profile.allergies ?? []).map(normalise).filter(Boolean)
  const diet = profile.diet ? normalise(profile.diet) : null
  const needsVegTag = diet && VEG_DIETS.has(diet) ? diet : null

  return recipes.filter((r) => {
    if (r.mealType !== 'dinner') return false
    if (needsVegTag) {
      const tags = r.dietaryTags.map(normalise)
      // Vegans accept vegan recipes; vegetarians accept vegetarian or vegan.
      const ok =
        needsVegTag === 'vegan'
          ? tags.includes('vegan')
          : tags.includes('vegetarian') || tags.includes('vegan')
      if (!ok) return false
    }
    if (allergies.length) {
      const text = ingredientText(r)
      if (allergies.some((a) => text.includes(a))) return false
    }
    return true
  })
}

/**
 * Soft nudge. NOT a filter, the pool is never emptied by it. Returns a small
 * adjustment in [-1, 1]-ish range so it only reorders recipes the recommender
 * already rated close together; the preference order stays dominant. The nudges:
 *  - calorie goal: prefer recipes near (caloriesPerDay / mealsPerDay).
 *  - protein: a mild lift for higher-protein dinners.
 *  - prep time: a mild lift for quicker dinners (the household saves time, that
 *    is the whole job, see CONTEXT.md).
 * Recipes missing a field get a neutral 0 for that term, never a penalty.
 */
export function softScore(r: PlannerRecipe, profile: PlannerProfile): number {
  let s = 0

  if (profile.caloriesPerDay && r.calories != null) {
    // Assume dinner is roughly 40% of the day's calories.
    const target = profile.caloriesPerDay * 0.4
    const diff = Math.abs(r.calories - target) / target
    // 0 diff -> +0.3, one target away or more -> 0.
    s += 0.3 * Math.max(0, 1 - diff)
  }

  if (r.protein != null) {
    // 40g+ protein dinner -> +0.2, scaling linearly from 0.
    s += 0.2 * Math.min(1, r.protein / 40)
  }

  if (r.prepMinutes != null) {
    // 15 min or less -> +0.2, 45 min or more -> 0.
    const lift = Math.max(0, 1 - Math.max(0, r.prepMinutes - 15) / 30)
    s += 0.2 * lift
  }

  return s
}

/**
 * Generate a week of dinners for a household.
 *
 * Policy (grilled 2026-06-19, CONTEXT.md "Planner policy"):
 *  - Pure preference. Rank the FULL catalogue with the adaptive recommender,
 *    seeded by the onboarding swipes. No cuisine-variety constraint, a pasta
 *    person gets a pasta week.
 *  - Allergies and diet are hard filters (done first, those recipes never
 *    become candidates). Calorie goal, protein and prep time are soft nudges.
 *  - The only de-dup is: never the same recipe twice in one week.
 *  - The week always fills its days; soft scoring never empties the pool.
 *
 * Deterministic: same recipes + same profile + same swipes + same seed always
 * yields the same week (the recommender and the tie-breaks are seed-stable).
 */
export function generateWeek(
  recipes: Array<PlannerRecipe>,
  profile: PlannerProfile,
  swipes: Array<{ recipeId: string; like: boolean }>,
  options: PlanOptions = {},
): PlannedWeek {
  const days = options.days ?? 7
  const seed = options.seed ?? 42

  const candidates = hardFilter(recipes, profile)

  // Rank the full candidate pool by adaptive preference, seeded by the swipes.
  // We pass the candidates (not the whole catalogue) so hard-filtered recipes
  // are never returned, and ask for every candidate ranked so we can apply the
  // soft nudge over the full order.
  const recommender = new AdaptiveRecommender(candidates, seed)
  const swipeSignal: Array<Swipe> = swipes.map((s) => ({
    recipeId: s.recipeId,
    like: s.like,
  }))
  // The recommender returns RecipeLite; map back to the PlannerRecipe candidates
  // (which carry the soft-scoring fields) by id, preserving the ranked order.
  const byId = new Map(candidates.map((r) => [r.id, r]))
  const ranked = recommender
    .recommend(swipeSignal, candidates.length)
    .map((r) => byId.get(r.id))
    .filter((r): r is PlannerRecipe => r != null)

  // Preference is the dominant axis. Convert rank position to a descending score
  // (top of the list = highest), then add the small soft nudge. The position
  // gap (1 per slot) dwarfs the soft term (< ~0.7 total) for distant recipes, so
  // the nudge only ever reshuffles recipes already adjacent in preference.
  const scored = ranked.map((r, i) => ({
    recipe: r,
    // Higher is better. Rank 0 -> ranked.length, last -> 1.
    score: ranked.length - i + softScore(r, profile),
    index: i,
  }))

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    // Stable tie-break on original rank, then id, so the week is deterministic.
    if (a.index !== b.index) return a.index - b.index
    return a.recipe.id < b.recipe.id ? -1 : 1
  })

  // Pick the top `days`, never repeating a recipe (the only de-dup rule).
  const picks: Array<PlannerRecipe> = []
  const used = new Set<string>()
  for (const { recipe } of scored) {
    if (picks.length >= days) break
    if (used.has(recipe.id)) continue
    used.add(recipe.id)
    picks.push(recipe)
  }

  return {
    days: picks.map((r, i) => ({
      day: WEEK_DAYS[i % WEEK_DAYS.length]!,
      meal: r.title,
      recipeRef: r.id,
    })),
  }
}
