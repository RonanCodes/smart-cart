import {
  sqliteTable,
  text,
  integer,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'

/**
 * Tip-on-add-to-cart (SQLite / D1). Standalone tables, deliberately NOT part of
 * the main profile schema (src/db/schema.ts) so they ship without regenerating
 * the household migration (the waitlist-schema / staples-schema pattern). The
 * migration is hand-authored alongside 0001_waitlist / 0002_staples; drizzle-kit
 * only sees schema.ts.
 *
 * Souso's revenue is an optional tip the user adds when filling the basket, taken
 * through Mollie (decisions #15-#18). We never charge for groceries (hard rule #1).
 */

/**
 * The monthly free-tier counter: the first 3 add-to-cart actions per period are
 * free, no tip prompt (decision #16). One row per (household, period), where
 * period is a calendar-month string like "2026-06". Incremented as free adds are
 * used; the prompt appears once free_count_used reaches the free limit.
 */
export const tipUsage = sqliteTable(
  'tip_usage',
  {
    id: text('id').primaryKey(),
    householdId: text('household_id').notNull(),
    /** Calendar-month bucket, e.g. "2026-06". */
    period: text('period').notNull(),
    /** How many of the free adds this period have been used. */
    freeCountUsed: integer('free_count_used').notNull().default(0),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (t) => ({
    householdPeriodUnique: uniqueIndex('tip_usage_household_period_unique').on(
      t.householdId,
      t.period,
    ),
  }),
)

/**
 * One row per attempted tip charge. Created when the user confirms a tip; the
 * Mollie webhook re-fetches status and updates this row idempotently. The amount
 * is stored as the 2-decimal string we sent to Mollie (the fee-floor result),
 * `percent` is the chosen whole percent (0 = no tip, recorded but never charged).
 */
export const tipPayment = sqliteTable('tip_payment', {
  id: text('id').primaryKey(),
  householdId: text('household_id').notNull(),
  /** The basket / meal_plan id this tip is attached to, when known. Nullable. */
  basketId: text('basket_id'),
  /** Chosen whole percent (0-5). 0 means "no tip" (no Mollie charge created). */
  percent: integer('percent').notNull(),
  /** The charged amount as a 2-decimal string ("0.50"). Empty for no-tip rows. */
  amount: text('amount').notNull(),
  /** The Mollie payment id (tr_...). Null for no-tip rows (no charge created). */
  molliePaymentId: text('mollie_payment_id'),
  /** Mollie status: open|pending|authorized|paid|canceled|expired|failed, or
   * 'none' for a recorded no-tip add. Updated by the webhook re-fetch. */
  status: text('status').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .$defaultFn(() => new Date())
    .notNull(),
})

export type TipUsageRow = typeof tipUsage.$inferSelect
export type TipPaymentRow = typeof tipPayment.$inferSelect
