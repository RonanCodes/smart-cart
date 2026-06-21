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
 *  - cuisine: the explicit onboarding like/hate signal (replaces the swipe
 *    taste). A liked cuisine is lifted, a hated one is pushed down. Neutral
 *    cuisines and empty lists contribute 0, so the default behaviour and the
 *    frozen recsys regression fixture (which carries no explicit cuisine prefs)
 *    are unchanged.
 * Recipes missing a field get a neutral 0 for that term, never a penalty.
 */
export function softScore(
  r: PlannerRecipe,
  profile: PlannerProfile,
  /** Nudge weights; default reproduces the original 0.3 / 0.2 / 0.2 literals. */
  soft: SoftScoreWeights = DEFAULT_ADAPTIVE_WEIGHTS.soft,
): number {
  let s = 0

  // Explicit cuisine bias from onboarding. A liked cuisine lifts the recipe, a
  // hated one pushes it down; everything else is neutral. Both lists are matched
  // case-insensitively against the recipe's own cuisine. Empty lists -> 0.
  if (r.cuisine) {
    const cuisine = normalise(r.cuisine)
    const liked = (profile.cuisinesLiked ?? []).map(normalise)
    const disliked = (profile.cuisinesDisliked ?? []).map(normalise)
    if (liked.includes(cuisine)) s += soft.cuisine
    else if (disliked.includes(cuisine)) s -= soft.cuisine
  }

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
  override?: Array<DayType | undefined>,
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
 * Rank the household's candidate recipes into one preference-ordered pool.
 *
 * This is the shared core both `generateWeek` (which walks the pool to fill each
 * day) and `topNForDay` (which takes the top few alternatives for one day) build
 * on, so the week and the per-day alternatives agree on what "best for this
 * household" means.
 *
 * Steps:
 *  1. Hard filter (allergies + diet + dinners only) so forbidden recipes are
 *     never candidates.
 *  2. Rank the candidates with the configured preference algorithm, seeded by the
 *     onboarding swipes.
 *  3. Add the small soft nudge (calorie / protein / prep) and re-sort, so the
 *     nudge only reshuffles recipes already adjacent in preference.
 *
 * Deterministic: same recipes + profile + swipes + seed -> same order.
 */
export function rankRecipes(
  recipes: Array<PlannerRecipe>,
  profile: PlannerProfile,
  swipes: Array<{ recipeId: string; like: boolean }>,
  options: Pick<
    PlanOptions,
    'seed' | 'algorithm' | 'weights' | 'excludeRecipeIds'
  > = {},
): Array<PlannerRecipe> {
  const seed = options.seed ?? 42
  const algorithm = options.algorithm ?? DEFAULT_ALGORITHM
  const weights = options.weights ?? DEFAULT_ADAPTIVE_WEIGHTS

  const hardFiltered = hardFilter(recipes, profile)

  // Variety exclusion (#week-nav): drop recipes the caller wants kept out of the
  // pool entirely (e.g. last week's dinners, so a fresh next week differs). An
  // empty/absent set is a strict no-op, so the fresh-household first week and the
  // recsys regression fixture rank identically to before.
  const excluded =
    options.excludeRecipeIds && options.excludeRecipeIds.length
      ? new Set(options.excludeRecipeIds)
      : null
  const candidates = excluded
    ? hardFiltered.filter((r) => !excluded.has(r.id))
    : hardFiltered

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
    // Stable tie-break on original rank, then id, so the order is deterministic.
    if (a.index !== b.index) return a.index - b.index
    return a.recipe.id < b.recipe.id ? -1 : 1
  })

  return scored.map((s) => s.recipe)
}

/**
 * Top-N alternative recipes for ONE day of an existing week, pre-ranked for the
 * household. Powers the "tap a day -> pick from ~5 ready alternatives" edit: the
 * sheet opens instantly because these come from the same fast ranking the week
 * itself uses.
 *
 * Rules (so the picker never offers a duplicate or an unfit recipe):
 *  - Same hard filters + preference ranking as the week (via `rankRecipes`).
 *  - Exclude the day's current pick (`excludeRecipeId`) and every other recipe
 *    already placed in the week (`weekRecipeIds`), so picking an alternative can
 *    never create a repeat.
 *  - Respect the day's type: a 'busy' day only offers quick dinners (with the
 *    same shortest-available fallback `generateWeek` uses, so a busy day is never
 *    left with zero options when the catalogue has recipes left).
 *  - Return at most `n` (default 5), in preference order.
 *
 * Pure + deterministic, so it is unit-testable and instant on the client.
 */
export function topNForDay(
  recipes: Array<PlannerRecipe>,
  profile: PlannerProfile,
  swipes: Array<{ recipeId: string; like: boolean }>,
  params: {
    /** The day's current recipe id, always excluded. Empty/undefined for a skipped day. */
    excludeRecipeId?: string | null
    /** Every recipe id already in the week (incl. the current pick), all excluded. */
    weekRecipeIds?: Array<string>
    /** The day's type, so a busy day only offers quick dinners. Defaults to 'home'. */
    dayType?: DayType
    /** How many alternatives to return. Defaults to 5. */
    n?: number
    seed?: number
    algorithm?: string
    weights?: PlanOptions['weights']
  } = {},
): Array<PlannerRecipe> {
  const n = params.n ?? 5
  const dayType = params.dayType ?? 'home'

  // An 'out' day has no dinner to swap, so it has no alternatives.
  if (dayType === 'out') return []

  const excluded = new Set<string>(params.weekRecipeIds ?? [])
  if (params.excludeRecipeId) excluded.add(params.excludeRecipeId)

  const ranked = rankRecipes(recipes, profile, swipes, params)
  const available = ranked.filter((r) => !excluded.has(r.id))

  const wantsQuick = dayType === 'busy'
  let pool = wantsQuick ? available.filter(fitsBusy) : available

  // Graceful fallback, mirroring generateWeek: a busy day must still offer
  // something when nothing quick is left. Fall back to the shortest available
  // recipes (unknown prep counts as longest), still excluding the week's recipes.
  if (wantsQuick && pool.length === 0) {
    pool = [...available].sort((a, b) => {
      const pa = a.prepMinutes ?? Number.POSITIVE_INFINITY
      const pb = b.prepMinutes ?? Number.POSITIVE_INFINITY
      if (pa !== pb) return pa - pb
      return a.id < b.id ? -1 : 1
    })
  }

  return pool.slice(0, n)
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

  // The preference-ordered pool we walk to fill each day. Walking the same order
  // for every day keeps the no-repeat rule (a `used` set) and the deterministic
  // pick. Each day only takes the highest-ranked recipe that FITS its type.
  const pool = rankRecipes(recipes, profile, swipes, options)
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
