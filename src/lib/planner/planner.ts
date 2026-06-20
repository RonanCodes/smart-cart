import type { Swipe, SoftScoreWeights } from '../recsys/types'
import { makeRecommender } from '../recsys/registry'
import { DEFAULT_ADAPTIVE_WEIGHTS, DEFAULT_ALGORITHM } from '../recsys/config'
import type {
  DayType,
  PlanOptions,
  PlannedDay,
  PlannedWeek,
  PlannerProfile,
  PlannerRecipe,
} from './types'
import { BUSY_PREP_CAP_MINUTES } from './types'

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
export function softScore(
  r: PlannerRecipe,
  profile: PlannerProfile,
  /** Nudge weights; default reproduces the original 0.3 / 0.2 / 0.2 literals. */
  soft: SoftScoreWeights = DEFAULT_ADAPTIVE_WEIGHTS.soft,
): number {
  let s = 0

  if (profile.caloriesPerDay && r.calories != null) {
    // Assume dinner is roughly 40% of the day's calories.
    const target = profile.caloriesPerDay * 0.4
    const diff = Math.abs(r.calories - target) / target
    // 0 diff -> +calorie weight, one target away or more -> 0.
    s += soft.calorie * Math.max(0, 1 - diff)
  }

  if (r.protein != null) {
    // 40g+ protein dinner -> +protein weight, scaling linearly from 0.
    s += soft.protein * Math.min(1, r.protein / 40)
  }

  if (r.prepMinutes != null) {
    // 15 min or less -> +prep weight, 45 min or more -> 0.
    const lift = Math.max(0, 1 - Math.max(0, r.prepMinutes - 15) / 30)
    s += soft.prep * lift
  }

  return s
}

/**
 * Resolve the type of each day for a `days`-long week.
 *
 * Precedence:
 *  1. An explicit `dayTypes` override (from the week-view toggle or onboarding),
 *     position i = day i. A shorter override falls back to the cook-days rhythm
 *     for the days it does not cover.
 *  2. The cook-days rhythm: a day whose index (0=Mon..6=Sun) is in
 *     `profile.cookDays` is 'home'; any other day is 'out'.
 *  3. When `cookDays` is empty or absent, every day is 'home' (cook every day).
 *
 * Days repeat the 0..6 index when `days` > 7, mirroring how the week labels wrap.
 */
export function resolveDayTypes(
  days: number,
  profile: PlannerProfile,
  override?: Array<DayType>,
): Array<DayType> {
  const cookDays = profile.cookDays ?? []
  const everyDayHome = cookDays.length === 0
  const cookSet = new Set(cookDays)

  return Array.from({ length: days }, (_, i) => {
    const fromOverride = override?.[i]
    if (fromOverride) return fromOverride
    if (everyDayHome) return 'home'
    return cookSet.has(i % 7) ? 'home' : 'out'
  })
}

/** True when a recipe is quick enough for a 'busy' day. Unknown prep is treated
 * as not-quick, so it only lands on a busy day via the shortest-available fallback. */
function fitsBusy(r: PlannerRecipe): boolean {
  return r.prepMinutes != null && r.prepMinutes <= BUSY_PREP_CAP_MINUTES
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
  const algorithm = options.algorithm ?? DEFAULT_ALGORITHM
  const weights = options.weights ?? DEFAULT_ADAPTIVE_WEIGHTS

  const candidates = hardFilter(recipes, profile)

  // Rank the full candidate pool by the configured preference algorithm, seeded by
  // the swipes. We pass the candidates (not the whole catalogue) so hard-filtered
  // recipes are never returned, and ask for every candidate ranked so we can apply
  // the soft nudge over the full order. The default algorithm + weights reproduce
  // today's adaptive behaviour exactly.
  const recommender = makeRecommender(algorithm, candidates, seed, weights)
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
    score: ranked.length - i + softScore(r, profile, weights.soft),
    index: i,
  }))

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    // Stable tie-break on original rank, then id, so the week is deterministic.
    if (a.index !== b.index) return a.index - b.index
    return a.recipe.id < b.recipe.id ? -1 : 1
  })

  // The preference-ordered pool we walk to fill each day. Walking the same order
  // for every day keeps the no-repeat rule (a `used` set) and the deterministic
  // pick. Each day only takes the highest-ranked recipe that FITS its type.
  const pool = scored.map((s) => s.recipe)
  const dayTypes = resolveDayTypes(days, profile, options.dayTypes)

  const used = new Set<string>()
  const planned: Array<PlannedDay> = []

  for (let i = 0; i < days; i++) {
    const day = WEEK_DAYS[i % WEEK_DAYS.length]!
    const type = dayTypes[i]!

    // 'out' clears the day: no recipe, no pool consumption.
    if (type === 'out') {
      planned.push({ day, meal: '', recipeRef: '', type })
      continue
    }

    // 'busy' = quick only (prep <= 25 min). 'home' = any length. Within the
    // time constraint the order is pure preference, and we never repeat a recipe.
    const wantsQuick = type === 'busy'
    let pick = pool.find((r) => !used.has(r.id) && (!wantsQuick || fitsBusy(r)))

    // Graceful fallback: a busy cook-day must never be left empty. If nothing
    // quick is left, take the shortest unused recipe (unknown prep counts as
    // longest, so a timed recipe is always preferred over an untimed one).
    if (!pick && wantsQuick) {
      pick = pool
        .filter((r) => !used.has(r.id))
        .sort((a, b) => {
          const pa = a.prepMinutes ?? Number.POSITIVE_INFINITY
          const pb = b.prepMinutes ?? Number.POSITIVE_INFINITY
          if (pa !== pb) return pa - pb
          // Stable tie-break by id so the fallback stays deterministic.
          return a.id < b.id ? -1 : 1
        })[0]
    }

    if (!pick) {
      // Pool exhausted (more home/busy days than distinct recipes). Leave empty
      // rather than repeat, the no-repeat invariant wins.
      planned.push({ day, meal: '', recipeRef: '', type })
      continue
    }

    used.add(pick.id)
    planned.push({ day, meal: pick.title, recipeRef: pick.id, type })
  }

  return { days: planned }
}
