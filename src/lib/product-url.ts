/**
 * Pure helper: turn a store + product slug into the public product-PAGE URL on
 * that store's site, so a matched ingredient can click through to the actual
 * product the price came from.
 *
 * This is the single-product sibling of `cart-build.ts` (which builds the
 * bulk-CART deep-link). Here we just want to open one product's page, derived
 * from the slug checkjebon already stored on the staple / match. No SKU
 * extraction: the product page uses the full slug verbatim.
 *
 * The URL bases mirror the vendored checkjebon snapshot's per-store `u` field
 * (src/lib/pricing/data/supermarkets.json):
 *
 *  - AH:    https://www.ah.nl/producten/product/<slug>
 *           slug = `wi415202/100-coconut-grove`
 *  - Jumbo: https://www.jumbo.com/producten/<slug>
 *           slug = `11er-spek-rosti-350-g-128692ZK`
 *
 * Client-safe and PURE: no DB, no network, no server-only import, so it is
 * unit-tested and reused on both the admin matching panel and the consumer
 * shopping rows. Returns null when the store is unknown or the slug is empty, so
 * the caller renders no link rather than a broken one (a row with no per-store
 * match shows nothing).
 */

const AH_PRODUCT_BASE = 'https://www.ah.nl/producten/product/'
const JUMBO_PRODUCT_BASE = 'https://www.jumbo.com/producten/'

/**
 * Build the public product-page URL for a matched store product.
 *
 * @param store the store slug the match came from ('ah' | 'jumbo').
 * @param slug  the checkjebon product slug stored on the staple / match.
 * @returns the product-page URL, or null when the store is not one we link to
 *          or the slug is empty / missing.
 */
export function productUrl(
  store: string | null | undefined,
  slug: string | null | undefined,
): string | null {
  if (!store || !slug) return null
  const trimmed = slug.trim()
  if (trimmed.length === 0) return null
  // Keep the slug intact apart from a single accidental leading slash, which
  // would otherwise double up against the base's trailing slash.
  const path = trimmed.replace(/^\/+/, '')
  switch (store.toLowerCase()) {
    case 'ah':
      return `${AH_PRODUCT_BASE}${path}`
    case 'jumbo':
      return `${JUMBO_PRODUCT_BASE}${path}`
    default:
      return null
  }
}
