import {
  sqliteTable,
  text,
  integer,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'

/**
 * Household staples (SQLite / D1). Standalone table, deliberately NOT part of the
 * main profile schema (src/db/schema.ts) so it can ship without regenerating the
 * household migration (the waitlist-schema pattern).
 *
 * A staple is a non-recipe item the household adds to the week's shopping list:
 * milk, coffee, toilet paper, snacks. The user finds it by searching the AH /
 * Jumbo product catalogue (#59 pricing layer) and taps a real product onto the
 * list; we persist the matched product so it survives across sessions and shows
 * up on the Shopping tab alongside the recipe ingredients.
 *
 * We store a light snapshot of the matched product (name, store, price, slug)
 * rather than a foreign key, because the price catalogue is a vendored snapshot
 * with no stable product id. The price is the value at add-time; it is a
 * reference figure, refreshed when the snapshot is.
 *
 * One row per (household, productKey) so re-adding the same staple is idempotent.
 */
export const staple = sqliteTable(
  'staple',
  {
    id: text('id').primaryKey(),
    householdId: text('household_id').notNull(),
    /** The free-text name shown on the list ('Halfvolle melk'). */
    name: text('name').notNull(),
    /** Store slug the matched product came from ('ah' | 'jumbo' | ...). */
    store: text('store').notNull(),
    /** Price in integer cents at add-time. Null when the staple was added without a price. */
    priceCents: integer('price_cents'),
    /** The product slug/link from the snapshot, for deep-linking later. Null when none. */
    productSlug: text('product_slug'),
    /**
     * Stable de-dupe key for this staple within a household. Derived from the
     * store + product slug (or the normalised name when there is no slug), so
     * the same product can only be added once.
     */
    productKey: text('product_key').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (t) => ({
    householdProductUnique: uniqueIndex('staple_household_product_unique').on(
      t.householdId,
      t.productKey,
    ),
  }),
)

export type StapleRow = typeof staple.$inferSelect
