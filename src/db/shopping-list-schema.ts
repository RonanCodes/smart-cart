import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core'

/**
 * Persisted shopping-list items (SQLite / D1). Standalone table, deliberately
 * NOT part of the main profile schema (src/db/schema.ts) so it can ship without
 * regenerating the household migration (the waitlist / staples pattern).
 *
 * The Shopping tab used to DERIVE its list fresh from the week every load, so
 * any tick or edit vanished on reload. This table is the durable store behind
 * the list: the "add the week to my list" CTA writes the consolidated recipe
 * ingredients here, and every subsequent edit (rename, re-amount, tick, add,
 * remove) persists so the list survives a reload.
 *
 * One row per item, scoped to the household. `source` records where the row
 * came from ('recipe' = added from the week, 'staple' = a saved staple item,
 * 'manual' = the user typed it in) so the UI can show a small context label and
 * the merge can treat them uniformly. `amount` is the free-text amount the
 * engine produced ('450 g', '2 + 15 g') or the user typed; null when none.
 * `checked` is the ticked-off state, stored as an integer boolean.
 */
export const shoppingListItem = sqliteTable(
  'shopping_list_item',
  {
    id: text('id').primaryKey(),
    householdId: text('household_id').notNull(),
    /** The item name shown on the list ('Onion'). */
    name: text('name').notNull(),
    /** Free-text amount ('450 g', '2 + 15 g'), or null when unspecified. */
    amount: text('amount'),
    /** Canonical unit when the engine resolved one ('g', 'ml'), else null. */
    unit: text('unit'),
    /** Ticked-off state, integer boolean (0/1). */
    checked: integer('checked', { mode: 'boolean' }).notNull().default(false),
    /** Where the row came from: 'recipe' | 'staple' | 'manual'. */
    source: text('source').notNull().default('manual'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (t) => ({
    householdIdx: index('shopping_list_item_household_idx').on(t.householdId),
  }),
)

export type ShoppingListItemRow = typeof shoppingListItem.$inferSelect
