/**
 * The single source of truth for the text we embed for a store product.
 *
 * Shared by the offline embed job (scripts/embed-products.ts) and the in-Worker
 * query path (product-vectors.ts) so both sides embed identical strings. The
 * product name carries almost all of the signal; the pack size is appended only
 * when present because it sometimes disambiguates ("melk 1 l" vs "melk 200 ml").
 *
 * Pure: no I/O.
 */

import type { StoreProduct } from './types'

/** The minimal product fields the embedding text needs. */
export interface ProductForEmbedding {
  name: string
  size?: { raw?: string | null } | null
}

/** Build the embedding text for one product. */
export function productText(p: ProductForEmbedding): string {
  const size = p.size?.raw?.trim()
  return size ? `${p.name.trim()} (${size})` : p.name.trim()
}

/** The vector id for a product. Stable per (store, slug) so upsert is idempotent. */
export function productVectorId(store: string, slug: string | null): string {
  return `${store}:${slug ?? '_'}`
}

/** Convenience for a fully-normalised StoreProduct. */
export function storeProductText(p: StoreProduct): string {
  return productText({ name: p.name, size: { raw: p.size.raw } })
}
