/**
 * One-click bulk-cart deep-links for Albert Heijn and Jumbo.
 *
 * The point: turn the household's shopping list into a single tap that opens the
 * store with every matched item pre-loaded into its cart / list. No store login,
 * no OAuth, no credentials, no new secrets. We just build the public URL the
 * store already honours and open it in a new tab.
 *
 * The two formats (ported from TJ's slimmandje-api auth-free cart links):
 *
 *  - AH:    https://www.ah.nl/mijnlijst/add-multiple?p=<numId>:<qty>&p=<numId>:<qty>...
 *           numId is the AH product id with any leading `wi` stripped, so the
 *           checkjebon slug `wi415202/100-coconut-grove` becomes `415202`.
 *
 *  - Jumbo: https://www.jumbo.com/mandje/?add=<URL-encoded JSON [{sku, quantity}]>
 *           the SKU is the trailing product code on the checkjebon slug, so
 *           `11er-spek-rosti-350-g-128692ZK` becomes `128692ZK`.
 *
 * This module is PURE and client-safe: no DB, no network, no server-only import.
 * The resolution from a shopping list to {sku, qty} pairs lives server-side
 * (cart-links-server.ts) because it touches the pricing catalogue; these
 * builders only take the already-resolved pairs.
 */

/** One item to add to a store cart: a store SKU plus a quantity. */
export interface CartLineItem {
  /** The store-specific product SKU (already extracted from the slug). */
  sku: string
  /** How many to add. Clamped to a sane 1..99 by the builders. */
  qty: number
}

const AH_BULK_BASE = 'https://www.ah.nl/mijnlijst/add-multiple'
const JUMBO_CART_BASE = 'https://www.jumbo.com/mandje/'

/** Clamp a quantity to a whole number in 1..99 (a deep-link is not a warehouse). */
function clampQty(qty: number): number {
  if (!Number.isFinite(qty)) return 1
  const n = Math.round(qty)
  if (n < 1) return 1
  if (n > 99) return 99
  return n
}

/**
 * Extract the AH numeric product id from a checkjebon AH slug.
 *
 * The slug looks like `wi415202/100-coconut-grove`; the id is the part before
 * the first `/`, with a leading `wi` stripped. Returns null when the slug has no
 * usable id (so the line is skipped rather than producing a broken `p=` token).
 */
export function ahProductId(slug: string | null | undefined): string | null {
  if (!slug) return null
  const head = slug.split('/')[0]?.trim() ?? ''
  const id = head.replace(/^wi/i, '').trim()
  return id.length > 0 ? id : null
}

/**
 * Extract the Jumbo product SKU from a checkjebon Jumbo slug.
 *
 * The slug looks like `11er-spek-rosti-350-g-128692ZK`; the SKU is the trailing
 * dash-separated token (e.g. `128692ZK`, `764448PAK`). Returns null when the
 * slug is empty.
 */
export function jumboSku(slug: string | null | undefined): string | null {
  if (!slug) return null
  const trimmed = slug.trim()
  if (trimmed.length === 0) return null
  const parts = trimmed.split('-')
  const tail = parts[parts.length - 1]?.trim() ?? ''
  return tail.length > 0 ? tail : trimmed
}

/**
 * Build the AH bulk-cart deep-link for a set of {sku, qty} items.
 *
 * Each item becomes a `p=<sku>:<qty>` query parameter. Items with an empty SKU
 * are dropped. Returns null when nothing remains, so the caller can disable the
 * button rather than open a link that adds nothing.
 */
export function ahBulkCartUrl(
  items: ReadonlyArray<CartLineItem>,
): string | null {
  const params = items
    .filter((i) => i.sku.trim().length > 0)
    .map((i) => `p=${encodeURIComponent(i.sku.trim())}:${clampQty(i.qty)}`)
  if (params.length === 0) return null
  return `${AH_BULK_BASE}?${params.join('&')}`
}

/**
 * Build the Jumbo bulk-cart deep-link for a set of {sku, qty} items.
 *
 * The query is a single `add` parameter holding a URL-encoded JSON array of
 * `{ sku, quantity }` objects. Items with an empty SKU are dropped. Returns null
 * when nothing remains.
 */
export function jumboBulkCartUrl(
  items: ReadonlyArray<CartLineItem>,
): string | null {
  const payload = items
    .filter((i) => i.sku.trim().length > 0)
    .map((i) => ({ sku: i.sku.trim(), quantity: clampQty(i.qty) }))
  if (payload.length === 0) return null
  return `${JUMBO_CART_BASE}?add=${encodeURIComponent(JSON.stringify(payload))}`
}
