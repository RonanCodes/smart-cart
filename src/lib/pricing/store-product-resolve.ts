/**
 * Pure resolver: turn `store_product` D1 rows back into normalised catalogues and
 * match a recipe ingredient against them, reusing the SAME `matchIngredient`
 * scoring as the bundled-catalogue path.
 *
 * Why this exists (#165): the runtime pricing path (src/lib/pricing/*) matches an
 * ingredient against the in-memory checkjebon catalogue (bundled JSON). The
 * `store_product` table (#164) is a queryable D1 copy of that same catalogue, one
 * row per (store, slug), with the normalised `StoreProduct` blob kept verbatim in
 * the `raw` column. So a recipe -> ingredient -> store-product link can be
 * resolved from D1 with the identical token-overlap scoring, without re-deriving
 * the matcher and without a new table.
 *
 * This module is PURE: no DB, no network, no `cloudflare:workers`. The server
 * layer (src/lib/store-product-server.ts) queries the rows and hands them in, so
 * this resolver runs identically in unit tests and on the Worker.
 *
 * The fallback contract lives one layer up (cart-links-server): callers prefer
 * the D1 match when it clears the matcher floor, and fall back to the bundled
 * runtime matcher when D1 holds no plausible product. This module only answers
 * "given these rows, what does the matcher pick?".
 */

import { matchIngredient } from './match'
import type { IngredientMatch, StoreCatalogue, StoreProduct } from './types'

/**
 * The minimal shape of a `store_product` row this resolver needs. Mirrors a
 * subset of `StoreProductRow` (src/db/store-product-schema.ts) so the server can
 * pass straight-from-D1 rows, and so the pure layer carries no Drizzle/D1 type.
 */
export interface StoreProductRowLike {
  id: string
  store: string
  slug: string | null
  name: string
  priceCents: number | null
  /** The normalised `StoreProduct` blob the seeder stored verbatim, when present. */
  raw: unknown
}

/**
 * Reconstruct a normalised `StoreProduct` from a D1 row.
 *
 * The seeder stored the full normalised product in `raw`, so prefer that (it
 * carries the parsed `size` the matcher's catalogue siblings have). When `raw`
 * is missing or malformed we rebuild a usable product from the flat columns:
 * a row with no price is dropped (the matcher must never invent a price), and a
 * row with no slug keeps `slug: null` exactly like the bundled path.
 */
export function rowToStoreProduct(
  row: StoreProductRowLike,
): StoreProduct | null {
  const fromRaw = coerceRawProduct(row.raw)
  if (fromRaw) return fromRaw

  if (row.priceCents === null || !row.name.trim()) return null
  return {
    store: row.store,
    name: row.name,
    normalisedName: normaliseFallback(row.name),
    priceCents: row.priceCents,
    slug: row.slug,
    size: {
      raw: '',
      quantity: null,
      unit: null,
      dimension: 'unknown',
      approx: false,
    },
  }
}

/** A row's `raw` blob is a normalised StoreProduct iff it has the load-bearing fields. */
function coerceRawProduct(raw: unknown): StoreProduct | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (
    typeof r.store !== 'string' ||
    typeof r.name !== 'string' ||
    typeof r.normalisedName !== 'string' ||
    typeof r.priceCents !== 'number' ||
    typeof r.size !== 'object' ||
    r.size === null
  ) {
    return null
  }
  return {
    store: r.store,
    name: r.name,
    normalisedName: r.normalisedName,
    priceCents: r.priceCents,
    slug: typeof r.slug === 'string' ? r.slug : null,
    size: r.size as StoreProduct['size'],
  }
}

/**
 * Minimal name-normalisation fallback for rows whose `raw` blob was lost. Kept
 * tiny and local: lower-case + collapse whitespace is enough for the matcher's
 * own `contentTokens` to re-tokenise. The bundled path's full `normaliseName`
 * still runs on the ingredient side, so a coarse product side is acceptable here.
 */
function normaliseFallback(name: string): string {
  return name.toLowerCase().replace(/\s+/g, ' ').trim()
}

/**
 * Group D1 rows into one normalised `StoreCatalogue` per store slug.
 *
 * Rows that cannot be rebuilt into a priced product are dropped (same rule as
 * the bundled normaliser). The result is the exact `StoreCatalogue` shape
 * `matchIngredient` already consumes, so no scoring code is duplicated.
 */
export function catalogueFromRows(
  rows: ReadonlyArray<StoreProductRowLike>,
): Map<string, StoreCatalogue> {
  const byStore = new Map<string, StoreCatalogue>()
  for (const row of rows) {
    const product = rowToStoreProduct(row)
    if (!product) continue
    let cat = byStore.get(product.store)
    if (!cat) {
      cat = {
        store: product.store,
        displayName: product.store,
        urlBase: null,
        products: [],
      }
      byStore.set(product.store, cat)
    }
    cat.products.push(product)
  }
  return byStore
}

/**
 * Resolve one ingredient name against the D1-sourced catalogue for one store.
 *
 * Returns the SAME `IngredientMatch` the bundled matcher returns (a no-match is
 * `{ product: null, confidence: 'none', estimated: true }`), so the caller's
 * "prefer D1, else fall back to bundled" logic reads identically on both sides.
 * When the store has no rows we hand `matchIngredient` an empty catalogue, which
 * yields the standard no-match.
 */
export function resolveIngredientFromRows(
  name: string,
  store: string,
  catalogues: Map<string, StoreCatalogue>,
): IngredientMatch {
  const cat = catalogues.get(store.toLowerCase()) ?? {
    store: store.toLowerCase(),
    displayName: store,
    urlBase: null,
    products: [],
  }
  return matchIngredient(name, cat)
}
