import { sql } from 'drizzle-orm'
import { recipe } from './schema'

/**
 * SQL predicate: the recipe has a usable image.
 *
 * Images live in `raw.imageUrl` (a JSON blob, no dedicated column). About 55% of the
 * imported catalogue has no image (mostly food.com rows), and an imageless card looks
 * broken in the swipe deck / week view / similar-swap. So every recipe-SELECTION point
 * the user sees a card from (deck, weekly plan, similar neighbours) filters on this.
 * The imageless recipes stay in the table (they still carry ingredients/macros for the
 * price-matching work), they just never surface as a card.
 */
export const hasImage = sql`json_extract(${recipe.raw}, '$.imageUrl') is not null and json_extract(${recipe.raw}, '$.imageUrl') <> ''`
