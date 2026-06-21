/**
 * Pure helpers for the LIVE shopping set the Shopping tab feeds into the price
 * comparison and the single "Send to <store>" cart action (#311).
 *
 * The shopping-tab model is INCLUSION (matches the design prototype): a CHECKED
 * item means "IN my order", so the order / compare set is the CHECKED items, and
 * unticking a row drops it from every store's basket (price + waste) AND out of
 * the cart the single bottom button sends. This applies to BOTH the recipe /
 * manual items (the editable list) and the "also on my list" extras (the
 * staples). The route owns the items, the staples, and their selected state,
 * then derives the live SELECTED set here and hands it to PriceComparison +
 * CartLinks, so ticking a box recomputes the comparison and grows the cart with
 * no page reload.
 *
 * Everything here is PURE: no DB, no I/O, no React. Unit-tested in
 * cart-set.test.ts.
 */

import type { ShoppingItem } from './persist'

/** One line for the price comparison: ingredient name + optional amount. */
export interface CompareLine {
  name: string
  amount?: string | null
}

/**
 * One extra / staple on the list, with the store its saved slug belongs to. The
 * route lifts the staples up so selecting one adds the extra to the basket and
 * the cart, exactly like a checked recipe line.
 */
export interface CartExtra {
  /** Stable id (the staple row id), used as the selected-state key. */
  id: string
  /** The product name, priced by the comparison matcher. */
  name: string
  /** The store the saved slug is for ('ah' | 'jumbo'). */
  store: string
  /** The store-specific product slug, or null when none was saved. */
  slug: string | null
}

/** The live, SELECTED (in-order) set the comparison + cart consume. */
export interface LiveCartSet {
  /** Selected recipe + manual + extra lines, for the price comparison. */
  compareLines: Array<CompareLine>
  /** Selected recipe + manual item names, for cart name-resolution. */
  itemNames: Array<string>
  /** Selected extras, carrying their store + slug for direct cart resolution. */
  staples: Array<{ slug: string | null; store: string }>
}

/**
 * Derive the live SELECTED (in-order) set from the list items, the extras, and
 * the set of extra ids the user has selected (ticked) into the order.
 *
 * - Recipe / manual items carry their own `checked` flag (from the DB), where
 *   `checked: true` means "in the order", so only checked rows are included.
 * - Extras have no persisted checked column; the route tracks the SELECTED extra
 *   ids client-side and passes them in, so only a selected extra is included.
 *
 * The comparison lines are recipe lines (with amounts, so pack-rounding + waste
 * work) PLUS the extras (no amount, priced as one pack each). The cart split
 * keeps item names separate from extras because the server resolves names via
 * the matcher and extras via their saved slug.
 */
export function deriveLiveCartSet(
  items: ReadonlyArray<ShoppingItem>,
  extras: ReadonlyArray<CartExtra>,
  selectedExtraIds: ReadonlySet<string>,
): LiveCartSet {
  const selectedItems = items.filter((i) => i.checked)
  const selectedExtras = extras.filter((e) => selectedExtraIds.has(e.id))

  const itemNames = selectedItems.map((i) => i.name)

  const compareLines: Array<CompareLine> = [
    ...selectedItems.map((i) => ({ name: i.name, amount: i.amount })),
    ...selectedExtras.map((e) => ({ name: e.name, amount: null })),
  ]

  const staples = selectedExtras.map((e) => ({ slug: e.slug, store: e.store }))

  return { compareLines, itemNames, staples }
}
