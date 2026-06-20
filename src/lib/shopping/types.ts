/**
 * Shopping-list engine types.
 *
 * This engine is PURE: given a week of planned recipes and the household's
 * portions, it produces a single consolidated shopping list. No DB, no I/O.
 * The server wiring (slice #79) and the food-waste view (#80) consume these
 * shapes; this layer never reaches for them.
 */

/**
 * A single recipe ingredient, mirroring `recipe.ingredients[]` in the DB schema.
 * `qty` is a free-form string ('200', '1/2', '1-2', 'a pinch') because that is
 * how the scraped recipes store it; the engine does the parsing.
 */
export interface RecipeIngredient {
  name: string
  qty?: string
  unit?: string
  productId?: string
}

/**
 * One planned recipe the engine aggregates over: its ingredients, how many
 * servings the recipe is written for, and a human label used in 'used in N
 * meals'. `servings` may be null/undefined when the source omitted it; the
 * engine then skips scaling for that recipe (factor 1).
 */
export interface ShoppingRecipe {
  /** Stable id, used only to keep order deterministic on ties. */
  id: string
  /** Human label surfaced in `usedInMeals` (e.g. the recipe title). */
  title: string
  /** Servings the recipe is written for. Missing => no scaling (factor 1). */
  servings?: number | null
  ingredients: Array<RecipeIngredient>
}

/**
 * The household's portion target. Children count as a fraction of an adult
 * (see `CHILD_PORTION_FACTOR`). `targetServings` resolves to
 * `adults + children * CHILD_PORTION_FACTOR`, rounded to one decimal.
 */
export interface HouseholdPortions {
  adults: number
  children?: number
}

/**
 * One consolidated shopping-list line: the same ingredient merged across every
 * recipe that uses it.
 *
 * - `totalQty` + `unit` are present when at least one contributing amount
 *   parsed to a number in a compatible unit. When recipes collide on the same
 *   ingredient with INCOMPATIBLE units (e.g. '2' cloves vs '15 g'), the primary
 *   (largest contributing) bucket wins `totalQty`/`unit` and the rest land in
 *   `extraAmounts`.
 * - `displayAmount` is the always-present human string ('450 g', '2 + 15 g',
 *   '3 (unspecified amount)').
 * - `usedInMeals` lists the recipe titles, sorted + de-duped.
 * - `unparsed` collects raw qty strings that could not be turned into a number
 *   (e.g. 'a pinch', 'to taste'), so nothing is silently dropped.
 * - `extraAmounts` holds compatible-unit-group totals that are NOT the primary
 *   bucket, each already formatted ('15 g', '2 cloves').
 */
export interface ShoppingLine {
  name: string
  totalQty?: number
  unit?: string
  displayAmount: string
  usedInMeals: Array<string>
  unparsed?: Array<string>
  extraAmounts?: Array<string>
}

/** The engine's output: a stable-ordered consolidated list. */
export interface ShoppingList {
  lines: Array<ShoppingLine>
  /** Resolved target servings the quantities were scaled to. */
  targetServings: number
  /** Convenience count of distinct items to buy. */
  estimatedItems: number
}
