import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

/**
 * Feature-flag state (SQLite / D1). Standalone table, NOT part of the main
 * profile schema (src/db/schema.ts), matching the launch_state / payment_mode /
 * data_mode pattern so it ships on its own hand-written migration (drizzle-kit
 * only sees schema.ts).
 *
 * One row per flag key. The ABSENCE of a row means "use the hardcoded default"
 * (FLAG_DEFAULTS in lib/flags.ts), so a fresh / empty table lands on the safe
 * conservative defaults rather than an undefined state. Each environment has its
 * own D1 (smart_cart_db vs smart_cart_db_dev), so dev and prod flag values are
 * fully independent with no extra config. The admin Flags panel upserts these
 * rows; lib/flags-server.ts reads them and merges over the defaults.
 */
export const featureFlag = sqliteTable('feature_flag', {
  /** The flag key, e.g. 'store.jumbo.visible'. One row per key. */
  key: text('key').primaryKey(),
  /** The flag's on/off state. */
  enabled: integer('enabled', { mode: 'boolean' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .$defaultFn(() => new Date())
    .notNull(),
})

export type FeatureFlagRow = typeof featureFlag.$inferSelect
