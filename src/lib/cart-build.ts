/**
 * Pure builder: turn a set of resolved {slug} items into ONE store's bulk-cart
 * deep-link. Client-safe (no DB, no network), so it is unit-tested without a
 * catalogue and reused by the cart-links server fn.
 *
 * The store selector + single "Add to cart" button (#238) sends the WHOLE list,
 * the week's recipe ingredients AND the staples / extras, to the one store the
 * user picked. Each source resolves to a store-specific product slug upstream
 * (recipe lines via the embedding matcher, staples via their saved slug); this
 * helper just extracts the SKU off each slug for the selected store and hands
 * the pairs to the pure URL builders. Decoupling is structural: a build only
 * ever touches the selected store, so picking Jumbo can never also fire AH.
 */

import {
  ahProductId,
  jumboSku,
  ahBulkCartUrl,
  jumboBulkCartUrl,
} from './cart-links'
import type { StoreSlug } from './store-pref-server'

/** A list item already resolved to a store product slug (or null = unmatched). */
export interface ResolvedCartItem {
  /** The store-specific product slug, or null when nothing matched. */
  slug: string | null
}

/** The outcome of building one store's cart link for the whole list. */
export interface BuiltCartLink {
  /** The selected store. */
  store: StoreSlug
  /** The bulk-cart deep-link, or null when no item resolved to a SKU. */
  url: string | null
  /** How many list items resolved to a SKU in this store. */
  matched: number
  /** The total number of list items considered. */
  total: number
}

/**
 * Build the selected store's bulk-cart deep-link for every resolved item.
 *
 * Extracts the store SKU off each item's slug (AH: numeric id before the slash;
 * Jumbo: the trailing dash token), drops the ones that do not resolve, and asks
 * the matching pure URL builder for the deep-link. One of each matched product
 * (qty 1): converting a free-text amount to a reliable pack count is out of
 * scope, so we add a single unit and let the user adjust in-store.
 */
export function buildAllItemsCartUrl(
  store: StoreSlug,
  items: ReadonlyArray<ResolvedCartItem>,
): BuiltCartLink {
  const total = items.length
  const skus: Array<{ sku: string; qty: number }> = []
  for (const item of items) {
    const sku = store === 'ah' ? ahProductId(item.slug) : jumboSku(item.slug)
    if (sku) skus.push({ sku, qty: 1 })
  }
  const url = store === 'ah' ? ahBulkCartUrl(skus) : jumboBulkCartUrl(skus)
  return { store, url, matched: skus.length, total }
}
