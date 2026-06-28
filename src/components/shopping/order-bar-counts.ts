import type { BuiltCartLink } from '#/lib/cart-build'
import type { StoreBasket } from '#/lib/pricing'

export interface OrderBarCounts {
  total: number
  matched: number | null
}

/**
 * Selected-line total plus how many resolved at the chosen store. Prefers the
 * cart-link build when present (post-order), otherwise the live price basket.
 */
export function orderBarCounts(
  selectedLineCount: number,
  basket: StoreBasket | null | undefined,
  link: BuiltCartLink | null | undefined,
): OrderBarCounts {
  if (link && link.total > 0) {
    return { total: link.total, matched: link.matched }
  }
  if (basket) {
    const matched = basket.lineItems.length
    const total = matched + basket.unavailable.length
    return { total, matched }
  }
  return { total: selectedLineCount, matched: null }
}

/** Headline above the order button — one source of truth for item/match counts. */
export function orderBarHeadline(
  counts: OrderBarCounts,
  storeName: string,
): string {
  const { total, matched } = counts
  const itemWord = total === 1 ? 'item' : 'items'
  if (matched !== null && matched < total) {
    return `${matched} of ${total} ${itemWord} matched at ${storeName}`
  }
  return `${total} ${itemWord} at ${storeName}`
}

/** "an Albert Heijn" / "a Jumbo" for readable match footnotes and errors. */
export function storeWithArticle(storeName: string): string {
  const trimmed = storeName.trim()
  return /^[aeiou]/i.test(trimmed) ? `an ${trimmed}` : `a ${trimmed}`
}
