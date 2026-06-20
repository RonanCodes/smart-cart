/**
 * Server-side resolver: recipe ingredient names -> matched `store_product` rows
 * (store + slug/SKU + price) by querying the seeded D1 table (#164, #165).
 *
 * This is the D1-backed sibling of the bundled-catalogue runtime matcher. It
 * loads the `store_product` rows for the requested stores, hands them to the
 * PURE resolver (src/lib/pricing/store-product-resolve.ts) which reuses the same
 * `matchIngredient` scoring, and returns one `IngredientMatch` per (name, store).
 *
 * Additive + non-regressing: the bundled in-memory path is untouched and stays
 * the fallback. Callers (cart-links-server) prefer a D1 match when it lands and
 * fall back to the bundled matcher when D1 holds no plausible product, so a
 * fresh clone / CI / prod resolve from the same seeded data while older code
 * paths keep working unchanged.
 *
 * Server-only: every DB import is INSIDE the handler so nothing leaks into the
 * client bundle (the shopping-list-server / cart-links-server pattern). All
 * queries are reads; this module never writes.
 */

import { createServerFn } from '@tanstack/react-start'
import type { IngredientMatch } from './pricing/types'

/** One resolved line: the ingredient name, the store, and its D1 match. */
export interface ResolvedProductLine {
  name: string
  store: string
  match: IngredientMatch
}

/**
 * Load the `store_product` rows for a set of stores, as the pure resolver's
 * `StoreProductRowLike` shape. Server-only. The standalone `store_product` table
 * is NOT part of the household schema bundle, so it is imported directly here.
 */
async function loadProductRows(stores: ReadonlyArray<string>) {
  const { getDb } = await import('../db/client')
  const { storeProduct } = await import('../db/store-product-schema')
  const { inArray } = await import('drizzle-orm')
  const db = await getDb()
  const slugs = stores.map((s) => s.toLowerCase())
  const rows = await db
    .select({
      id: storeProduct.id,
      store: storeProduct.store,
      slug: storeProduct.slug,
      name: storeProduct.name,
      priceCents: storeProduct.priceCents,
      raw: storeProduct.raw,
    })
    .from(storeProduct)
    .where(inArray(storeProduct.store, slugs))
  return rows
}

/**
 * Resolve a list of ingredient names against the D1 `store_product` catalogue
 * for the given stores. Pure matching is delegated; this only does the I/O.
 *
 * Returns one line per (name, store) in input order, so a caller can pick the
 * D1 slug when the match lands and fall back to its own runtime matcher when it
 * does not. Reusable as a plain async helper (used by cart-links-server) as well
 * as via the server fn below.
 */
export async function resolveIngredientsToProducts(
  names: ReadonlyArray<string>,
  stores: ReadonlyArray<string>,
): Promise<Array<ResolvedProductLine>> {
  if (names.length === 0 || stores.length === 0) return []
  const { catalogueFromRows, resolveIngredientFromRows } =
    await import('./pricing/store-product-resolve')
  const rows = await loadProductRows(stores)
  const catalogues = catalogueFromRows(rows)
  const out: Array<ResolvedProductLine> = []
  for (const name of names) {
    for (const store of stores) {
      out.push({
        name,
        store: store.toLowerCase(),
        match: resolveIngredientFromRows(name, store, catalogues),
      })
    }
  }
  return out
}

/**
 * Server fn: resolve a recipe's ingredient names to `store_product` matches.
 *
 * Defaults to the two cart stores (AH + Jumbo). Surfaced so a recipe detail / cart
 * view can show the persisted product link + price per ingredient, queried from D1
 * rather than only matched at runtime.
 */
export const resolveRecipeIngredients = createServerFn({ method: 'GET' })
  .validator((input: { names: Array<string>; stores?: Array<string> }) => input)
  .handler(async ({ data }): Promise<Array<ResolvedProductLine>> => {
    const stores =
      data.stores && data.stores.length > 0 ? data.stores : ['ah', 'jumbo']
    return resolveIngredientsToProducts(data.names, stores)
  })
