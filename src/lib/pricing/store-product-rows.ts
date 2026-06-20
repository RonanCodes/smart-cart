/**
 * Pure data-shaping: normalised catalogue `StoreProduct` -> a `store_product`
 * D1 row. No I/O, no DB, no network. The seeder (scripts/seed.ts) builds the
 * catalogues, calls `toStoreProductRow` per product, de-dupes by `id`, and
 * upserts the rows; this module is unit-tested in isolation.
 *
 * Why a stable derived `id`: the D1 table keys on `(store, slug)`, but the
 * checkjebon snapshot leaves some products without a slug. We fall back to the
 * normalised name so every row still has a deterministic primary key, which
 * keeps re-seeding idempotent (INSERT OR REPLACE on the same id is a no-op).
 */

import type { StoreProduct } from './types'

/** A flat row mirroring the `store_product` table columns (no createdAt; the
 * seeder stamps that uniformly so a re-seed does not churn timestamps). */
export interface StoreProductRowInput {
  id: string
  store: string
  slug: string | null
  name: string
  priceCents: number | null
  unit: string | null
  raw: StoreProduct
}

/**
 * Stable primary key for a catalogue product: `<store>:<slug>` when a slug is
 * present, else `<store>:<normalisedName>`. Deterministic so re-seeding the same
 * snapshot produces the same ids (idempotent upsert).
 */
export function storeProductId(product: StoreProduct): string {
  const key =
    product.slug && product.slug.trim()
      ? product.slug.trim()
      : product.normalisedName
  return `${product.store}:${key}`
}

/** Shape one normalised catalogue product into a `store_product` row input. */
export function toStoreProductRow(product: StoreProduct): StoreProductRowInput {
  return {
    id: storeProductId(product),
    store: product.store,
    slug: product.slug ?? null,
    name: product.name,
    priceCents: product.priceCents,
    unit: product.size.unit ?? null,
    raw: product,
  }
}

/**
 * Shape every product in a flat catalogue array into rows, de-duping by `id`
 * (last write wins). De-duping here keeps the SQL `INSERT OR REPLACE` batch
 * free of duplicate-PK rows within a single statement, which SQLite rejects.
 */
export function toStoreProductRows(
  products: ReadonlyArray<StoreProduct>,
): Array<StoreProductRowInput> {
  const byId = new Map<string, StoreProductRowInput>()
  for (const product of products) {
    const row = toStoreProductRow(product)
    byId.set(row.id, row)
  }
  return [...byId.values()]
}
