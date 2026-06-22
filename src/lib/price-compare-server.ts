import { createServerFn } from '@tanstack/react-start'
import type { BasketComparison, StoreBasket } from './pricing'

/**
 * Server seam for the shopping-tab price comparison (#293).
 *
 * The vendored checkjebon catalogue is ~4 MB, so the matching + pack-rounding +
 * waste maths MUST run on the server and ship only the small comparison result
 * to the client (the catalogue never reaches the bundle, same rule as
 * match-server.ts). The client already holds the shopping items, so it passes
 * the list of {name, amount} in and gets a per-store basket back.
 *
 * No auth gate here: the only input is the list the caller already loaded
 * through the authed shopping route, and the output is public price data. The
 * compute uses the embedding resolver + pack-rounding (ADR-0004); this fn wires
 * the vendored catalogue to it lazily so none of it lands client-side.
 *
 * Store coverage is data-driven: we compare every store that actually carries
 * priced products (coveredStoreSlugs), so a new store (Picnic, once #294 lands
 * its data) joins the comparison automatically with no code change here.
 *
 * Accurate-tier total (#plan-cart-mismatch): the displayed total + per-item
 * prices now resolve lines with the SAME accurate matcher the cart/deep-link uses
 * (expand + multi-query retrieval + LLM rerank, ADR-0004), so the shown € exactly
 * matches what cart-build adds to Albert Heijn. That tier costs an LLM call per
 * line and runs for every covered store on every list change, so it goes through
 * resolveLinesForStoreCached: a (store, normalised name) -> product resolution is
 * paid for ONCE (D1 persistent cache + per-instance in-memory tier), price stays
 * fresh from the catalogue. ADR-0004's cost warning is accepted; the cache softens
 * it. First-load latency for a large, cold-cache list is the known trade-off.
 */

/** One line the client sends: the ingredient name + its exact amount string. */
export interface PriceCompareLine {
  name: string
  amount?: string | null
}

export const comparePrices = createServerFn({ method: 'POST' })
  .inputValidator((d: { lines: Array<PriceCompareLine> }) => d)
  .handler(async ({ data }): Promise<BasketComparison> => {
    const lines = data.lines.filter(
      (l) => typeof l.name === 'string' && l.name.trim() !== '',
    )
    if (lines.length === 0) return { baskets: [], cheapest: null }

    const { getCataloguesFor, coveredStoreSlugs } =
      await import('./pricing/catalogue')
    const { basketForStoreWithMatches } = await import('./pricing/basket')
    const { resolveLinesForStoreCached } = await import('./pricing/match-cache')

    const stores = getCataloguesFor(coveredStoreSlugs())
    const baskets = await Promise.all(
      stores.map(async (store) => {
        // Resolve with the ACCURATE tier (cache-aware) so the displayed total +
        // per-item prices match the basket cart-build adds. The amount feeds the
        // rerank's pack size-match. A per-line failure degrades to a no-match
        // inside the resolver, so it never throws the whole comparison.
        const resolved = await resolveLinesForStoreCached(lines, store.store)
        return basketForStoreWithMatches(lines, resolved, store)
      }),
    )
    let cheapest: (typeof baskets)[number] | null = null
    for (const b of baskets) {
      if (b.lineItems.length === 0) continue
      if (cheapest === null || b.totalCents < cheapest.totalCents) cheapest = b
    }
    return { baskets, cheapest }
  })

/**
 * The covered store slugs the comparison should price, resolved server-side so
 * the catalogue never reaches the client (#439). Cheap: it only reads the
 * vendored catalogue's store keys, no matching. The client fans out one
 * {@link comparePriceForStore} call per slug so the cart renders immediately and
 * each store's total fills in as it resolves, instead of one slow call blocking
 * on every store's accurate-tier matching at once.
 */
export const listCompareStores = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Array<string>> => {
    const { coveredStoreSlugs } = await import('./pricing/catalogue')
    return coveredStoreSlugs()
  },
)

/**
 * Price ONE store's basket with the accurate (cache-aware) tier (#439). Same
 * maths as {@link comparePrices} but for a single store, so the client can fan
 * out the covered stores in parallel and let each total arrive independently
 * (progressive fill) rather than waiting for the slowest store. Returns null
 * when the store isn't a covered/known store or there are no priceable lines.
 */
export const comparePriceForStore = createServerFn({ method: 'POST' })
  .inputValidator((d: { store: string; lines: Array<PriceCompareLine> }) => d)
  .handler(async ({ data }): Promise<StoreBasket | null> => {
    const lines = data.lines.filter(
      (l) => typeof l.name === 'string' && l.name.trim() !== '',
    )
    if (lines.length === 0) return null

    const { getCatalogue } = await import('./pricing/catalogue')
    const { basketForStoreWithMatches } = await import('./pricing/basket')
    const { resolveLinesForStoreCached } = await import('./pricing/match-cache')

    const catalogue = getCatalogue(data.store)
    if (!catalogue) return null

    const resolved = await resolveLinesForStoreCached(lines, catalogue.store)
    return basketForStoreWithMatches(lines, resolved, catalogue)
  })
