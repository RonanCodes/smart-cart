import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core'

/**
 * Resolved-match cache (SQLite / D1). Standalone table, deliberately NOT part of
 * the main profile schema (src/db/schema.ts) so it ships without regenerating
 * the household migration (the waitlist-schema / staples-schema / store_product
 * pattern).
 *
 * Why this exists: the shopping-tab price comparison resolves lines with the
 * cart matcher (raw embedding fast path, then expand + multi-query retrieval +
 * LLM rerank only when ambiguous, ADR-0004) so the displayed total exactly
 * matches the basket cart-build adds to Albert Heijn. Cold misses can still cost
 * model calls and run for EVERY covered store on every list change / store
 * switch. The name -> product resolution is stable, so we cache the RESOLVED
 * MATCH (not the price) keyed by (store, normalised name[, amount]).
 *
 * Read-through + write-on-miss: a cache hit rebuilds the IngredientMatch by
 * looking the slug up in the in-memory catalogue, so the PRICE stays fresh from
 * the catalogue (the cache only short-circuits the expensive name -> product
 * step). A genuine no-match is cached too (slug null) so we do not re-pay model
 * cost to rediscover that an ingredient has no plausible product.
 *
 * One row per (store, normalisedName[, amount]). `id` is the stable key
 * `<store>:<name>` or `<store>:<name>:<amount>` so a re-resolution is an
 * idempotent upsert. `slug` null means "resolved, but no plausible match" (a
 * cached negative). `confidence` is carried so the rebuilt match keeps the same
 * soft/hard semantics the UI relies on.
 */
export const matchCache = sqliteTable(
  'match_cache',
  {
    /** Stable PK: `<store>:<normalisedName>` or with amount suffix when set. */
    id: text('id').primaryKey(),
    /** Store slug this resolution belongs to ('ah' | 'jumbo' | ...). */
    store: text('store').notNull(),
    /** The normalised ingredient name that was resolved. */
    normalisedName: text('normalised_name').notNull(),
    /** Resolved product slug, or null for a cached negative (no plausible match). */
    slug: text('slug'),
    /** Match confidence band at resolution time ('high' | 'medium' | 'low'). */
    confidence: text('confidence').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (t) => ({
    storeIdx: index('match_cache_store_idx').on(t.store),
  }),
)

export type MatchCacheRow = typeof matchCache.$inferSelect
