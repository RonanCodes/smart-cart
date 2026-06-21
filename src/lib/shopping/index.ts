/**
 * Public surface of the shopping-list engine.
 *
 * Pure functions the UI (#79) and the food-waste view (#80) build on top of.
 * Nothing here touches the DB or the network.
 */

export type {
  RecipeIngredient,
  ShoppingRecipe,
  HouseholdPortions,
  ShoppingLine,
  ShoppingList,
} from './types'

export {
  consolidate,
  sharedAcrossMeals,
  estimatedItems,
  targetServings,
  CHILD_PORTION_FACTOR,
} from './consolidate'

export { parseQty } from './parse'
export type { ParsedQty } from './parse'

export { canonicalUnit, normaliseUnitToken, renderFromBase } from './units'
export type { CanonicalUnit } from './units'

export { summariseWaste, hasExactAmount, wasteLevel, reuseLabel } from './waste'
export type { WasteSummary, WasteLevel } from './waste'

export {
  normaliseItemName,
  lineToNewItem,
  sumAmounts,
  concatAmounts,
  mergeAmount,
  planMerge,
  countMissing,
  backfillAmounts,
  addToListCta,
} from './persist'
export type {
  ShoppingItem,
  ShoppingItemSource,
  NewShoppingItem,
  MergePlan,
} from './persist'

export {
  cleanRows,
  dedupeKey,
  isNonGroceryWater,
  isZeroAmount,
} from './clean-list'
export type { CleanableRow } from './clean-list'

export { isPantryStaple } from './pantry-staples'
