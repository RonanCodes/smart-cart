/**
 * Per-recipe "why was this recommended" breakdown. Pure (no DB / Worker / client
 * deps) so it runs identically in the admin server fn, the tests, and anywhere
 * else. It does NOT re-rank: it takes the inferred taste the recommender already
 * produced via `explain()` and, for one already-recommended recipe, lists the
 * signals that pushed it up or down. The signal set mirrors the AdaptiveRecommender
 * scorer exactly (loved-cuisine net weight, disliked-cuisine penalty, loved /
 * disliked confident ingredients) so the breakdown reflects the live ranker.
 */
import type { InferredTaste, RecipeLite } from './types'

/** One contributing signal in a recipe's why-breakdown. */
export interface WhySignal {
  /** What kind of signal fired. */
  kind:
    | 'loved-cuisine'
    | 'disliked-cuisine'
    | 'loved-ingredient'
    | 'disliked-ingredient'
  /** The cuisine or ingredient token the signal is about. */
  token: string
  /** Signed contribution: positive pushes the recipe up, negative pushes it down. */
  contribution: number
  /** Human-readable one-liner, e.g. "+ loved cuisine Mexican (5 likes)". */
  label: string
}

/** A recommended recipe with the signals that explain its placement. */
export interface RecipeWhy {
  id: string
  title: string
  cuisine: string | null
  /** Net score from the listed signals (loved-cuisine weight + ingredient terms). */
  score: number
  /** The signals, strongest-magnitude first. */
  signals: Array<WhySignal>
}

/** Distinct, lowercased ingredient word-tokens for a recipe (mirrors the ranker). */
function ingredientTokens(r: RecipeLite): Array<string> {
  return [
    ...new Set(
      r.ingredients.flatMap((i) =>
        i.name
          .toLowerCase()
          .split(/[^a-z]+/)
          .filter((w) => w.length > 2),
      ),
    ),
  ]
}

/** Magnitude of the confident-ingredient adjustment in the Adaptive ranker. */
const DEFAULT_INGREDIENT_MAGNITUDE = 0.5
/** Penalty subtracted when a recipe's cuisine is one the household disliked. */
const DEFAULT_DISLIKED_CUISINE_PENALTY = 1

/**
 * Build the why-breakdown for ONE recipe from the household's inferred taste. The
 * arithmetic intentionally matches AdaptiveRecommender.recommend()'s scorer so the
 * sum of the signals' contributions equals the score that placed the recipe.
 */
export function recipeWhy(
  recipe: RecipeLite,
  taste: InferredTaste,
  opts: {
    ingredientMagnitude?: number
    dislikedCuisinePenalty?: number
  } = {},
): RecipeWhy {
  const ingredientMagnitude =
    opts.ingredientMagnitude ?? DEFAULT_INGREDIENT_MAGNITUDE
  const dislikedCuisinePenalty =
    opts.dislikedCuisinePenalty ?? DEFAULT_DISLIKED_CUISINE_PENALTY

  const lovedCuisineWeight = new Map(
    taste.lovedCuisines.map((c) => [c.cuisine, c.weight]),
  )
  const dislikedCuisines = new Set(taste.dislikedCuisines)
  const lovedIngredients = new Set(taste.lovedIngredients)
  const dislikedIngredients = new Set(taste.dislikedIngredients)

  const signals: Array<WhySignal> = []

  if (recipe.cuisine) {
    const w = lovedCuisineWeight.get(recipe.cuisine)
    if (w && w > 0) {
      signals.push({
        kind: 'loved-cuisine',
        token: recipe.cuisine,
        contribution: w,
        label: `+ loved cuisine ${recipe.cuisine} (${w} net like${
          w === 1 ? '' : 's'
        })`,
      })
    }
    if (dislikedCuisines.has(recipe.cuisine)) {
      signals.push({
        kind: 'disliked-cuisine',
        token: recipe.cuisine,
        contribution: -dislikedCuisinePenalty,
        label: `- disliked cuisine ${recipe.cuisine}`,
      })
    }
  }

  for (const token of ingredientTokens(recipe)) {
    if (lovedIngredients.has(token)) {
      signals.push({
        kind: 'loved-ingredient',
        token,
        contribution: ingredientMagnitude,
        label: `+ loved ingredient ${token}`,
      })
    }
    if (dislikedIngredients.has(token)) {
      signals.push({
        kind: 'disliked-ingredient',
        token,
        contribution: -ingredientMagnitude,
        label: `- disliked ingredient ${token}`,
      })
    }
  }

  signals.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
  const score = signals.reduce((sum, s) => sum + s.contribution, 0)
  return {
    id: recipe.id,
    title: recipe.title,
    cuisine: recipe.cuisine,
    score,
    signals,
  }
}

/**
 * Build why-breakdowns for a list of already-recommended recipes (preserving the
 * recommender's order, which is the ranking the household actually gets).
 */
export function recipeWhys(
  recipes: Array<RecipeLite>,
  taste: InferredTaste,
  opts?: { ingredientMagnitude?: number; dislikedCuisinePenalty?: number },
): Array<RecipeWhy> {
  return recipes.map((r) => recipeWhy(r, taste, opts))
}

/** A swipe shaped for the admin "data points" column. */
export interface WhyDatapoint {
  recipeTitle: string
  cuisine: string | null
  like: boolean
}

/** An inferred-preference row with the count of swipes that support it. */
export interface InferredPreference {
  /** The cuisine or ingredient token. */
  token: string
  /** Number of supporting swipes (for cuisines: net likes; for ingredients: likes). */
  support: number
}

/** The fully-shaped explainability payload for one user. */
export interface UserExplanation {
  email: string
  /** The raw swipes (data points), most-recent first. */
  datapoints: Array<WhyDatapoint>
  /** Inferred preferences, each with supporting-swipe counts. */
  preferences: {
    lovedCuisines: Array<InferredPreference>
    dislikedCuisines: Array<string>
    lovedIngredients: Array<InferredPreference>
    dislikedIngredients: Array<string>
  }
  /** Top-N recommendations, each with its why-breakdown. */
  recommendations: Array<RecipeWhy>
}

/**
 * Count how many of the user's liked swipes support each loved ingredient, so the
 * middle "inferred preferences" column can show "chicken (4 likes)" not just a bare
 * chip. Cuisines already carry their net weight from `explain()`; ingredients do
 * not, so we recover the like-count here from the same swipe data points.
 */
export function ingredientSupport(
  likedRecipes: Array<RecipeLite>,
  tokens: Array<string>,
): Map<string, number> {
  const want = new Set(tokens)
  const counts = new Map<string, number>()
  for (const r of likedRecipes) {
    for (const t of ingredientTokens(r)) {
      if (want.has(t)) counts.set(t, (counts.get(t) ?? 0) + 1)
    }
  }
  return counts
}

/**
 * Pure shaping of an inferred taste + the user's liked recipes into the
 * preferences block (cuisines keep their net weight, ingredients gain a support
 * count). Kept separate from the server fn so it is unit-testable without a DB.
 */
export function shapePreferences(
  taste: InferredTaste,
  likedRecipes: Array<RecipeLite>,
): UserExplanation['preferences'] {
  const ingSupport = ingredientSupport(likedRecipes, taste.lovedIngredients)
  return {
    lovedCuisines: taste.lovedCuisines.map((c) => ({
      token: c.cuisine,
      support: c.weight,
    })),
    dislikedCuisines: taste.dislikedCuisines,
    lovedIngredients: taste.lovedIngredients.map((t) => ({
      token: t,
      support: ingSupport.get(t) ?? 0,
    })),
    dislikedIngredients: taste.dislikedIngredients,
  }
}
