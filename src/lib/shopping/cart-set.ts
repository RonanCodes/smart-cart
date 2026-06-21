/**
 * Pure helpers for the LIVE shopping set the Shopping tab feeds into the price
 * comparison and the single "Send to <store>" cart action (#311).
 *
 * Ronan's shopping-tab model: a CHECKED item means "I already have this", so it
 * must drop out of every store's basket (price + waste) AND out of the cart the
 * single bottom button sends. This applies to BOTH the recipe / manual items
 * (the editable list) and the "also on my list" extras (the staples). The route
 * owns the items, the staples, and their checked state, then derives the live
 * UNCHECKED set here and hands it to PriceComparison + CartLinks, so ticking a
 * box recomputes the comparison and shrinks the cart with no page reload.
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
 * route lifts the staples up so a tick here drops the extra from the basket and
 * the cart, exactly like a recipe line.
 */
export interface CartExtra {
  /** Stable id (the staple row id), used as the checked-state key. */
  id: string
  /** The product name, priced by the comparison matcher. */
  name: string
  /** The store the saved slug is for ('ah' | 'jumbo'). */
  store: string
  /** The store-specific product slug, or null when none was saved. */
  slug: string | null
}

/** The live, unchecked set the comparison + cart consume. */
export interface LiveCartSet {
  /** Unchecked recipe + manual + extra lines, for the price comparison. */
  compareLines: Array<CompareLine>
  /** Unchecked recipe + manual item names, for cart name-resolution. */
  itemNames: Array<string>
  /** Unchecked extras, carrying their store + slug for direct cart resolution. */
  staples: Array<{ slug: string | null; store: string }>
}

/**
 * Derive the live unchecked set from the list items, the extras, and the set of
 * extra ids the user has ticked off as "already have".
 *
 * - Recipe / manual items carry their own `checked` flag (from the DB), so a
 *   ticked row is excluded.
 * - Extras have no persisted checked column; the route tracks ticked extra ids
 *   client-side and passes them in, so a ticked extra is excluded the same way.
 *
 * The comparison lines are recipe lines (with amounts, so pack-rounding + waste
 * work) PLUS the extras (no amount, priced as one pack each). The cart split
 * keeps item names separate from extras because the server resolves names via
 * the matcher and extras via their saved slug.
 */
export function deriveLiveCartSet(
  items: ReadonlyArray<ShoppingItem>,
  extras: ReadonlyArray<CartExtra>,
  checkedExtraIds: ReadonlySet<string>,
): LiveCartSet {
  const uncheckedItems = items.filter((i) => !i.checked)
  const uncheckedExtras = extras.filter((e) => !checkedExtraIds.has(e.id))

  const itemNames = uncheckedItems.map((i) => i.name)

  const compareLines: Array<CompareLine> = [
    ...uncheckedItems.map((i) => ({ name: i.name, amount: i.amount })),
    ...uncheckedExtras.map((e) => ({ name: e.name, amount: null })),
  ]

  const staples = uncheckedExtras.map((e) => ({ slug: e.slug, store: e.store }))

  return { compareLines, itemNames, staples }
}
