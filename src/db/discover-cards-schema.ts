import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

/**
 * Discover-feed card cache (SQLite / D1). Standalone table, deliberately NOT part
 * of the main profile schema (src/db/schema.ts) so it ships without regenerating
 * the household migration (the recipe-facts / waitlist / staples pattern; the
 * migration is hand-authored, drizzle-kit only sees schema.ts).
 *
 * The Discover feed surfaces 4-5 source-cited "ideas" cards (in-season produce,
 * a nutrition fact, a cuisine spotlight, a fun food fact), each tailored to the
 * household's profile and fetched from Cala (cala.ai). Cala charges 1 credit per
 * search, so a full feed is several credits; we cache the whole assembled feed
 * keyed by household and regenerate only when it ages past the TTL (24h) or the
 * household explicitly refreshes. One row per household.
 */
export const discoverCards = sqliteTable('discover_cards', {
  /** The household these cards belong to. One row per household. */
  householdId: text('household_id').primaryKey(),
  /** JSON-encoded Array<DiscoverCard> (id, title, content, sources). */
  cardsJson: text('cards_json').notNull(),
  /** When we generated + cached this feed, so the TTL can age it out. */
  generatedAt: integer('generated_at', { mode: 'timestamp' })
    .$defaultFn(() => new Date())
    .notNull(),
})

export type DiscoverCardsRow = typeof discoverCards.$inferSelect
