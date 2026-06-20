/**
 * Load the vendored checkjebon snapshot into normalised catalogues.
 *
 * The JSON is imported at build time (bundled, no request-path fetch, per the
 * #45 research's "never live-fetch on the user request" rule). `getCatalogues`
 * memoises the normalisation so the parse cost is paid once.
 *
 * Provenance + licence/ToS caveat: `./data/NOTICE.md`. This is a scraped,
 * MIT-licensed snapshot; fine for a pre-revenue demo, revisit before any
 * commercial NL launch.
 */

import supermarkets from './data/supermarkets.json'
import { buildCatalogues } from './normalise'
import type { StoreCatalogue, StoreCatalogues } from './types'

let cache: StoreCatalogues | null = null

/** All normalised store catalogues, keyed by store slug. Memoised. */
export function getCatalogues(): StoreCatalogues {
  if (cache === null) {
    cache = buildCatalogues(supermarkets)
  }
  return cache
}

/** One store's catalogue, or undefined when the store is not in the snapshot. */
export function getCatalogue(store: string): StoreCatalogue | undefined {
  return getCatalogues()[store.toLowerCase()]
}

/**
 * Resolve a list of store slugs to catalogues, silently dropping unknown ones.
 * Useful for "compare AH vs Jumbo vs Dirk" without crashing on a typo'd slug.
 */
export function getCataloguesFor(
  stores: ReadonlyArray<string>,
): Array<StoreCatalogue> {
  const all = getCatalogues()
  const out: Array<StoreCatalogue> = []
  for (const slug of stores) {
    const cat = all[slug.toLowerCase()]
    if (cat) out.push(cat)
  }
  return out
}

/** Every store slug present in the snapshot (including any with 0 products). */
export function storeSlugs(): Array<string> {
  return Object.keys(getCatalogues())
}

/** Store slugs that actually carry at least one priced product. */
export function coveredStoreSlugs(): Array<string> {
  return Object.values(getCatalogues())
    .filter((c) => c.products.length > 0)
    .map((c) => c.store)
}
