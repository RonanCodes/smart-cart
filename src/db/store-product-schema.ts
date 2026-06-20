import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core'

/**
 * Store products (SQLite / D1). A queryable, additive copy of the vendored
 * checkjebon catalogue (src/lib/pricing/data/supermarkets.json), seeded by
 * `pnpm seed`. Standalone table, deliberately NOT part of the main profile
 * schema (src/db/schema.ts) so it ships without regenerating the household
 * migration (the waitlist / staples pattern).
 *
 * This does NOT replace the bundled-JSON pricing path: the price-compare layer
 * (src/lib/pricing/*) still reads the in-memory catalogue for its set-maths.
 * This table is an additive D1 copy so the catalogue can be queried with SQL
 * (search, joins, admin) and so a fresh clone / CI / prod all hold the same
 * ingredient data, seeded reproducibly rather than relying on the bundle alone.
 *
 * One row per (store, slug). `id` is the stable de-dupe key `<store>:<slug>`
 * (or `<store>:<normalisedName>` when the source row has no slug), so re-seeding
 * the same product is idempotent. `priceCents` / `unit` are null when the source
 * row carried no usable price / pack-size unit. `raw` keeps the normalised
 * product blob verbatim for debugging and future re-shaping.
 */
export const storeProduct = sqliteTable(
  'store_product',
  {
    /** Stable PK: `<store>:<slug>` (or `<store>:<normalisedName>` when no slug). */
    id: text('id').primaryKey(),
    /** Store slug this product belongs to ('ah' | 'jumbo' | ...). */
    store: text('store').notNull(),
    /** The product slug/link from the snapshot, or null when the source had none. */
    slug: text('slug'),
    /** Product display name ('Halfvolle melk'). */
    name: text('name').notNull(),
    /** Price in integer cents, or null when the source row had no usable price. */
    priceCents: integer('price_cents'),
    /** Canonical pack-size unit ('g', 'l', 'stuks'), or null when unparseable. */
    unit: text('unit'),
    /** The normalised product blob, kept verbatim as the source of truth. */
    raw: text('raw', { mode: 'json' }).$type<Record<string, unknown>>(),
    /**
     * Base64-encoded Float32 embedding of the product name (ADR-0004), built
     * offline by scripts/embed-catalogue.ts and loaded by `pnpm seed`. Null until
     * the catalogue is embedded. Powers semantic ingredient->SKU matching.
     */
    embedding: text('embedding'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (t) => ({
    storeIdx: index('store_product_store_idx').on(t.store),
  }),
)

export type StoreProductRow = typeof storeProduct.$inferSelect
