import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

/**
 * App data mode (real vs demo) for the pitch demo (SQLite / D1). Standalone
 * table, NOT part of the main profile schema (src/db/schema.ts), matching the
 * payment-mode / waitlist / staples / tip / admin-prefs pattern so it ships on
 * its own hand-written migration (drizzle-kit only sees schema.ts).
 *
 * Scoped rows: `scope='global'` is the app-wide default that applies to every
 * household with no override. Any OTHER scope value is a `householdId` override
 * (real or demo just for that household). The effective mode for a household is:
 * its override row ?? the global row ?? 'real' (real is the safe default — the
 * app shows the household's actual DB-backed data). A row only EXISTS to record
 * an explicit choice; the absence of the global row means 'real'.
 *
 * 'demo' makes the REAL app screens render TJ's canned data (a fixed week + cart)
 * instead of the DB, so the pitch flow is fast + deterministic without seeding an
 * account. The UI is unchanged; only the loaders swap their data source.
 */
export const dataMode = sqliteTable('data_mode', {
  /** 'global' for the app-wide default, otherwise a householdId override. */
  scope: text('scope').primaryKey(),
  /** 'real' | 'demo'. Validated strictly server-side before any write. */
  mode: text('mode').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .$defaultFn(() => new Date())
    .notNull(),
})

export type DataModeRow = typeof dataMode.$inferSelect
