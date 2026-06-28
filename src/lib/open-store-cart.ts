/**
 * Client-only helper for opening a resolved store cart link (#293).
 *
 * Large AH / Jumbo bulk-add requests are chunked (~25 SKUs). We reserve ONE tab
 * on the user's click (popup-safe), then chain each chunk GET in that same tab
 * with a short gap so AH's basketItemsAdd mutations don't race. Multi-tab opens
 * triggered Chrome's popup blocker on big weeks.
 */

import type { BuiltCartLink } from './cart-build'

const TAB_OPTS = 'noopener,noreferrer'

/** Gap between chunk navigations — tuned from AH cart race observations. */
export const CART_CHUNK_OPEN_MS = 1500

/** Buffer after the last chunk navigate before a full-page redirect (Mollie). */
export const CART_CHUNK_OPEN_BUFFER_MS = 250

/**
 * How long to wait after {@link openStoreCart} before navigating away (e.g. to
 * Mollie). Multi-chunk carts stagger chunks 2..N at {@link CART_CHUNK_OPEN_MS}
 * apart; redirecting sooner would cancel pending tab navigations.
 */
export function cartChunkOpenDelayMs(chunkCount: number): number {
  if (chunkCount <= 1) return 0
  return (chunkCount - 1) * CART_CHUNK_OPEN_MS + CART_CHUNK_OPEN_BUFFER_MS
}

function navigateTab(tab: Window | null, url: string): void {
  if (!tab || tab.closed) return
  ;(tab.location as { href: string }).href = url
}

/**
 * Open every chunk URL automatically. Single-chunk carts open one tab; multi-chunk
 * carts reserve one tab on the click gesture, then load each add-multiple URL in
 * that tab in sequence {@link CART_CHUNK_OPEN_MS} apart.
 */
export function openStoreCart(link: BuiltCartLink): void {
  const { urls } = link
  if (urls.length === 0) return

  if (urls.length === 1) {
    window.open(urls[0], '_blank', TAB_OPTS)
    return
  }

  // One tab only. Do NOT pass 'noopener' here: with noopener window.open returns
  // null, so the reserved about:blank tab would have no handle to navigate
  // (#cart-blank).
  const tab = window.open('about:blank', '_blank')

  urls.forEach((url, index) => {
    const run = () => navigateTab(tab, url)
    if (index === 0) run()
    else window.setTimeout(run, index * CART_CHUNK_OPEN_MS)
  })
}
