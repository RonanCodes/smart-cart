/**
 * The food-waste reduction calc (slice #80).
 *
 * Souso's pitch has three legs: save money, save time, reduce food waste. This
 * module makes the THIRD leg explicit and honest. It does not invent grams of
 * waste from thin air. It counts two concrete, defensible signals that already
 * exist in the consolidated list and frames them as "waste avoided":
 *
 *   1. Shared ingredients. When one ingredient is used across several meals, the
 *      week buys it ONCE at the combined amount instead of once per recipe. That
 *      is the classic "half a bunch of coriander goes mouldy in the drawer"
 *      problem, removed. We count those lines and the extra meals they cover.
 *   2. Exact amounts. The engine sums the recipes' real quantities rather than
 *      rounding up to a typical supermarket pack. We count the lines that carry
 *      a concrete number (so the claim is "we buy what the recipes use") and
 *      keep it as a soft, labelled estimate.
 *
 * Everything here is an ESTIMATE and is labelled as such in the UI. We never
 * claim a precise weight of food saved, because we do not have pack sizes or
 * real consumption data. The honest version is "N ingredients reused across
 * your meals, nothing left over" plus a coarse 0-100 score the UI can render as
 * "low / good / great", not a fake gram count.
 *
 * Pure: no DB, no I/O, no clock, no randomness. Same list => same summary.
 */

import type { ShoppingLine, ShoppingList } from './types'

/**
 * The food-waste summary derived from a consolidated list. Deliberately small
 * and honest: counts plus a coarse estimate, never a fabricated weight.
 */
export interface WasteSummary {
  /** Distinct ingredients used in more than one meal (bought once, no leftovers). */
  sharedIngredientCount: number
  /**
   * Extra meals covered by reuse: for each shared ingredient, the meals beyond
   * the first. The "you would otherwise have bought this N more times" number.
   */
  reusedMealCoverage: number
  /** Lines that carry a concrete summed amount (exact-amount, not rounded packs). */
  exactAmountCount: number
  /** Total distinct items on the list, for ratio framing. */
  totalItems: number
  /**
   * A coarse 0-100 reduction estimate. NOT a percentage of food by weight; it
   * is a blended signal of how much of the list benefits from sharing and exact
   * amounts. Labelled an estimate in the UI; see `wasteLevel` for the bucket.
   */
  estimatePct: number
  /** Whether there is anything worth surfacing at all. */
  hasSavings: boolean
}

/** Coarse buckets for the estimate, so the UI never implies false precision. */
export type WasteLevel = 'none' | 'some' | 'good' | 'great'

/**
 * Derive the food-waste summary from a consolidated shopping list.
 *
 * The estimate blends two ratios over the list:
 *   - shareRatio: shared lines / total lines (reuse removes leftovers)
 *   - exactRatio: lines with an exact amount / total lines (no pack rounding)
 * weighted 60/40 toward sharing, which is the stronger, more visible signal.
 * Rounded to a whole number and clamped to 0-100.
 */
export function summariseWaste(list: ShoppingList): WasteSummary {
  const totalItems = list.lines.length

  const sharedLines = list.lines.filter((l) => l.usedInMeals.length > 1)
  const sharedIngredientCount = sharedLines.length
  const reusedMealCoverage = sharedLines.reduce(
    (sum, l) => sum + (l.usedInMeals.length - 1),
    0,
  )
  const exactAmountCount = list.lines.filter(hasExactAmount).length

  let estimatePct = 0
  if (totalItems > 0) {
    const shareRatio = sharedIngredientCount / totalItems
    const exactRatio = exactAmountCount / totalItems
    estimatePct = Math.round((shareRatio * 0.6 + exactRatio * 0.4) * 100)
  }
  estimatePct = Math.min(100, Math.max(0, estimatePct))

  return {
    sharedIngredientCount,
    reusedMealCoverage,
    exactAmountCount,
    totalItems,
    estimatePct,
    hasSavings: sharedIngredientCount > 0 || exactAmountCount > 0,
  }
}

/**
 * A line counts as "exact amount" when the engine produced a concrete summed
 * quantity (a number), i.e. we are buying what the recipes use rather than a
 * vague or pack-rounded guess. Lines that are only an unparsed note ('a pinch')
 * do not count.
 */
export function hasExactAmount(line: ShoppingLine): boolean {
  return typeof line.totalQty === 'number'
}

/** Map the coarse estimate to a labelled bucket the UI renders as a word. */
export function wasteLevel(summary: WasteSummary): WasteLevel {
  if (!summary.hasSavings || summary.estimatePct <= 0) return 'none'
  if (summary.estimatePct < 25) return 'some'
  if (summary.estimatePct < 50) return 'good'
  return 'great'
}

/**
 * The per-ingredient reuse line for a shared ingredient, e.g.
 * '1 bunch coriander, used in 3 meals, nothing left over'. Returns null for a
 * single-meal line so callers can skip it. The amount is the engine's
 * always-present `displayAmount`.
 */
export function reuseLabel(line: ShoppingLine): string | null {
  const meals = line.usedInMeals.length
  if (meals <= 1) return null
  return `Used in ${meals} meals, nothing left over`
}
