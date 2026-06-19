/**
 * "Similar recipes" over Cloudflare Vectorize (ADR-0001).
 *
 * Given a recipe id, return its nearest neighbours from the `smart-cart-recipes`
 * index, filtered to be sensible swaps: the query recipe itself is dropped, and
 * the household's HARD filters (allergies, vegetarian/vegan diet) are applied so
 * every neighbour is a valid substitution. Optionally re-rank the neighbours by
 * prep time ("faster") or calories ("lighter") when the caller asks.
 *
 * Why the post-processing is a pure function: the stored Vectorize metadata only
 * carries `cuisine` (see scripts/embed-recipes.ts), so allergy/diet filtering and
 * the prep/calorie re-rank need the full recipe rows from D1. We split the pure
 * neighbour post-processing (`postProcessNeighbours`) from the I/O orchestration
 * (`similarRecipes`) so the post-processing unit-tests against a stubbed neighbour
 * list with no network, no Vectorize, and no token. Mirrors the recipe-text.ts
 * split: pure logic lives where tests can reach it without the Worker runtime.
 */

import { recipeText } from './recipe-text'

/** A recipe row, narrowed to the fields neighbour post-processing reads. */
export interface SimilarRecipe {
  id: string
  title: string
  cuisine: string | null
  category: string | null
  dietaryTags: Array<string>
  ingredients: Array<{ name: string }>
  /** prep time in minutes when known, else null (used by the "faster" re-rank). */
  prepMinutes: number | null
  /** kcal per serving when known, else null (used by the "lighter" re-rank). */
  calories: number | null
}

/** The household profile fields a swap respects. Same hard filters as the planner. */
export interface SimilarProfile {
  allergies?: Array<string>
  diet?: string
}

/** One raw Vectorize neighbour: a recipe id and its cosine similarity score. */
export interface Neighbour {
  id: string
  score: number
}

/** How to re-rank the surviving neighbours. */
export type SimilarSort = 'similarity' | 'faster' | 'lighter'

export interface SimilarOptions {
  /** How many neighbours to return after filtering. Defaults to 5. */
  limit?: number
  /**
   * Re-rank surviving neighbours:
   *  - 'similarity' (default): keep Vectorize's nearest-first order.
   *  - 'faster': lowest prep time first (unknown prep sorted last).
   *  - 'lighter': lowest calories first (unknown calories sorted last).
   */
  sort?: SimilarSort
}

/** A returned neighbour: the recipe plus its similarity score to the query. */
export interface SimilarResult {
  id: string
  title: string
  cuisine: string | null
  prepMinutes: number | null
  calories: number | null
  /** Cosine similarity to the query recipe (higher = more similar). */
  score: number
}

/** Diets that forbid meat; mirrors the planner's hard filter (planner.ts). */
const VEG_DIETS = new Set(['vegetarian', 'vegan'])

function normalise(s: string): string {
  return s.toLowerCase().trim()
}

/** Every ingredient name of a recipe, lowercased, for allergy matching. */
function ingredientText(r: SimilarRecipe): string {
  return r.ingredients.map((i) => normalise(i.name)).join(' ')
}

/**
 * Hard filter for a single recipe. A recipe is a valid swap only if it clears
 * BOTH gates (identical semantics to the planner's hardFilter):
 *  - allergies: no allergen string appears in any ingredient name.
 *  - diet: a vegetarian household needs a vegetarian-or-vegan tag; a vegan
 *    household needs a vegan tag.
 * Unknown/empty profile fields are permissive (the recipe passes that gate).
 */
export function passesHardFilter(
  r: SimilarRecipe,
  profile: SimilarProfile,
): boolean {
  const allergies = (profile.allergies ?? []).map(normalise).filter(Boolean)
  const diet = profile.diet ? normalise(profile.diet) : null
  const needsVegTag = diet && VEG_DIETS.has(diet) ? diet : null

  if (needsVegTag) {
    const tags = r.dietaryTags.map(normalise)
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
}

/** Sort key that pushes unknown (null) values to the end of an ascending sort. */
function nullsLast(v: number | null): number {
  return v == null ? Number.POSITIVE_INFINITY : v
}

/**
 * Pure neighbour post-processing. Given the raw Vectorize neighbours, a lookup
 * from recipe id to the full recipe row, the query recipe id, and the household
 * profile + options, return the valid swaps in the requested order.
 *
 * Steps, in order:
 *  1. Drop the query recipe itself (it is always its own nearest neighbour).
 *  2. Drop any neighbour we have no recipe row for (cannot filter it safely, so
 *     it is excluded rather than returned unfiltered).
 *  3. Apply the household hard filter (allergies + diet) so every survivor is a
 *     valid swap.
 *  4. Re-rank: similarity (default, nearest first), faster (prep asc), or lighter
 *     (calories asc). 'faster'/'lighter' tie-break on similarity so a tie keeps
 *     the more-similar recipe first.
 *  5. Truncate to `limit` (default 5).
 *
 * Pure: no Vectorize, no DB, no `cloudflare:workers`. The orchestrator below does
 * the I/O and hands this function a stub-friendly shape.
 */
export function postProcessNeighbours(
  neighbours: Array<Neighbour>,
  recipesById: Map<string, SimilarRecipe>,
  queryRecipeId: string,
  profile: SimilarProfile,
  options: SimilarOptions = {},
): Array<SimilarResult> {
  const limit = options.limit ?? 5
  const sort = options.sort ?? 'similarity'

  const candidates: Array<{ recipe: SimilarRecipe; score: number }> = []
  for (const n of neighbours) {
    if (n.id === queryRecipeId) continue // 1. drop self
    const recipe = recipesById.get(n.id)
    if (!recipe) continue // 2. drop unknown rows (cannot filter safely)
    if (!passesHardFilter(recipe, profile)) continue // 3. hard filter
    candidates.push({ recipe, score: n.score })
  }

  // 4. Re-rank. Vectorize already returns nearest-first, so 'similarity' keeps
  // the incoming order; the alternatives sort by prep / calories with a
  // similarity tie-break (and nulls last so a recipe missing the field never
  // claims the top of a "faster"/"lighter" list).
  if (sort === 'faster') {
    candidates.sort((a, b) => {
      const d =
        nullsLast(a.recipe.prepMinutes) - nullsLast(b.recipe.prepMinutes)
      return d !== 0 ? d : b.score - a.score
    })
  } else if (sort === 'lighter') {
    candidates.sort((a, b) => {
      const d = nullsLast(a.recipe.calories) - nullsLast(b.recipe.calories)
      return d !== 0 ? d : b.score - a.score
    })
  }

  return candidates.slice(0, limit).map(({ recipe, score }) => ({
    id: recipe.id,
    title: recipe.title,
    cuisine: recipe.cuisine,
    prepMinutes: recipe.prepMinutes,
    calories: recipe.calories,
    score,
  }))
}

/**
 * The Vectorize topK to request. We over-fetch relative to `limit` because the
 * hard filter drops some neighbours (a vegetarian household discards every meat
 * neighbour), and the query recipe itself consumes one slot. A generous topK
 * keeps the final list full after filtering without a second query.
 */
function topKFor(limit: number): number {
  return Math.max(20, limit * 5)
}

/**
 * Orchestrate a similar-recipes query end to end (the I/O path; not unit-tested,
 * exercised by an optional live smoke). Embeds the query recipe's text, queries
 * Vectorize for its neighbours, loads the candidate recipe rows from D1, then
 * hands everything to the pure `postProcessNeighbours`.
 *
 * Reads Vectorize + recipe + household.profile; writes nothing. The query recipe
 * row is loaded so we embed identical text to the catalogue (recipeText), which
 * keeps similarity self-consistent with the offline embed script.
 */
export async function similarRecipes(
  recipeId: string,
  profile: SimilarProfile,
  options: SimilarOptions = {},
): Promise<Array<SimilarResult>> {
  const limit = options.limit ?? 5

  const { getDb } = await import('../../db/client')
  const { recipe } = await import('../../db/schema')
  const { hasImage } = await import('../../db/recipe-filters')
  const { eq, inArray, and } = await import('drizzle-orm')
  const { embed, similar } = await import('./index')
  const db = await getDb()

  // 1. Load the query recipe so we embed the same text the catalogue used.
  const queryRows = await db
    .select({
      id: recipe.id,
      title: recipe.title,
      cuisine: recipe.cuisine,
      ingredients: recipe.ingredients,
    })
    .from(recipe)
    .where(eq(recipe.id, recipeId))
    .limit(1)
  const query = queryRows[0]
  if (!query) throw new Error('Recipe not found')

  // 2. Embed + query Vectorize for the nearest neighbours.
  const vector = await embed(
    recipeText({
      title: query.title,
      cuisine: query.cuisine,
      ingredients: query.ingredients.map((i) => ({ name: i.name })),
    }),
  )
  const neighbours = await similar(vector, topKFor(limit))

  // 3. Load the full rows for every neighbour so we can hard-filter + re-rank.
  const ids = neighbours.map((n) => n.id)
  const rows = ids.length
    ? await db
        .select({
          id: recipe.id,
          title: recipe.title,
          cuisine: recipe.cuisine,
          category: recipe.category,
          dietaryTags: recipe.dietaryTags,
          ingredients: recipe.ingredients,
          prepMinutes: recipe.prepMinutes,
          calories: recipe.calories,
        })
        .from(recipe)
        // Only suggest imaged recipes as swaps (no broken cards).
        .where(and(inArray(recipe.id, ids), hasImage))
    : []

  const recipesById = new Map<string, SimilarRecipe>(
    rows.map((r) => [
      r.id,
      {
        id: r.id,
        title: r.title,
        cuisine: r.cuisine,
        category: r.category,
        dietaryTags: r.dietaryTags,
        ingredients: r.ingredients.map((i) => ({ name: i.name })),
        prepMinutes: r.prepMinutes,
        calories: r.calories,
      },
    ]),
  )

  // 4. Pure post-processing: drop self, hard filter, re-rank, truncate.
  return postProcessNeighbours(
    neighbours,
    recipesById,
    recipeId,
    profile,
    options,
  )
}
