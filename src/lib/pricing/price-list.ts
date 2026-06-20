/**
 * Per-store basket totalling + cross-store comparison.
 *
 * Given the consolidated shopping lines (the #78 `ShoppingLine` shape) and a set
 * of store catalogues, produce a per-store total and flag exactly which lines
 * were estimated, so the price-compare UI (#92) can show an honest "you save X"
 * that never quietly leans on a synthetic price.
 *
 * Pure: no I/O.
 */

import { matchIngredient } from './match'
import type {
  CrossStorePrice,
  PricedLine,
  StoreCatalogue,
  StorePriceList,
} from './types'

/** The minimal shape this layer needs from a shopping line: just the name. */
export interface PriceableLine {
  name: string
}

/**
 * Price one shopping list against one store.
 *
 * `totalCents` sums every matched line (estimated included) so the number is a
 * real basket estimate; `hasSoftTotal` + `estimatedCount` + `missingCount` tell
 * the caller how much of it is soft. A missing line contributes nothing to the
 * total but is counted so the UI can warn that the basket is incomplete.
 */
export function priceListForStore(
  lines: ReadonlyArray<PriceableLine>,
  store: StoreCatalogue,
): StorePriceList {
  const priced: Array<PricedLine> = []
  let totalCents = 0
  let matchedCount = 0
  let estimatedCount = 0
  let missingCount = 0

  for (const line of lines) {
    const match = matchIngredient(line.name, store)
    priced.push({ name: line.name, match })
    if (match.confidence === 'none' || match.priceCents === null) {
      missingCount += 1
      continue
    }
    matchedCount += 1
    totalCents += match.priceCents
    if (match.estimated) estimatedCount += 1
  }

  return {
    store: store.store,
    displayName: store.displayName,
    totalCents,
    lines: priced,
    matchedCount,
    estimatedCount,
    missingCount,
    hasSoftTotal: estimatedCount > 0 || missingCount > 0,
  }
}

/**
 * Price a shopping list across many stores and pick the cheapest.
 *
 * `cheapestConfident` is the cheapest store whose total has NO soft lines (safe
 * for a hard savings claim). `cheapestOverall` is the cheapest by raw total
 * regardless of softness (always present when at least one store matched
 * anything). When `cheapestConfident` is null, the UI must hedge the claim.
 *
 * Stores are priced in the order given; ties resolve to the earlier store.
 */
export function priceListAcrossStores(
  lines: ReadonlyArray<PriceableLine>,
  stores: ReadonlyArray<StoreCatalogue>,
): CrossStorePrice {
  const perStore = stores.map((store) => priceListForStore(lines, store))

  const matched = perStore.filter((s) => s.matchedCount > 0)
  const cheapestOverall = pickCheapest(matched)
  const cheapestConfident = pickCheapest(matched.filter((s) => !s.hasSoftTotal))

  return { perStore, cheapestConfident, cheapestOverall }
}

/** Lowest `totalCents`, earliest on a tie. Null for an empty list. */
function pickCheapest(
  lists: ReadonlyArray<StorePriceList>,
): StorePriceList | null {
  let best: StorePriceList | null = null
  for (const list of lists) {
    if (best === null || list.totalCents < best.totalCents) best = list
  }
  return best
}

/** Format integer cents as a euro string ("1234" -> "€12.34"). UI convenience. */
export function formatCents(cents: number): string {
  const euros = (cents / 100).toFixed(2)
  return `€${euros}`
}
