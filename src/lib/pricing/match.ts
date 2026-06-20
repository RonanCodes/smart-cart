/**
 * Name-based ingredient -> product matcher.
 *
 * The hard part of the whole layer (per the #45 research) is NOT the price
 * lookup, it is turning a free-text ingredient ("500g pasta", "kipfilet") into
 * the right store product when the only key we have is a noisy free-text product
 * name. So this matcher is conservative on purpose: it scores token overlap,
 * picks the cheapest plausible candidate, and attaches a CONFIDENCE flag so a
 * weak guess is never silently treated as an exact shelf price.
 *
 * Contract: `matchIngredient` NEVER invents a price. A no-match returns
 * `{ product: null, priceCents: null, confidence: 'none', estimated: true }`.
 * Low/medium confidence => `estimated: true` so the UI can mark the line.
 *
 * Pure: no I/O.
 */

import { normaliseName } from './normalise'
import type {
  IngredientMatch,
  MatchConfidence,
  StoreCatalogue,
  StoreProduct,
} from './types'

/**
 * Dutch + English stop words and pure-quantity tokens that should not drive a
 * match ("500g pasta" must match on "pasta", not on "500" or "g"). We strip
 * leading quantity/unit noise and these tokens before scoring.
 */
const STOP_TOKENS = new Set([
  'de',
  'het',
  'een',
  'en',
  'met',
  'van',
  'the',
  'a',
  'an',
  'of',
  'and',
  'with',
  'fresh',
  'verse',
  'vers',
  'bio',
  'organic',
])

/** Unit tokens that carry no matching signal on their own. */
const UNIT_TOKENS = new Set([
  'g',
  'gr',
  'gram',
  'kg',
  'mg',
  'ml',
  'cl',
  'dl',
  'l',
  'liter',
  'litre',
  'tsp',
  'tbsp',
  'el',
  'tl',
  'stuks',
  'stuk',
  'st',
  'clove',
  'cloves',
  'snufje',
  'pinch',
])

/** Break a name into meaningful, lower-cased content tokens. */
export function contentTokens(name: string): Array<string> {
  return normaliseName(name)
    .split(' ')
    .filter(
      (t) =>
        t.length > 1 &&
        !STOP_TOKENS.has(t) &&
        !UNIT_TOKENS.has(t) &&
        !/^\d+$/.test(t), // drop pure numbers (quantities)
    )
}

/**
 * Score how well a product matches the ingredient's content tokens, 0..1.
 *
 * Recall-weighted: the fraction of INGREDIENT tokens found in the product name
 * is what matters ("pasta" fully inside "AH Penne pasta 500 g" should score
 * high), with a mild penalty when the product name is much longer than the
 * ingredient (lots of unrelated brand/size noise lowers precision). An exact
 * normalised-name equality is a perfect 1.
 */
export function scoreMatch(
  ingredientTokens: Array<string>,
  product: StoreProduct,
): number {
  if (ingredientTokens.length === 0) return 0
  const productTokens = contentTokens(product.name)
  if (productTokens.length === 0) return 0

  const productSet = new Set(productTokens)
  let hits = 0
  for (const t of ingredientTokens) {
    if (productSet.has(t)) {
      hits += 1
    } else if (
      // soft substring hit: "tomaat" inside "tomaten", "kip" inside "kipfilet"
      productTokens.some((p) => p.includes(t) || t.includes(p))
    ) {
      hits += 0.6
    }
  }
  const recall = hits / ingredientTokens.length
  if (recall === 0) return 0

  // Precision-ish damping: penalise very long product names a little.
  const lengthPenalty = Math.min(
    1,
    (ingredientTokens.length + 2) / (productTokens.length + 2),
  )
  const score = recall * (0.7 + 0.3 * lengthPenalty)
  return Math.min(1, round3(score))
}

/** Map a numeric score to the public confidence band. */
export function confidenceFromScore(score: number): MatchConfidence {
  if (score >= 0.85) return 'high'
  if (score >= 0.55) return 'medium'
  if (score > 0) return 'low'
  return 'none'
}

const NO_MATCH = (store: string): IngredientMatch => ({
  store,
  product: null,
  priceCents: null,
  confidence: 'none',
  estimated: true,
  score: 0,
})

/**
 * Match one ingredient name against one store catalogue.
 *
 * Picks the highest-scoring product; on a score tie, the CHEAPEST product wins
 * (this is a price-comparison layer, so the cheapest plausible match is the
 * right default). Anything below a floor score is treated as no match rather
 * than a bad guess. Confidence high => exact-ish; medium/low => `estimated`.
 */
export function matchIngredient(
  name: string,
  store: StoreCatalogue,
): IngredientMatch {
  const tokens = contentTokens(name)
  if (tokens.length === 0 || store.products.length === 0) {
    return NO_MATCH(store.store)
  }

  let best: StoreProduct | null = null
  let bestScore = 0
  for (const product of store.products) {
    const score = scoreMatch(tokens, product)
    if (score <= 0) continue
    if (
      score > bestScore ||
      (score === bestScore &&
        best !== null &&
        product.priceCents < best.priceCents)
    ) {
      best = product
      bestScore = score
    }
  }

  // Floor: below this we do not trust the match at all.
  const FLOOR = 0.3
  if (best === null || bestScore < FLOOR) return NO_MATCH(store.store)

  const confidence = confidenceFromScore(bestScore)
  return {
    store: store.store,
    product: best,
    priceCents: best.priceCents,
    confidence,
    // Only a 'high' match is trusted as a real price; everything else is soft.
    estimated: confidence !== 'high',
    score: bestScore,
  }
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000
}
