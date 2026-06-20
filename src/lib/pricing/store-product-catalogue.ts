/**
 * Pure inverse of `store-product-rows`: turn `store_product` D1 rows back into
 * the in-memory `StoreCatalogue` shape the matcher (`matchIngredient`) already
 * consumes. No I/O, no DB, no network. The server resolver
 * (`ingredient-resolver-server`) does the D1 query and hands the rows here.
 *
 * Why this exists: the bundled-JSON catalogue (`catalogue.ts`) is the runtime
 * fallback, but #165 wants the SAME conservative matcher run against the SEEDED
 * `store_product` table so the recipe -> ingredient -> product link is queryable
 * in D1 rather than only living as in-memory JSON matching. The seeder stamps
 * the verbatim normalised `StoreProduct` blob into the row's `raw` column, so
 * the cleanest path is to read `raw` straight back into a `StoreProduct`. When a
 * row is missing or has malformed `raw` (older seed, hand-edited row) we
 * reconstruct a minimally-valid product from the flat columns so the matcher
 * still has something to score, never throwing on untrusted DB content.
 *
 * Pure so it unit-tests in isolation and runs identically in the server fn.
 */

import type { ParsedSize, StoreCatalogue, StoreProduct } from './types'
import { normaliseName } from './normalise'

/** The subset of `store_product` columns this module reads. */
export interface StoreProductRowLike {
  store: string
  slug: string | null
  name: string
  priceCents: number | null
  unit: string | null
  /** The verbatim normalised `StoreProduct` blob the seeder stamped in. */
  raw: unknown
}

/** A size dimension with no parsed pack-size, used when a row carries no `raw`. */
const UNKNOWN_SIZE: ParsedSize = {
  raw: '',
  quantity: null,
  unit: null,
  dimension: 'unknown',
  approx: false,
}

/** True when `value` is a usable normalised `StoreProduct` blob. */
function isStoreProduct(value: unknown): value is StoreProduct {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.store === 'string' &&
    typeof v.name === 'string' &&
    typeof v.normalisedName === 'string' &&
    typeof v.priceCents === 'number' &&
    typeof v.size === 'object' &&
    v.size !== null
  )
}

/**
 * Reconstruct one `StoreProduct` from a D1 row. Prefers the verbatim `raw`
 * blob (lossless round-trip from the seeder); falls back to the flat columns
 * when `raw` is absent or malformed. A row with no usable price is dropped by
 * the caller, since the matcher needs a `priceCents` number to compare.
 */
export function rowToStoreProduct(
  row: StoreProductRowLike,
): StoreProduct | null {
  if (isStoreProduct(row.raw)) return row.raw

  // No usable raw blob: rebuild from the flat columns. The matcher only needs
  // store + name + normalisedName + priceCents + size, and scores on the name.
  if (typeof row.priceCents !== 'number') return null
  return {
    store: row.store,
    name: row.name,
    normalisedName: normaliseName(row.name),
    priceCents: row.priceCents,
    slug: row.slug,
    size: row.unit ? { ...UNKNOWN_SIZE, unit: row.unit } : UNKNOWN_SIZE,
  }
}

/**
 * Group `store_product` rows into per-store `StoreCatalogue`s keyed by store
 * slug. Rows that cannot be reconstructed into a priced product are skipped.
 * The `displayName` is the store slug (the D1 row does not carry the human
 * name); callers that need the pretty name resolve it from the bundled
 * catalogue, which is unaffected.
 */
export function cataloguesFromRows(
  rows: ReadonlyArray<StoreProductRowLike>,
): Record<string, StoreCatalogue> {
  const byStore = new Map<string, Array<StoreProduct>>()
  for (const row of rows) {
    const product = rowToStoreProduct(row)
    if (!product) continue
    const list = byStore.get(product.store)
    if (list) list.push(product)
    else byStore.set(product.store, [product])
  }

  const out: Record<string, StoreCatalogue> = {}
  for (const [store, products] of byStore) {
    out[store] = { store, displayName: store, urlBase: null, products }
  }
  return out
}

/** One store's catalogue built from rows, or undefined when it has no products. */
export function catalogueFromRows(
  store: string,
  rows: ReadonlyArray<StoreProductRowLike>,
): StoreCatalogue | undefined {
  return cataloguesFromRows(rows)[store.toLowerCase()]
}
