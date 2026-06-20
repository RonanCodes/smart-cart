/**
 * Public surface of the cross-store price-data layer.
 *
 * Pure, data-only. Turns the consolidated shopping list (#78 `ShoppingLine`)
 * into per-store basket totals from the vendored checkjebon snapshot, with a
 * confidence flag on every match so estimated lines never silently inflate the
 * "save money" claim. The price-compare UI slice (#92) builds on this; this
 * layer never touches routes, components, or the network.
 *
 * Data provenance + licence/ToS caveat: `./data/NOTICE.md`.
 */

export type {
  RawStore,
  RawProduct,
  SizeDimension,
  ParsedSize,
  StoreProduct,
  StoreCatalogue,
  StoreCatalogues,
  MatchConfidence,
  IngredientMatch,
  PricedLine,
  StorePriceList,
  CrossStorePrice,
} from './types'

export {
  parseSize,
  normaliseName,
  eurosToCents,
  buildCatalogues,
} from './normalise'

export {
  contentTokens,
  scoreMatch,
  confidenceFromScore,
  matchIngredient,
} from './match'

export type { PriceableLine } from './price-list'
export {
  priceListForStore,
  priceListAcrossStores,
  formatCents,
} from './price-list'

export {
  getCatalogues,
  getCatalogue,
  getCataloguesFor,
  storeSlugs,
  coveredStoreSlugs,
} from './catalogue'
