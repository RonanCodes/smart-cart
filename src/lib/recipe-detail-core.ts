import { pickIngredients, pickInstructions } from './recipe-locale'

/** What the recipe-detail view needs to fetch the dish. */
export interface RecipeDetailInput {
  /** The catalogue recipe id (the day's recipeRef). */
  recipeId: string
}

/** One ingredient line: a quantity (when known) plus the product name. */
export interface RecipeIngredient {
  /** The ingredient/product name, e.g. "aardappelen". */
  name: string
  /** The amount as a display string, e.g. "500 g", or null when unknown. */
  amount: string | null
}

/**
 * The clean detail the RecipeDetail card renders: the ingredients (quantity +
 * name) and the written-out steps, plus the headline prep time + servings. Empty
 * arrays when the recipe carries none, which is the signal the UI uses to hide a
 * section rather than render an empty heading.
 */
export interface RecipeDetailResult {
  ingredients: Array<RecipeIngredient>
  steps: Array<string>
  prepMinutes: number | null
  servings: number | null
  /**
   * True when the ingredient amounts are LLM-estimated rather than from the
   * source (#313), so the card can label them "approx". The demo AH/Jumbo set
   * has patchy scraped quantities, so the amounts are inferred.
   */
  amountsEstimated: boolean
}

/** The shape of the recipe columns this view reads (the recipe table). */
export interface RecipeDetailRow {
  ingredients: Array<{
    name: string
    qty?: string
    unit?: string
    productId?: string
  }> | null
  instructions: Array<string> | null
  /** English translations baked at seed time; null when not translated (#295). */
  ingredientsEn?: Array<{
    name: string
    qty?: string
    unit?: string
    productId?: string
  }> | null
  instructionsEn?: Array<string> | null
  prepMinutes: number | null
  servings: number | null
  /** True when the amounts are LLM-estimated, not from the source (#313). */
  quantitiesEstimated?: boolean | null
}

/**
 * Compose an ingredient's amount column ("500 g", "2 stuks", "snufje") from the
 * stored qty + unit. Returns null when there's nothing useful to show, so the UI
 * renders just the name. Pure, so the formatting is unit-testable.
 */
export function formatAmount(qty?: string, unit?: string): string | null {
  const q = qty?.trim()
  const u = unit?.trim()
  if (q && u) return `${q} ${u}`
  if (q) return q
  if (u) return u
  return null
}

/**
 * Map a raw recipe row into the clean RecipeDetailResult the card renders. Pure,
 * so the mapping is unit-testable without standing up the Start runtime / a live
 * DB. Drops ingredient rows with no name (junk), trims step strings and drops
 * blanks, and tolerates null JSON columns (older / partial rows) -> empty arrays.
 */
export function mapRecipeDetail(row: RecipeDetailRow): RecipeDetailResult {
  // Default to English (the demo locale), fall back to Dutch when a recipe has
  // no translation. The Dutch source is kept on the row untouched (#295).
  const ingredients: Array<RecipeIngredient> = pickIngredients(
    row.ingredients,
    row.ingredientsEn,
  )
    .filter((i) => i.name.trim() !== '')
    .map((i) => ({
      name: i.name.trim(),
      amount: formatAmount(i.qty, i.unit),
    }))

  const steps: Array<string> = pickInstructions(
    row.instructions,
    row.instructionsEn,
  )
    .filter((s): s is string => typeof s === 'string' && s.trim() !== '')
    .map((s) => s.trim())

  return {
    ingredients,
    steps,
    prepMinutes: row.prepMinutes,
    servings: row.servings,
    // Only claim "approx" when there is actually an amount to qualify; a recipe
    // with no ingredient amounts at all should not show the estimate note.
    amountsEstimated:
      !!row.quantitiesEstimated && ingredients.some((i) => i.amount !== null),
  }
}

/**
 * The recipe detail (ingredients + steps) for one catalogue recipe. A plain
 * function (no Start context) so it is unit-testable directly; the createServerFn
 * in recipe-detail-server.ts is a thin wrapper that dynamically imports this.
 *
 * This module is SERVER-ONLY (it dynamic-imports db/client, which statically
 * pulls `cloudflare:workers`). It must never be imported, even for types, by a
 * client component, or that binding leaks into the browser bundle and the build
 * fails resolving `cloudflare:workers`. Components import only the thin server fn.
 *
 * Household-gated like the other week reads: a signed-in user is required (the
 * recipe catalogue is shared, so there's no per-row ownership to check, but we
 * keep the same gate so an unauthenticated request never reads the catalogue).
 * A missing recipe -> empty arrays, so the card hides cleanly rather than crashes.
 */
export async function fetchRecipeDetail(
  data: RecipeDetailInput,
): Promise<RecipeDetailResult> {
  const empty: RecipeDetailResult = {
    ingredients: [],
    steps: [],
    prepMinutes: null,
    servings: null,
    amountsEstimated: false,
  }
  if (!data.recipeId) return empty

  const { getSessionUser } = await import('./server-auth')
  const user = await getSessionUser()
  if (!user) throw new Error('Not signed in')

  const { getDb } = await import('../db/client')
  const { recipe } = await import('../db/schema')
  const { eq } = await import('drizzle-orm')
  const db = await getDb()

  const rows = await db
    .select({
      ingredients: recipe.ingredients,
      instructions: recipe.instructions,
      ingredientsEn: recipe.ingredientsEn,
      instructionsEn: recipe.instructionsEn,
      prepMinutes: recipe.prepMinutes,
      servings: recipe.servings,
      quantitiesEstimated: recipe.quantitiesEstimated,
    })
    .from(recipe)
    .where(eq(recipe.id, data.recipeId))
    .limit(1)

  const row = rows[0]
  if (!row) return empty

  return mapRecipeDetail(row)
}
