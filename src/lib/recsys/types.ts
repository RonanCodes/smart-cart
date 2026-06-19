/**
 * Recommender types. The swipe onboarding is an active-learning problem: pick the
 * next recipes to show so that, in the fewest swipes, we can rank the catalogue the
 * way this household actually would. These types are pure (no DB / Worker deps) so
 * they run identically in the benchmark, the tests, and the Worker.
 */

export interface RecipeLite {
  id: string
  title: string
  cuisine: string | null
  category: string | null
  dietaryTags: Array<string>
  ingredients: Array<{ name: string }>
  /** Prep time in minutes, when the source recorded it. Drives the prep-time nudge. */
  prepMinutes?: number | null
  /** Calories per serving, when the source recorded it. Drives the calorie nudge. */
  calories?: number | null
}

export interface Swipe {
  recipeId: string
  like: boolean
}

/** A synthetic user's hidden taste, used to simulate swipes and define the truth. */
export interface UserProfile {
  id: string
  lovedCuisines: Array<string>
  dislikedCuisines: Array<string>
  /** Ingredients they gravitate to (chicken, chocolate, …). Taste beyond cuisine. */
  lovedIngredients: Array<string>
  dislikedIngredients: Array<string>
  vegetarian: boolean
  /**
   * The taste archetype this user was sampled from (e.g. "mediterranean-foodie").
   * Provenance only: lets the benchmark report per-archetype and makes the fixture
   * self-describing. Not read by the scoring or the recommenders.
   */
  archetype?: string
  /**
   * Soft prep-time preference. When set, a recipe over this many minutes is nudged
   * down and a quick recipe is nudged up. Optional so plain "cuisine + ingredient"
   * users (and the unit-test fixtures) keep the original scoring exactly.
   */
  maxPrepMinutes?: number | null
  /**
   * Soft calorie preference. `lighter` nudges low-calorie recipes up and heavy ones
   * down; `hearty` does the reverse. Optional, same backward-compatibility reason.
   */
  caloriePreference?: 'lighter' | 'hearty' | null
}

/**
 * Tunable constants for the Adaptive ranker (and the soft-score nudge it feeds).
 * Every field has a default that reproduces TODAY's hard-coded behaviour exactly,
 * so omitting a field (or the whole object) leaves recall unchanged. The admin
 * console and the planned Bayesian tuner override these at call time; nothing in
 * the live path should hard-code the literals any more.
 */
export interface AdaptiveWeights {
  /**
   * The idf "common token" gate. A token is treated as distinctive (a real taste
   * signal) only if it appears in fewer than this fraction of recipes; common
   * staples (salt, onion, oil) sit above the gate and are ignored. Default 0.12.
   */
  idfGate: number
  /**
   * Penalty subtracted when a recipe's cuisine is one the household disliked.
   * Cuisine net-preference (the loved-cuisine tally) is the dominant signal; this
   * is the matching down-weight on the disliked side. Default 1.
   */
  dislikedCuisinePenalty: number
  /**
   * Magnitude of the confident-ingredient adjustment: + when a recipe carries a
   * confidently-loved ingredient, - for a confidently-disliked one. Default 0.5.
   */
  ingredientMagnitude: number
  /** Soft-score nudge weights applied by the planner. Defaults reproduce planner.ts. */
  soft: SoftScoreWeights
}

/**
 * Weights for the planner's soft nudge (calorie / protein / prep-time). Not a
 * filter; only reorders recipes the ranker already rated close together. Each
 * default matches the literal currently in planner.ts softScore().
 */
export interface SoftScoreWeights {
  /** Max lift for a recipe near the calorie target. Default 0.3. */
  calorie: number
  /** Max lift for a high-protein dinner (40g+). Default 0.2. */
  protein: number
  /** Max lift for a quick dinner (<=15 min). Default 0.2. */
  prep: number
}

/** A recommender consumes swipes and produces (a) the next deck and (b) a ranking. */
export interface Recommender {
  readonly name: string
  /** Order/choose the next `k` recipes to show, given the swipes so far. */
  nextDeck: (swipes: Array<Swipe>, k: number) => Array<RecipeLite>
  /** Best `n` recommendations given the swipes so far. */
  recommend: (swipes: Array<Swipe>, n: number) => Array<RecipeLite>
  /** Human-readable read of what we think the user likes (for the profile/badges). */
  explain: (swipes: Array<Swipe>) => InferredTaste
}

export interface InferredTaste {
  lovedCuisines: Array<{ cuisine: string; weight: number }>
  dislikedCuisines: Array<string>
  lovedIngredients: Array<string>
  dislikedIngredients: Array<string>
  vegetarianLikelihood: number
}
