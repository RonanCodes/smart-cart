/**
 * Server-side ingredient -> store_product resolver, backed by D1.
 *
 * This is the queryable D1 half of the recipe -> ingredient -> product link
 * (#165). It loads the seeded `store_product` rows for a store, rebuilds the
 * in-memory `StoreCatalogue` (pure `cataloguesFromRows`), and runs the SAME
 * conservative `matchIngredient` scorer the bundled-JSON path uses, so the D1
 * link and the runtime fallback rank products identically. Nothing here is a
 * new model or a new table: it reuses `store_product` (seeded by `pnpm seed`)
 * plus the existing pure pricing modules.
 *
 * Additive + non-regressing: when the `store_product` table is empty (a fresh
 * clone that has not run the seeder) the resolver returns `null` so callers
 * fall back to the bundled runtime catalogue. The working price-compare and
 * cart-link paths keep functioning with zero D1 dependence.
 *
 * Server-only: D1, the drizzle schema, and the catalogue builder are imported
 * INSIDE the handlers (the shopping-list-server / cart-links-server pattern) so
 * none of it leaks into the client bundle. The catalogues are cached per Worker
 * instance keyed by store, since the seeded snapshot does not change per request.
 */

import { createServerFn } from '@tanstack/react-start'
import type { IngredientMatch, StoreCatalogue } from './types'

/** Per-instance cache of the D1-backed catalogue, keyed by lower-cased store. */
const catalogueCache = new Map<string, StoreCatalogue | null>()

/**
 * Load a store's catalogue from the seeded `store_product` rows, rebuilt into
 * the matcher's `StoreCatalogue` shape. Returns `null` (and caches it) when the
 * table holds no rows for that store, which is the signal for callers to fall
 * back to the bundled runtime catalogue. Memoised per store per Worker instance.
 */
export async function loadD1Catalogue(
  store: string,
): Promise<StoreCatalogue | null> {
  const key = store.toLowerCase()
  const cached = catalogueCache.get(key)
  if (cached !== undefined) return cached

  const { getDb } = await import('../../db/client')
  const { storeProduct } = await import('../../db/store-product-schema')
  const { eq } = await import('drizzle-orm')
  const { catalogueFromRows } = await import('./store-product-catalogue')

  const db = await getDb()
  const rows = await db
    .select({
      store: storeProduct.store,
      slug: storeProduct.slug,
      name: storeProduct.name,
      priceCents: storeProduct.priceCents,
      unit: storeProduct.unit,
      raw: storeProduct.raw,
    })
    .from(storeProduct)
    .where(eq(storeProduct.store, key))

  const catalogue =
    rows.length > 0 ? (catalogueFromRows(key, rows) ?? null) : null
  catalogueCache.set(key, catalogue)
  return catalogue
}

/**
 * Resolve one ingredient name to a store product via D1, falling back to the
 * bundled runtime catalogue when D1 has no rows for the store. The result is the
 * same `IngredientMatch` the bundled path produces, so downstream code (cart
 * SKUs, price lines) is identical regardless of which catalogue answered.
 *
 * `source` says which catalogue actually answered, for debugging / telemetry.
 */
export interface ResolvedIngredient {
  match: IngredientMatch
  /** Which catalogue produced the match: the seeded D1 table or the bundle. */
  source: 'd1' | 'bundle'
}

/**
 * Resolve a single ingredient against a store. Pure matching is delegated to
 * `matchIngredient`; this function only chooses the catalogue (D1 first, bundle
 * fallback) and runs it. Exported for reuse by `cart-links-server`.
 */
export async function resolveIngredientForStore(
  name: string,
  store: string,
): Promise<ResolvedIngredient> {
  const { matchIngredient } = await import('./match')

  const d1Catalogue = await loadD1Catalogue(store)
  if (d1Catalogue) {
    const match = matchIngredient(name, d1Catalogue)
    // A real (non-none) D1 match is authoritative; only a no-match falls through
    // to the bundle, which may carry a product the seeded snapshot lacked.
    if (match.confidence !== 'none') return { match, source: 'd1' }
  }

  const { getCatalogue } = await import('./catalogue')
  const bundle = getCatalogue(store)
  if (bundle) return { match: matchIngredient(name, bundle), source: 'bundle' }

  // Neither catalogue exists: hand back a no-match against the requested store.
  if (d1Catalogue)
    return { match: matchIngredient(name, d1Catalogue), source: 'd1' }
  return {
    match: {
      store,
      product: null,
      priceCents: null,
      confidence: 'none',
      estimated: true,
      score: 0,
    },
    source: 'bundle',
  }
}

/**
 * Server fn: resolve a list of ingredient names against a store, D1-first.
 * Used by callers that want the persisted product link surfaced (the recipe
 * detail / admin views) without taking on the bundled-catalogue import cost on
 * the client. Returns one resolution per input name, in order.
 */
export const resolveIngredients = createServerFn({ method: 'GET' })
  .validator((d: { names: Array<string>; store: string }) => d)
  .handler(
    async ({
      data,
    }): Promise<{ store: string; resolved: Array<ResolvedIngredient> }> => {
      const resolved: Array<ResolvedIngredient> = []
      for (const name of data.names) {
        resolved.push(await resolveIngredientForStore(name, data.store))
      }
      return { store: data.store, resolved }
    },
  )

/** Test-only: clear the per-instance catalogue cache between cases. */
export function __resetD1CatalogueCache(): void {
  catalogueCache.clear()
}
