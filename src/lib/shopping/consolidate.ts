/**
 * The shopping-list engine.
 *
 * `consolidate(recipes, portions)` is the entry point. It:
 *   1. Resolves the household's target servings (children count as a fraction
 *      of an adult, see CHILD_PORTION_FACTOR).
 *   2. For each recipe, scales every ingredient quantity by
 *      targetServings / recipeServings.
 *   3. Merges the same ingredient across recipes into ONE line, summing
 *      quantities within each compatible unit-dimension and keeping
 *      incompatible-unit collisions as separate sub-amounts.
 *   4. Emits a deterministic, stably-ordered list.
 *
 * Pure: no DB, no I/O, no clock, no randomness. Same input => same output.
 */

import { parseQty } from './parse'
import type {
  HouseholdPortions,
  ShoppingLine,
  ShoppingList,
  ShoppingRecipe,
} from './types'
import {
  canonicalUnit,
  isQualitativeUnit,
  qualitativeLabel,
  renderFromBase,
  round,
} from './units'
import { dedupeKey, isNonGroceryWater } from './clean-list'

/**
 * How much of an adult portion one child eats. Exposed as a constant so the UI
 * and tests reference the same number rather than hard-coding 0.5.
 */
export const CHILD_PORTION_FACTOR = 0.5

/** Resolve adults + children into a target serving count (1 decimal). */
export function targetServings(portions: HouseholdPortions): number {
  const adults = Math.max(0, portions.adults)
  const children = Math.max(0, portions.children ?? 0)
  return round(adults + children * CHILD_PORTION_FACTOR)
}

/**
 * A scaled contribution from one recipe to one ingredient, already in base
 * units within its dimension. Internal to the merge.
 */
interface Contribution {
  dimension: string
  base: string
  baseValue: number
}

interface Accumulator {
  name: string
  /** Stable display name (first seen casing). */
  displayName: string
  meals: Set<string>
  /** Summed base value keyed by `${dimension}|${base}`. */
  buckets: Map<string, Contribution>
  unparsed: Array<string>
  /** First-seen order index, for deterministic output ordering. */
  order: number
}

/**
 * Lowercased, trimmed, spelling-normalised key so 'Onion' and 'onion ' merge,
 * AND so spelling variants collapse to one line ('chili flakes' == 'chilli
 * flakes'). Delegates to `dedupeKey` (#cart-clean) so the merge key and the
 * display-time de-dupe key stay identical.
 */
function nameKey(name: string): string {
  return dedupeKey(name)
}

/**
 * Consolidate a week of recipes into a single portion-scaled shopping list.
 */
export function consolidate(
  recipes: Array<ShoppingRecipe>,
  portions: HouseholdPortions,
): ShoppingList {
  const target = targetServings(portions)
  const acc = new Map<string, Accumulator>()
  let order = 0

  for (const recipe of recipes) {
    const recipeServings =
      recipe.servings && recipe.servings > 0 ? recipe.servings : null
    const factor = recipeServings ? target / recipeServings : 1

    for (const ing of recipe.ingredients) {
      // Cooking water "from the tap" is a recipe step, not a grocery; never let
      // it reach the cart (#cart-clean).
      if (isNonGroceryWater(ing.name)) continue
      const key = nameKey(ing.name)
      if (key === '') continue

      let entry = acc.get(key)
      if (!entry) {
        entry = {
          name: key,
          displayName: ing.name.trim(),
          meals: new Set(),
          buckets: new Map(),
          unparsed: [],
          order: order++,
        }
        acc.set(key, entry)
      }
      entry.meals.add(recipe.title)

      if (isQualitativeUnit(ing.unit)) {
        entry.unparsed.push(qualitativeLabel(ing.unit))
        continue
      }

      const parsed = parseQty(ing.qty)
      if (parsed.value === null) {
        if (parsed.unparsed) entry.unparsed.push(parsed.unparsed)
        continue
      }

      const cu = canonicalUnit(ing.unit)
      const scaledBase = parsed.value * cu.toBase * factor
      const bucketKey = `${cu.dimension}|${cu.base}`
      const existing = entry.buckets.get(bucketKey)
      if (existing) {
        existing.baseValue += scaledBase
      } else {
        entry.buckets.set(bucketKey, {
          dimension: cu.dimension,
          base: cu.base,
          baseValue: scaledBase,
        })
      }
    }
  }

  const lines = [...acc.values()]
    .sort((a, b) => a.name.localeCompare(b.name) || a.order - b.order)
    .map(toLine)

  return {
    lines,
    targetServings: target,
    estimatedItems: lines.length,
  }
}

/** Render one accumulator into a finished, display-ready shopping line. */
function toLine(entry: Accumulator): ShoppingLine {
  // Render each bucket to a display amount, sorted so the bucket with the
  // largest base value is primary (it gets totalQty/unit). Ties broken by base
  // label for determinism.
  const rendered = [...entry.buckets.values()]
    // A bucket that summed to zero ("0 tsp") is noise, not a buyable amount;
    // drop it so the line shows a clean name with no junk quantity (#cart-clean).
    .filter((b) => b.baseValue !== 0)
    .sort((a, b) => b.baseValue - a.baseValue || a.base.localeCompare(b.base))
    .map((b) => {
      const r = renderFromBase(b.dimension as never, b.baseValue, b.base)
      return {
        value: r.value,
        unit: r.unit,
        display: formatAmount(r.value, r.unit),
      }
    })

  const meals = [...entry.meals].sort((a, b) => a.localeCompare(b))
  const unparsed = [...entry.unparsed].sort((a, b) => a.localeCompare(b))

  const line: ShoppingLine = {
    name: entry.displayName,
    displayAmount: '',
    usedInMeals: meals,
  }

  const primary = rendered[0]
  if (primary) {
    line.totalQty = primary.value
    if (primary.unit) line.unit = primary.unit
    const extra = rendered.slice(1).map((r) => r.display)
    if (extra.length > 0) line.extraAmounts = extra
  }

  if (unparsed.length > 0) line.unparsed = unparsed

  line.displayAmount = buildDisplay(
    rendered.map((r) => r.display),
    unparsed,
  )
  return line
}

/** Format a value + unit into a single human chunk ('450 g', '3'). */
function formatAmount(value: number, unit: string): string {
  return unit ? `${value} ${unit}` : `${value}`
}

/**
 * Build the always-present `displayAmount`:
 *   - numeric buckets joined with ' + ' ('450 g + 2 cloves')
 *   - unparsed notes appended in parentheses
 *   - when there is nothing numeric, fall back to the unparsed notes, or a
 *     neutral '(unspecified amount)' so the line still reads.
 */
function buildDisplay(amounts: Array<string>, unparsed: Array<string>): string {
  const parts: Array<string> = []
  if (amounts.length > 0) parts.push(amounts.join(' + '))
  if (unparsed.length > 0) parts.push(`(${unparsed.join(', ')})`)
  if (parts.length === 0) return '(unspecified amount)'
  return parts.join(' ')
}

/**
 * Selector: ingredients used in more than one meal. The food-waste view (#80)
 * leans on this ('you buy onion once, used in 3 meals'). Preserves list order.
 */
export function sharedAcrossMeals(list: ShoppingList): Array<ShoppingLine> {
  return list.lines.filter((line) => line.usedInMeals.length > 1)
}

/** Convenience: distinct items to buy. Mirrors `list.estimatedItems`. */
export function estimatedItems(list: ShoppingList): number {
  return list.estimatedItems
}
