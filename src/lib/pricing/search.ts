/**
 * Free-text product search across one or more store catalogues.
 *
 * The staples flow (#124) needs the inverse of the basket matcher: instead of
 * "given a recipe ingredient, find its cheapest store product", the user types
 * a query ("milk", "toilet paper", "coffee") and we surface the best handful of
 * real AH / Jumbo products with their prices so they can tap one onto the week's
 * cart list.
 *
 * It reuses the same token machinery as the matcher (`contentTokens`,
 * `scoreMatch`) so search ranking and basket matching stay consistent, then
 * returns the top-N highest-scoring products. Cheaper products break score ties,
 * matching the "cheapest plausible match wins" rule of the matcher.
 *
 * Pure: no I/O. Catalogues are handed in.
 */

import { contentTokens, scoreMatch } from './match'
import type { StoreCatalogue, StoreProduct } from './types'

/** One search hit: the store product plus its 0..1 relevance score. */
export interface ProductSearchHit {
  product: StoreProduct
  /** The matcher's 0..1 score for this product against the query. */
  score: number
}

/** Tuning for `searchProducts`. */
export interface ProductSearchOptions {
  /** Max hits to return. Default 8. */
  limit?: number
  /** Minimum score a product must clear to be a hit. Default 0.3 (the matcher floor). */
  floor?: number
}

const DEFAULT_LIMIT = 8
const DEFAULT_FLOOR = 0.3

/**
 * Search a set of store catalogues for products matching a free-text query.
 *
 * Returns the top hits ranked by score (descending), with the cheaper product
 * winning a score tie so the list leads with the affordable option. An empty or
 * whitespace-only query returns no hits. Products below the floor are dropped so
 * a noisy query never surfaces irrelevant items.
 */
export function searchProducts(
  query: string,
  stores: ReadonlyArray<StoreCatalogue>,
  options: ProductSearchOptions = {},
): Array<ProductSearchHit> {
  const limit = options.limit ?? DEFAULT_LIMIT
  const floor = options.floor ?? DEFAULT_FLOOR

  const tokens = contentTokens(query)
  if (tokens.length === 0) return []

  const hits: Array<ProductSearchHit> = []
  for (const store of stores) {
    for (const product of store.products) {
      const score = scoreMatch(tokens, product)
      if (score < floor) continue
      hits.push({ product, score })
    }
  }

  hits.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    if (a.product.priceCents !== b.product.priceCents) {
      return a.product.priceCents - b.product.priceCents
    }
    // Stable-ish final tiebreak so the order is deterministic across runs.
    return a.product.name.localeCompare(b.product.name)
  })

  return hits.slice(0, limit)
}
