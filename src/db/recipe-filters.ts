import { sql } from 'drizzle-orm'
import { recipe } from './schema'

/**
 * SQL predicate for a recipe the app may surface as a card (deck, weekly plan,
 * similar neighbours). Two gates:
 *
 *  1. Dutch supermarket source only: `source IN ('ah','jumbo')`. The catalogue
 *     also holds older foodcom + themealdb rows, but the product is Albert Heijn /
 *     Jumbo, so only those recipes are shown. The rest stay in the table (they
 *     still carry ingredients/macros for price-matching) but never surface.
 *  2. Has a usable image: `raw.imageUrl` is set (an imageless card looks broken).
 *     Every AH/Jumbo recipe has one, so this is belt-and-braces.
 *
 * Keeping the export name `hasImage` since every selection point already imports it.
 */
export const hasImage = sql`${recipe.source} in ('ah', 'jumbo') and json_extract(${recipe.raw}, '$.imageUrl') is not null and json_extract(${recipe.raw}, '$.imageUrl') <> ''`
