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
import { BUSY_PREP_CAP_MINUTES, penaltyFor } from './types'

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

/**
 * Recipe `category` values that are NOT a dinner, even when the row's `mealType`
 * is the DB default 'dinner' (#375). Real imported snacks / sweets / sides /
 * drinks carry a category but inherit the 'dinner' meal-type default, so they
 * leaked into the week (e.g. "Crackers" as a dinner). Matched case-insensitively
 * as a substring of the category, so "Side Dish", "Dessert", "Beverage" etc all
 * drop out. A null/empty category is treated as a dinner (no signal to exclude).
 */
const NON_DINNER_CATEGORY_TERMS: ReadonlyArray<string> = [
  'snack',
  'dessert',
  'sweet',
  'side',
  'beverage',
  'drink',
  'cocktail',
  'breakfast',
  'brunch',
  'appetiz',
  'appetis',
  'starter',
  'sauce',
  'condiment',
  'dip',
  'spread',
  'bread', // baked-good loaves, not a dinner
  'cracker',
]

/** True when a recipe's category marks it as a non-dinner item (#375). */
function isNonDinnerCategory(r: PlannerRecipe): boolean {
  const cat = r.category ? normalise(r.category) : ''
  if (!cat) return false
  return NON_DINNER_CATEGORY_TERMS.some((t) => cat.includes(t))
}

/**
 * Non-dinner TITLE keywords (#424). The category gate (#375) only fires when the
 * imported row HAS a telling category; a sauce / cracker / dessert mis-tagged
 * `mealType: 'dinner'` with a null or generic category (e.g. "Main") still leaked
 * onto the dinner plan ("gado-gado sauce", "low-carb crackers"). This is the
 * defensive net: a recipe whose TITLE contains one of these as a WHOLE WORD is
 * never a dinner candidate, even if a single mis-tag says otherwise. Both EN and
 * NL forms, deliberately tight + word-boundary matched (see `titleIsNonDinner`)
 * so a legitimate dinner is never dropped ("barbecue" keeps "bar", "scrambled"
 * keeps "ramble", "snackbar fries" keeps the compound).
 */
const NON_DINNER_TITLE_TERMS: ReadonlyArray<string> = [
  'sauce',
  'saus', // NL sauce
  'crackers',
  'cracker',
  'bar', // coconut bar, protein bar — 'bars' caught by the optional plural
  'crumble',
  'dip',
  'snack',
  'dessert',
  'toetje', // NL dessert
  'reep', // NL bar (e.g. mueslireep)
]

/**
 * Whole-word non-dinner term match. We anchor each term on word boundaries so a
 * non-dinner word only fires when it stands alone, not as a fragment of a real
 * dinner's name. "bars" / "reep" are matched as their own words too. NL compounds
 * (satésaus, mueslireep, kwarktoetje) glue the term to the preceding word with no
 * separator, so we also accept the term at the END of a longer token — but NEVER
 * in the middle (which would catch "barbecue" / "scrambled").
 */
function titleHasNonDinnerWord(title: string): boolean {
  const t = normalise(title)
  for (const term of NON_DINNER_TITLE_TERMS) {
    // \b...\b catches the standalone word and trailing-s plural via the explicit
    // 'crackers'/'cracker' entries. (?:^|[^a-z]) + term + ($|[^a-z]) for EN; the
    // term-at-token-end branch catches the glued NL compounds.
    const standalone = new RegExp(`(?:^|[^a-z])${term}(?:s)?(?:$|[^a-z])`)
    if (standalone.test(t)) return true
    // Glued NL compound: the term sits at the end of a token (preceded by
    // letters, e.g. "satésaus", "mueslireep", "kwarktoetje").
    const gluedEnd = new RegExp(`[a-zé]${term}(?:$|[^a-z])`)
    if (
      (term === 'saus' || term === 'toetje' || term === 'reep') &&
      gluedEnd.test(t)
    )
      return true
  }
  return false
}

/** True when a recipe's title marks it as an obvious non-dinner item (#424). */
function isNonDinnerTitle(r: PlannerRecipe): boolean {
  return r.title ? titleHasNonDinnerWord(r.title) : false
}

/**
 * Pork in all the forms it shows up as in a Dutch/English catalogue. A household
 * that excludes "pork" (the Porkless diet toggle, or "pork"/"bacon"/etc. as a
 * dislike) means ALL of these — onboarding's derived list missed the Dutch "spek"
 * plus gammon / lardons / pancetta, so a "smoked bacon" risotto leaked into a
 * porkless week (#422). Any excluded token that IS one of these (or the trigger
 * word "pork"/"porkless") expands to the whole set, so excluding any single pork
 * form excludes them all. Matched as a substring of an ingredient name, so
 * "smoked bacon" and "gerookt spek" both hit.
 */
const PORK_FORMS: ReadonlyArray<string> = [
  'pork',
  'bacon',
  'ham',
  'gammon',
  'chorizo',
  'lardon', // lardon(s)
  'pancetta',
  'prosciutto',
  'spek', // NL bacon, incl. "gerookt spek"
]
const PORK_TRIGGERS = new Set([...PORK_FORMS, 'porkless'])

function normalise(s: string): string {
  return s.toLowerCase().trim()
}

/** Every ingredient word of a recipe, lowercased, for allergy matching. */
function ingredientText(r: PlannerRecipe): string {
  return r.ingredients.map((i) => normalise(i.name)).join(' ')
}

/**
 * Hard filter. A recipe is a candidate only if it clears EVERY gate:
 *  - dinner only: the planner plans dinners. A recipe must have mealType
 *    'dinner' AND a category that is not a known non-dinner (snack / dessert /
 *    side / drink …) AND a title that is not an obvious non-dinner (sauce /
 *    crackers / crumble / dip / dessert …, EN + NL). The category check exists
 *    because the DB defaults mealType to 'dinner', so an imported snack still
 *    reads as a dinner unless its category gives it away (#375); the title check
 *    is the net for a mis-tagged item with a null/generic category (#424).
 *  - excluded ingredients (#422): no excluded ingredient/protein string appears
 *    in any ingredient name. Fed by the derived `allergies` list AND the raw
 *    `dislikes` words; a pork exclusion expands to every pork form (bacon, ham,
 *    gammon, chorizo, lardons, pancetta, spek …). A HARD filter, not a nudge.
 *  - diet: if the household is vegetarian or vegan, the recipe must carry the
 *    matching dietary tag.
 *  - disliked cuisine (#374): a recipe whose cuisine the household explicitly
 *    DISLIKED is dropped outright. This is a HARD filter, not a nudge — a
 *    household that says "no Italian" must get zero Italian, even if a swipe
 *    once liked an Italian dish. (Liked cuisines remain a soft up-weight; only
 *    the dislike is absolute, mirroring the allergy/diet gates.)
 * These recipes are never candidates, so the soft scoring below can never bring
 * them back.
 */
export function hardFilter(
  recipes: Array<PlannerRecipe>,
  profile: PlannerProfile,
): Array<PlannerRecipe> {
  // Excluded ingredients/proteins are a HARD filter (#422). Both the derived
  // `allergies` list (what onboarding folds dislikes + Porkless into) AND the raw
  // `dislikes` words feed it, so a profile written by any path is protected. Any
  // pork trigger (pork / porkless / a single pork form) expands to every pork
  // form, so "smoked bacon" and "gerookt spek" are caught even when the user only
  // said "pork".
  const excludeRaw = [...(profile.allergies ?? []), ...(profile.dislikes ?? [])]
    .map(normalise)
    .filter(Boolean)
  const excludeIngredients = new Set<string>()
  for (const term of excludeRaw) {
    if (PORK_TRIGGERS.has(term))
      for (const f of PORK_FORMS) excludeIngredients.add(f)
    else excludeIngredients.add(term)
  }
  const excludeTerms = [...excludeIngredients]
  const diet = profile.diet ? normalise(profile.diet) : null
  const needsVegTag = diet && VEG_DIETS.has(diet) ? diet : null
  const dislikedCuisines = new Set(
    (profile.cuisinesDisliked ?? []).map(normalise).filter(Boolean),
  )

  return recipes.filter((r) => {
    if (r.mealType !== 'dinner') return false
    if (isNonDinnerCategory(r)) return false
    if (isNonDinnerTitle(r)) return false
    if (dislikedCuisines.size && r.cuisine) {
      if (dislikedCuisines.has(normalise(r.cuisine))) return false
    }
    if (needsVegTag) {
      const tags = r.dietaryTags.map(normalise)
      // Vegans accept vegan recipes; vegetarians accept vegetarian or vegan.
      const ok =
        needsVegTag === 'vegan'
          ? tags.includes('vegan')
          : tags.includes('vegetarian') || tags.includes('vegan')
      if (!ok) return false
    }
    if (excludeTerms.length) {
      const text = ingredientText(r)
      if (excludeTerms.some((a) => text.includes(a))) return false
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
 * Per-prior-use diversity penalty, in pool positions (#374). Deliberately large
 * enough to step PAST a same-cuisine block: the catalogue ranks a cuisine's
 * recipes contiguously, so a small nudge can never reach a fresh cuisine sitting
 * further down. Each prior use of a cuisine this week pushes its remaining
 * recipes this many positions down the effective order, so by the time a cuisine
 * has appeared once or twice another cuisine's top recipe out-ranks it.
 *
 * This applies ONLY to cuisines the household did NOT explicitly LIKE. A liked
 * cuisine is exempt (penalty 0), which is exactly the "pasta person" rule from
 * CONTEXT.md: a household that asked for a cuisine gets a cuisine-heavy week,
 * while a household with no strong preference gets a varied one. The dislike is
 * already a hard filter upstream, so it never reaches the pool at all.
 */
const CUISINE_REPEAT_PENALTY = 1000

/**
 * Choose the next recipe for a day from the preference-ordered `pool`, skipping
 * `used` recipes and (on a busy day) non-quick ones, while steering toward a
 * cuisine not yet heavy this week (#374).
 *
 * The pick maximises `-poolIndex - CUISINE_REPEAT_PENALTY * timesCuisineUsed` for
 * NEUTRAL cuisines, so once a neutral cuisine has appeared, a different cuisine's
 * best remaining recipe out-ranks its repeats and the week spreads across
 * cuisines. A cuisine the household explicitly LIKED (`likedCuisines`) is exempt
 * from the penalty, so a stated preference still produces a cuisine-heavy week.
 * Recipes with no cuisine never incur the penalty. Returns undefined when nothing
 * fits (caller handles the fallback / empty day).
 */
function pickForDay(
  pool: Array<PlannerRecipe>,
  used: Set<string>,
  cuisineCount: Map<string, number>,
  likedCuisines: Set<string>,
  wantsQuick: boolean,
): PlannerRecipe | undefined {
  let best: PlannerRecipe | undefined
  let bestScore = Number.NEGATIVE_INFINITY
  for (let i = 0; i < pool.length; i++) {
    const r = pool[i]!
    if (used.has(r.id)) continue
    if (wantsQuick && !fitsBusy(r)) continue
    const cuisine = r.cuisine ? normalise(r.cuisine) : null
    const exempt = !cuisine || likedCuisines.has(cuisine)
    const repeats = cuisine ? (cuisineCount.get(cuisine) ?? 0) : 0
    const score = exempt ? -i : -i - CUISINE_REPEAT_PENALTY * repeats
    if (score > bestScore) {
      bestScore = score
      best = r
    }
  }
  return best
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
    'seed' | 'algorithm' | 'weights' | 'penalties' | 'excludeRecipeIds'
  > = {},
): Array<PlannerRecipe> {
  const seed = options.seed ?? 42
  const algorithm = options.algorithm ?? DEFAULT_ALGORITHM
  const weights = options.weights ?? DEFAULT_ADAPTIVE_WEIGHTS

  const hardFiltered = hardFilter(recipes, profile)

  // Variety exclusion (#week-nav): recipes the caller wants kept fresh (e.g. last
  // week's dinners, so a fresh next week differs). This is a SOFT preference, not
  // a hard removal (#320 follow-up): excluded recipes stay in the pool but sink to
  // the BACK in the sort below. A large catalogue never reaches them (next week
  // still differs), but a small diet-filtered pool falls back to them rather than
  // leaving every day as an empty "eating out" card. An empty/absent set is a
  // strict no-op, so the fresh-household first week and the recsys regression
  // fixture rank identically to before.
  const excluded =
    options.excludeRecipeIds && options.excludeRecipeIds.length
      ? new Set(options.excludeRecipeIds)
      : null
  const candidates = hardFiltered

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
    // Higher is better. Rank 0 -> ranked.length, last -> 1. The soft nudge and
    // the learned penalties (memory / variety / recency) are both small relative
    // to the per-slot rank gap of 1, so they only reshuffle adjacent recipes.
    score:
      ranked.length -
      i +
      softScore(r, profile, weights.soft) -
      penaltyFor(r, options.penalties),
    index: i,
  }))

  scored.sort((a, b) => {
    // Excluded (last week's) recipes sink to the back so they're only used when
    // the rest of the pool can't fill the week — variety as a soft preference.
    const aEx = excluded?.has(a.recipe.id) ? 1 : 0
    const bEx = excluded?.has(b.recipe.id) ? 1 : 0
    if (aEx !== bEx) return aEx - bEx
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
    penalties?: PlanOptions['penalties']
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
 * Policy (grilled 2026-06-19, refined #374, CONTEXT.md "Planner policy"):
 *  - Preference-led. Rank the FULL catalogue with the adaptive recommender,
 *    seeded by the onboarding swipes. A household that explicitly LIKES a cuisine
 *    still gets a cuisine-heavy week (the liked cuisine is exempt from the
 *    diversity nudge below) — a pasta person gets a pasta week.
 *  - Cuisine diversity for the undecided (#374): a household with no strong
 *    cuisine signal gets a spread across cuisines instead of one cuisine all 7
 *    days, since the catalogue ranks a cuisine's recipes contiguously and that
 *    over-represents whatever sits at the top. See `pickForDay`.
 *  - Allergies, diet, AND a disliked cuisine are hard filters (done first in
 *    hardFilter, those recipes never become candidates). Only dinners are
 *    planned (mealType + non-snack category). Calorie goal, protein and prep
 *    time are soft nudges.
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
  // How many times each cuisine has already landed this week, so the picker can
  // steer toward variety (#374) without overriding a strong preference.
  const cuisineCount = new Map<string, number>()
  // Explicitly-liked cuisines are exempt from the diversity penalty: a household
  // that asked for a cuisine still gets a cuisine-heavy week (CONTEXT.md).
  const likedCuisines = new Set(
    (profile.cuisinesLiked ?? []).map((c) => c.toLowerCase().trim()),
  )
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
    // time constraint preference dominates, a same-cuisine repeat is gently
    // penalised for variety, and we never repeat a recipe.
    const wantsQuick = type === 'busy'
    let pick = pickForDay(pool, used, cuisineCount, likedCuisines, wantsQuick)

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
    if (pick.cuisine) {
      const c = normalise(pick.cuisine)
      cuisineCount.set(c, (cuisineCount.get(c) ?? 0) + 1)
    }
    planned.push({ day, meal: pick.title, recipeRef: pick.id, type })
  }

  return { days: planned }
}
