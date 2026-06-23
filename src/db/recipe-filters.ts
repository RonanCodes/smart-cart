import { and, notInArray, or, sql } from 'drizzle-orm'
import {
  NON_DINNER_CATEGORY_FRAGMENTS,
  REMOVED_AH_JUMBO_RECIPE_IDS,
  isDinnerRecipe,
} from '../lib/recipe-dinner'
import { recipe } from './schema'

/**
 * SQL: category is empty, explicitly a main (`hoofdgerecht`), or does not carry a
 * known non-dinner label (bijgerecht, nagerecht, ontbijt, dessert, …).
 */
const categoryIsDinner = or(
  sql`${recipe.category} is null`,
  sql`trim(${recipe.category}) = ''`,
  sql`lower(${recipe.category}) = 'hoofdgerecht'`,
  and(
    ...NON_DINNER_CATEGORY_FRAGMENTS.map(
      (fragment) => sql`lower(${recipe.category}) not like ${`%${fragment}%`}`,
    ),
  ),
)

/**
 * SQL predicate for a recipe the app may surface as a card (deck, weekly plan,
 * similar neighbours, heal picker). Gates:
 *
 *  1. Dutch supermarket source only: `source IN ('ah','jumbo')`.
 *  2. Has a usable image (`raw.imageUrl` set).
 *  3. Dinner-only: category must not be a side / dessert / breakfast / snack, and
 *     the id must not be in the removed non-dinner blocklist (title-only rows with
 *     no category signal, e.g. smoothies / cookies).
 *
 * Keeping the export name `hasImage` since every selection point already imports it.
 */
export const hasImage = and(
  sql`${recipe.source} in ('ah', 'jumbo')`,
  sql`json_extract(${recipe.raw}, '$.imageUrl') is not null`,
  sql`json_extract(${recipe.raw}, '$.imageUrl') <> ''`,
  categoryIsDinner,
  notInArray(recipe.id, [...REMOVED_AH_JUMBO_RECIPE_IDS]),
)

export interface ServableRecipeRow {
  id: string
  source: string
  title: string
  category: string | null
  raw: unknown
}

/** In-memory mirror of {@link hasImage} for unit tests and scripts. */
export function recipeRowIsServable(row: ServableRecipeRow): boolean {
  if (row.source !== 'ah' && row.source !== 'jumbo') return false
  const imageUrl = (row.raw as { imageUrl?: string | null } | null)?.imageUrl
  if (!imageUrl || imageUrl.trim() === '') return false
  if (REMOVED_AH_JUMBO_RECIPE_IDS.includes(row.id)) return false
  return isDinnerRecipe({ title: row.title, category: row.category })
}
