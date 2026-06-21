import { createServerFn } from '@tanstack/react-start'
import type { BasketComparison } from './pricing'

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
 * compute is pure (basketForStore / compareBaskets); this fn just wires the
 * vendored catalogue to it lazily so none of it lands client-side.
 *
 * Store coverage is data-driven: we compare every store that actually carries
 * priced products (coveredStoreSlugs), so a new store (Picnic, once #294 lands
 * its data) joins the comparison automatically with no code change here.
 */

/** One line the client sends: the ingredient name + its exact amount string. */
export interface PriceCompareLine {
  name: string
  amount?: string | null
}

export const comparePrices = createServerFn({ method: 'GET' })
  .inputValidator((d: { lines: Array<PriceCompareLine> }) => d)
  .handler(async ({ data }): Promise<BasketComparison> => {
    const lines = data.lines.filter(
      (l) => typeof l.name === 'string' && l.name.trim() !== '',
    )
    if (lines.length === 0) return { baskets: [], cheapest: null }

    const { getCataloguesFor, coveredStoreSlugs } =
      await import('./pricing/catalogue')
    const { compareBaskets } = await import('./pricing/basket')

    const stores = getCataloguesFor(coveredStoreSlugs())
    return compareBaskets(lines, stores)
  })
