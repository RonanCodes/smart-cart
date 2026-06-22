/**
 * Stash the resolved bulk-cart link across the Mollie redirect (tip > 0).
 *
 * Pay-first flow: tip confirm → Mollie → return route opens the cart from this
 * stash. No store credentials; the link is the same public deep-link built on the
 * shopping screen before redirect.
 */

import type { BuiltCartLink } from './cart-build'

const storageKey = (tipPaymentId: string) =>
  `souso.pending-cart.${tipPaymentId}`

/** Runtime guard before handing a value to {@link openStoreCart}. */
export function isOpenableCartLink(value: unknown): value is BuiltCartLink {
  return (
    typeof value === 'object' &&
    value !== null &&
    'urls' in value &&
    Array.isArray(value.urls) &&
    value.urls.length > 0
  )
}

/** Persist the cart link until the tip return route consumes it. */
export function stashPendingCart(
  tipPaymentId: string,
  link: BuiltCartLink,
): void {
  if (!tipPaymentId) return
  try {
    window.sessionStorage.setItem(
      storageKey(tipPaymentId),
      JSON.stringify(link),
    )
  } catch {
    // sessionStorage blocked (private mode): return route falls back to rebuild.
  }
}

/**
 * Read and remove the stashed cart link for this tip payment.
 * Returns null when missing, corrupt, or empty.
 */
export function takePendingCart(tipPaymentId: string): BuiltCartLink | null {
  if (!tipPaymentId) return null
  try {
    const raw = window.sessionStorage.getItem(storageKey(tipPaymentId))
    if (!raw) return null
    window.sessionStorage.removeItem(storageKey(tipPaymentId))
    const parsed: unknown = JSON.parse(raw)
    return isOpenableCartLink(parsed) ? parsed : null
  } catch {
    return null
  }
}
