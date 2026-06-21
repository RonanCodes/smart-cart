/**
 * Per-store BASKET builder: price + pack-size wastage for a whole shopping list.
 *
 * This is the pure core behind the shopping-tab price comparison (#293). Given
 * the required amount per ingredient (#292's exact grams) and a store's
 * catalogue, it matches each line to a product, works out how many PACKS the
 * shopper must buy (because a store stocks fixed pack sizes), and from that
 * derives the leftover the shopper is stuck with.
 *
 * Worked example. The list needs 300 g broccoli. AH stocks it as a 500 g pack.
 * You cannot buy 300 g, so you buy one 500 g pack and 200 g is leftover waste.
 * The line price is the pack price (one pack), and the waste is 200 g, costed at
 * the pack's per-gram rate (200/500 of the pack price).
 *
 * Honesty rules carried over from the matcher (match.ts):
 *  - We NEVER invent a price. No match => the ingredient is `unavailable`.
 *  - Pack size is free text and often missing or unparseable. When we cannot
 *    parse the pack OR the required amount in a comparable dimension, we charge
 *    ONE pack (the safe default: you still have to buy the product) and mark the
 *    waste `n/a` rather than guessing leftover. The UI shows price-only then.
 *  - Estimated (low/medium-confidence) matches stay flagged so the UI can mark
 *    a soft line; they still count toward the total because you would still buy
 *    them.
 *
 * Pure: no I/O, no clock, no randomness. Unit-tested in basket.test.ts.
 */

import { matchIngredient } from './match'
import type {
  IngredientMatch,
  ParsedSize,
  SizeDimension,
  StoreCatalogue,
} from './types'

/** The minimal shape this layer needs from a shopping line. */
export interface BasketRequest {
  /** The ingredient name as shown on the store-agnostic list. */
  name: string
  /**
   * The exact amount the recipes need, as the free-text display string from the
   * shopping engine ('300 g', '1.5 kg', '2 stuks', 'a pinch', or null). When
   * present and parseable, it drives the pack-rounding + waste maths.
   */
  amount?: string | null
}

/** One basket line: the matched product, packs to buy, line price, and waste. */
export interface BasketLineItem {
  /** The ingredient name from the request (not the product name). */
  ingredient: string
  /** The matched product name, for the expanded view. */
  productName: string
  /** Pack size as the store's free text ('500 g', 'ca. 700 g', ''). */
  packSize: string
  /** Price of ONE pack, in integer cents. */
  packPriceCents: number
  /** How many packs the shopper must buy to cover the required amount. */
  packs: number
  /** Total line price = packs * packPriceCents, in cents. */
  lineCents: number
  /** The product slug for a click-through, or null. */
  slug: string | null
  /** Match confidence band, surfaced so the UI can mark a soft line. */
  confidence: IngredientMatch['confidence']
  /** True when the price is a soft (low/medium-confidence) match. */
  estimated: boolean
  /**
   * Leftover after buying whole packs, in the pack's own base unit, or null
   * when we could not compare the required amount to the pack (waste is 'n/a').
   */
  waste: BasketWaste | null
}

/** Leftover for one line, in a single dimension, with an optional euro estimate. */
export interface BasketWaste {
  /** The dimension the leftover is measured in ('mass' | 'volume' | 'count'). */
  dimension: Exclude<SizeDimension, 'unknown'>
  /** Leftover quantity in the dimension's base unit (g, ml, or count). */
  baseQuantity: number
  /** A human display unit for the base ('g', 'ml', or '' for count). */
  unit: string
  /** Estimated euro value of the leftover, in cents (pack-price pro-rata). */
  cents: number
}

/** An ingredient with no plausible match at this store. */
export interface BasketUnavailable {
  ingredient: string
}

/** A whole store's priced + wasted basket. */
export interface StoreBasket {
  store: string
  displayName: string
  /** The priced lines, in request order. */
  lineItems: Array<BasketLineItem>
  /** Sum of every line price, in cents. */
  totalCents: number
  /**
   * Total wastage rolled up. `cents` always present (0 when nothing wasteful);
   * the per-dimension grams/ml/count buckets are summed separately because we
   * never convert across dimensions. `unknownLines` counts lines whose waste we
   * could not compute (shown as 'n/a' so the total stays honest).
   */
  totalWaste: BasketWasteSummary
  /** Ingredients with no match at this store. */
  unavailable: Array<BasketUnavailable>
  /** Count of matched lines whose price is soft (estimated). */
  estimatedCount: number
}

/** Rolled-up wastage across a store's basket. */
export interface BasketWasteSummary {
  /** Estimated euro value of all leftover, in cents. */
  cents: number
  /** Leftover grams summed across mass lines. */
  massGrams: number
  /** Leftover millilitres summed across volume lines. */
  volumeMl: number
  /** Leftover count units summed across count lines. */
  count: number
  /** Lines whose waste could not be computed (pack or amount unparseable). */
  unknownLines: number
  /** True when at least one line's waste is unknown ('n/a' shown). */
  hasUnknown: boolean
}

/** Cross-store comparison: a basket per store, cheapest first. */
export interface BasketComparison {
  baskets: Array<StoreBasket>
  /** The cheapest store by total, or null when nothing matched anywhere. */
  cheapest: StoreBasket | null
}

/* -------------------------------------------------------------------------- */
/* Required-amount parsing (reuses the shopping engine's qty + unit helpers)  */
/* -------------------------------------------------------------------------- */

/** A required amount reduced to a single dimension + base quantity. */
interface RequiredAmount {
  dimension: Exclude<SizeDimension, 'unknown'>
  baseQuantity: number
}

/**
 * Parse a shopping-list amount string ('300 g', '1.5 kg', '2 stuks') into a
 * comparable dimension + base quantity. Returns null when there is no numeric
 * head (e.g. 'a pinch') or the unit is the dimensionless count fallback but we
 * cannot align it with the pack (handled by the caller). Spoons collapse to
 * volume is NOT attempted; spoons return null (we never cost a teaspoon of
 * cumin as pack waste).
 */
function parseRequired(
  amount: string | null | undefined,
): RequiredAmount | null {
  const s = (amount ?? '').trim()
  if (!s) return null

  // Reuse the shopping engine so qty parsing stays identical to the list.
  // Lazy-free imports kept at module top would create a pricing->shopping dep;
  // these are pure functions so importing them is safe and synchronous.
  const head =
    /^(\d+(?:[.,]\d+)?(?:\s*(?:-|to|–|—)\s*\d+(?:[.,]\d+)?)?|\d+\s+\d+\s*\/\s*\d+|\d+\s*\/\s*\d+)\s*(.*)$/.exec(
      s,
    )
  if (!head) return null
  const value = numericValue(head[1]!)
  if (value === null || value <= 0) return null
  const unitToken = (head[2] ?? '').trim().toLowerCase().replace(/\.$/, '')

  const conv = toBaseDimension(value, unitToken)
  return conv
}

/** Numeric value of a qty head ('1/2' -> 0.5, '1-2' -> 2, '2,5' -> 2.5). */
function numericValue(raw: string): number | null {
  const s = raw.trim()
  const mixed = /^(\d+)\s+(\d+)\s*\/\s*(\d+)$/.exec(s)
  if (mixed) {
    const den = Number(mixed[3])
    return den ? Number(mixed[1]) + Number(mixed[2]) / den : null
  }
  const frac = /^(\d+)\s*\/\s*(\d+)$/.exec(s)
  if (frac) {
    const den = Number(frac[2])
    return den ? Number(frac[1]) / den : null
  }
  const range = /^(\d+(?:[.,]\d+)?)\s*(?:-|to|–|—)\s*(\d+(?:[.,]\d+)?)$/.exec(s)
  if (range) return Math.max(toNum(range[1]!), toNum(range[2]!))
  const plain = /^(\d+(?:[.,]\d+)?)$/.exec(s)
  if (plain) return toNum(plain[1]!)
  return null
}

function toNum(raw: string): number {
  return Number(raw.replace(',', '.'))
}

/* -------------------------------------------------------------------------- */
/* Dimension conversion: both required amount and pack size to a common base   */
/* -------------------------------------------------------------------------- */

/** Mass -> grams, volume -> ml, recognised count -> count. Else null. */
function toBaseDimension(value: number, unit: string): RequiredAmount | null {
  switch (unit) {
    case 'g':
    case 'gr':
    case 'gram':
    case 'grams':
      return { dimension: 'mass', baseQuantity: value }
    case 'kg':
    case 'kilo':
    case 'kilos':
    case 'kilogram':
    case 'kilograms':
      return { dimension: 'mass', baseQuantity: value * 1000 }
    case 'mg':
      return { dimension: 'mass', baseQuantity: value * 0.001 }
    case 'ml':
    case 'milliliter':
    case 'millilitre':
      return { dimension: 'volume', baseQuantity: value }
    case 'cl':
      return { dimension: 'volume', baseQuantity: value * 10 }
    case 'dl':
      return { dimension: 'volume', baseQuantity: value * 100 }
    case 'l':
    case 'liter':
    case 'litre':
    case 'liters':
    case 'litres':
      return { dimension: 'volume', baseQuantity: value * 1000 }
    case '':
    case 'stuks':
    case 'stuk':
    case 'st':
    case 'stk':
    case 'x':
    case 'piece':
    case 'pieces':
    case 'stk.':
      return { dimension: 'count', baseQuantity: value }
    default:
      // Unknown / cooking unit (cloves, tsp, can): not comparable to a pack.
      return null
  }
}

/** A parsed pack size reduced to the same base buckets, or null. */
function packToBase(size: ParsedSize): RequiredAmount | null {
  if (size.quantity === null || size.quantity <= 0) return null
  if (size.dimension === 'unknown') return null
  // size.unit is a verbatim token in the pack's dimension; convert via the same
  // table so 'kg', 'l', 'cl' packs reduce correctly.
  return toBaseDimension(size.quantity, (size.unit ?? '').toLowerCase())
}

/** A human display unit for a base quantity in a dimension. */
function baseUnit(dimension: RequiredAmount['dimension']): string {
  if (dimension === 'mass') return 'g'
  if (dimension === 'volume') return 'ml'
  return ''
}

/* -------------------------------------------------------------------------- */
/* The basket builder                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Whole packs needed for a required amount vs a product's pack size; 1 when n/a.
 *
 * A cooking measure we cannot compare to a pack (a teaspoon, a pinch, "to taste"
 * -> parseRequired null) buys exactly ONE pack. That already handles the
 * "1 tsp vanilla" case: it adds one bottle, never three. When the recipe gives a
 * real comparable mass/volume (e.g. 1200 g flour), normal pack rounding applies.
 */
export function packsForAmount(
  amount: string | null | undefined,
  product: { size: ParsedSize },
): number {
  const required = parseRequired(amount)
  const pack = packToBase(product.size)
  if (required && pack && required.dimension === pack.dimension) {
    return Math.max(1, Math.ceil(required.baseQuantity / pack.baseQuantity))
  }
  return 1
}

function accumulateMatchedLine(
  req: BasketRequest,
  match: IngredientMatch,
  lineItems: Array<BasketLineItem>,
  waste: BasketWasteSummary,
): { lineCents: number; estimated: boolean } | null {
  // A product with no slug can be PRICED but cannot be added to the store cart
  // (cart-build skips items with no SKU), so the displayed total would exceed the
  // real basket. Exclude it from pricing too, so the total only counts items that
  // can actually be added (#plan-cart-mismatch).
  if (
    match.product === null ||
    match.priceCents === null ||
    match.product.slug === null
  )
    return null

  const product = match.product
  const required = parseRequired(req.amount)
  const pack = packToBase(product.size)

  let packs = 1
  let lineWaste: BasketWaste | null = null

  if (required && pack && required.dimension === pack.dimension) {
    packs = Math.max(1, Math.ceil(required.baseQuantity / pack.baseQuantity))
    const bought = packs * pack.baseQuantity
    const leftover = round2(bought - required.baseQuantity)
    const perBaseCents = match.priceCents / pack.baseQuantity
    const wasteCents = Math.round(leftover * perBaseCents)
    lineWaste = {
      dimension: required.dimension,
      baseQuantity: leftover,
      unit: baseUnit(required.dimension),
      cents: wasteCents,
    }
  } else {
    waste.unknownLines += 1
    waste.hasUnknown = true
  }

  const lineCents = packs * match.priceCents

  if (lineWaste) {
    waste.cents += lineWaste.cents
    if (lineWaste.dimension === 'mass')
      waste.massGrams += lineWaste.baseQuantity
    else if (lineWaste.dimension === 'volume')
      waste.volumeMl += lineWaste.baseQuantity
    else waste.count += lineWaste.baseQuantity
  }

  lineItems.push({
    ingredient: req.name,
    productName: product.name,
    packSize: product.size.raw,
    packPriceCents: match.priceCents,
    packs,
    lineCents,
    slug: product.slug,
    confidence: match.confidence,
    estimated: match.estimated,
    waste: lineWaste,
  })

  return { lineCents, estimated: match.estimated }
}

/**
 * Price + waste ONE store's basket using PRE-RESOLVED matches (embedding tier).
 * Keeps pack-rounding identical to basketForStore so the cart total matches
 * what the UI shows when both paths share the same resolver.
 */
export function basketForStoreWithMatches(
  requests: ReadonlyArray<BasketRequest>,
  matches: ReadonlyArray<{ name: string; match: IngredientMatch }>,
  store: StoreCatalogue,
): StoreBasket {
  const matchByName = new Map(matches.map((m) => [m.name, m.match]))
  const lineItems: Array<BasketLineItem> = []
  const unavailable: Array<BasketUnavailable> = []
  let totalCents = 0
  let estimatedCount = 0
  const waste: BasketWasteSummary = {
    cents: 0,
    massGrams: 0,
    volumeMl: 0,
    count: 0,
    unknownLines: 0,
    hasUnknown: false,
  }

  for (const req of requests) {
    const match = matchByName.get(req.name) ?? {
      store: store.store,
      product: null,
      priceCents: null,
      confidence: 'none' as const,
      estimated: true,
      score: 0,
    }
    const priced = accumulateMatchedLine(req, match, lineItems, waste)
    if (!priced) {
      unavailable.push({ ingredient: req.name })
      continue
    }
    totalCents += priced.lineCents
    if (priced.estimated) estimatedCount += 1
  }

  waste.massGrams = round2(waste.massGrams)
  waste.volumeMl = round2(waste.volumeMl)
  waste.count = round2(waste.count)

  return {
    store: store.store,
    displayName: store.displayName,
    lineItems,
    totalCents,
    totalWaste: waste,
    unavailable,
    estimatedCount,
  }
}

/**
 * Price + waste ONE store's basket for a list of required amounts.
 *
 * Per line: match the ingredient, then decide how many whole packs cover the
 * required amount. When the required amount and the pack size are comparable
 * (same dimension, both parseable), packs = ceil(required / packBase) and
 * leftover = packs*packBase - required, costed pro-rata to the pack price.
 * When they are NOT comparable, we buy ONE pack and the waste is unknown ('n/a').
 *
 * Uses the legacy token matcher; the shopping-tab compare path uses the
 * embedding resolver via basketForStoreWithMatches instead (ADR-0004).
 */
export function basketForStore(
  requests: ReadonlyArray<BasketRequest>,
  store: StoreCatalogue,
): StoreBasket {
  const lineItems: Array<BasketLineItem> = []
  const unavailable: Array<BasketUnavailable> = []
  let totalCents = 0
  let estimatedCount = 0
  const waste: BasketWasteSummary = {
    cents: 0,
    massGrams: 0,
    volumeMl: 0,
    count: 0,
    unknownLines: 0,
    hasUnknown: false,
  }

  for (const req of requests) {
    const match = matchIngredient(req.name, store)
    const priced = accumulateMatchedLine(req, match, lineItems, waste)
    if (!priced) {
      unavailable.push({ ingredient: req.name })
      continue
    }
    totalCents += priced.lineCents
    if (priced.estimated) estimatedCount += 1
  }

  waste.massGrams = round2(waste.massGrams)
  waste.volumeMl = round2(waste.volumeMl)
  waste.count = round2(waste.count)

  return {
    store: store.store,
    displayName: store.displayName,
    lineItems,
    totalCents,
    totalWaste: waste,
    unavailable,
    estimatedCount,
  }
}

/**
 * Build a basket per store and pick the cheapest by total.
 *
 * Stores are priced in the order given; ties resolve to the earlier store.
 * Stores that matched NOTHING (empty lineItems) are skipped for `cheapest` so a
 * store with no coverage never wins on a €0 total, but they are still returned
 * in `baskets` so the UI can show "no matches at <store>".
 */
export function compareBaskets(
  requests: ReadonlyArray<BasketRequest>,
  stores: ReadonlyArray<StoreCatalogue>,
): BasketComparison {
  const baskets = stores.map((store) => basketForStore(requests, store))
  let cheapest: StoreBasket | null = null
  for (const b of baskets) {
    if (b.lineItems.length === 0) continue
    if (cheapest === null || b.totalCents < cheapest.totalCents) cheapest = b
  }
  return { baskets, cheapest }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
