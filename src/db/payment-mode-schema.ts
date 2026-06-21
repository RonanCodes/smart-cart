import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

/**
 * Mollie payment mode (test vs live) for the tip flow (SQLite / D1). Standalone
 * table, NOT part of the main profile schema (src/db/schema.ts), matching the
 * waitlist / staples / tip / admin-prefs pattern so it ships on its own
 * hand-written migration (drizzle-kit only sees schema.ts).
 *
 * Scoped rows: `scope='global'` is the app-wide default that applies to every
 * household with no override. Any OTHER scope value is a `householdId` override
 * (test or live just for that household). The effective mode for a household is:
 * its override row ?? the global row ?? 'test' (test is the never-charge-real-
 * money fallback). A row only EXISTS to record an explicit choice; the absence
 * of the global row means 'test'.
 */
export const paymentMode = sqliteTable('payment_mode', {
  /** 'global' for the app-wide default, otherwise a householdId override. */
  scope: text('scope').primaryKey(),
  /** 'test' | 'live'. Validated strictly server-side before any write. */
  mode: text('mode').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .$defaultFn(() => new Date())
    .notNull(),
})

export type PaymentModeRow = typeof paymentMode.$inferSelect
