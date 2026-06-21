/**
 * Client-only helper for opening a resolved store cart link (#293).
 *
 * Large AH / Jumbo bulk-add requests silently truncate, so the server may return
 * several chunk URLs. Earlier chunks open in the background; the last chunk opens
 * in the focused tab (AH add-multiple → mijnlijst, Jumbo mandje).
 */

import type { BuiltCartLink } from './cart-build'

const TAB_OPTS = 'noopener,noreferrer'

/** Open every chunk URL; only the last tab stays in focus for the shopper. */
export function openStoreCart(link: BuiltCartLink): void {
  if (link.urls.length === 0) return
  for (let i = 0; i < link.urls.length - 1; i++) {
    window.open(link.urls[i], '_blank', TAB_OPTS)
  }
  window.open(link.urls[link.urls.length - 1], '_blank', TAB_OPTS)
}
