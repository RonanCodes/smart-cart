/**
 * Cross-store price-data layer types.
 *
 * This layer is PURE and data-only: it normalises the vendored checkjebon
 * price snapshot, matches a shopping-list ingredient to the cheapest plausible
 * store product, and totals a basket per store. No routes, no UI, no DB, no
 * network on the request path (the snapshot is vendored / synced offline).
 *
 * Data provenance + licence/ToS caveat: see `./data/NOTICE.md`. The prices are
 * a scraped, MIT-licensed snapshot; some upstream prices are silently averaged
 * estimates and the file does NOT flag which. We therefore never treat a name
 * match as an exact, real shelf price without a confidence flag.
 */

/**
 * The raw, terse shape exactly as checkjebon ships it.
 *
 * Store object: `n` store slug, `d` products, plus `u` (product URL base),
 * `c` (display name), `i` (logo URL).
 * Product object: `n` name, `l` link/slug, `p` price in euros, `s` pack size
 * as free text with a comma decimal (e.g. "0,75 l", "ca. 700 g", "6 x 0,3 l").
 */
export interface RawStore {
  /** Store slug. Typed optional because the vendored JSON is untrusted input. */
  n?: string
  d?: Array<RawProduct>
  u?: string
  c?: string
  i?: string
}

export interface RawProduct {
  /** Product name. Optional for the same untrusted-input reason as RawStore.n. */
  n?: string
  l?: string
  p?: number
  s?: string
}

/** The dimension a parsed pack size falls into. Mirrors the shopping engine. */
export type SizeDimension = 'mass' | 'volume' | 'count' | 'unknown'

/**
 * A pack size parsed out of the free-text `s` field.
 * `quantity` is the total in the size's own unit (a "6 x 0,3 l" pack resolves
 * to quantity 1.8, unit 'l'). `approx` is true when the source said "ca." (circa).
 * `unit` is the verbatim unit token ('l', 'g', 'kg', 'ml', 'stuks', ...).
 * When the field is empty or unparseable, dimension is 'unknown' and quantity null.
 */
export interface ParsedSize {
  raw: string
  quantity: number | null
  unit: string | null
  dimension: SizeDimension
  approx: boolean
}

/** A normalised store product: terse keys expanded, size parsed, price in cents. */
export interface StoreProduct {
  /** Store slug this product belongs to ('ah', 'jumbo', ...). */
  store: string
  name: string
  /** Lower-cased, accent/punctuation-stripped name used for matching. */
  normalisedName: string
  /** Price in integer cents. Money is never a float in this layer. */
  priceCents: number
  slug: string | null
  size: ParsedSize
}

/** One store's normalised catalogue. */
export interface StoreCatalogue {
  /** Store slug ('ah'). */
  store: string
  /** Human display name ('Albert Heijn' / checkjebon's `c`, falls back to slug). */
  displayName: string
  /** checkjebon product URL base, if present. */
  urlBase: string | null
  products: Array<StoreProduct>
}

/** The whole normalised dataset, keyed by store slug. */
export type StoreCatalogues = Record<string, StoreCatalogue>

/** How much to trust a name match. Never let low/none inflate a savings claim. */
export type MatchConfidence = 'high' | 'medium' | 'low' | 'none'

/** The result of matching one ingredient against one store. */
export interface IngredientMatch {
  store: string
  /** The matched product, or null when nothing plausible was found. */
  product: StoreProduct | null
  /** Price in cents of the matched product, or null when no match. */
  priceCents: number | null
  confidence: MatchConfidence
  /**
   * True when this price should be treated as soft: a low-confidence match, or
   * no match at all. The UI must visibly mark estimated lines and must NOT fold
   * them into a hard "you save X" number.
   */
  estimated: boolean
  /** The matcher's 0..1 score, surfaced for debugging / tie inspection. */
  score: number
}

/** A priced shopping line: the ingredient plus its per-store match. */
export interface PricedLine {
  /** The ingredient name from the shopping list. */
  name: string
  match: IngredientMatch
}

/** Per-store total across a whole shopping list. */
export interface StorePriceList {
  store: string
  displayName: string
  /** Sum of matched line prices, in cents. Estimated lines ARE included here. */
  totalCents: number
  /** The priced lines, in input order. */
  lines: Array<PricedLine>
  /** Count of lines that matched at all (confidence !== 'none'). */
  matchedCount: number
  /** Count of lines whose price is soft (estimated true). */
  estimatedCount: number
  /** Count of lines with no match in this store. */
  missingCount: number
  /**
   * True when the total leans on estimated or missing lines and so must not be
   * presented as an exact basket price. Set when any line is estimated/missing.
   */
  hasSoftTotal: boolean
}

/** Comparison across stores: per-store lists plus the cheapest fully-confident one. */
export interface CrossStorePrice {
  perStore: Array<StorePriceList>
  /**
   * The cheapest store whose total has NO soft lines, or null when every store
   * has at least one estimated/missing line. The UI uses this for a hard claim;
   * when null it must fall back to a hedged "estimated" presentation.
   */
  cheapestConfident: StorePriceList | null
  /** The cheapest store overall by total, soft or not (always present if any). */
  cheapestOverall: StorePriceList | null
}
