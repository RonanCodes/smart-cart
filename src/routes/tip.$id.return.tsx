import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'
import { Heart } from 'lucide-react'
import { AppShell, ScreenHeader } from '#/components/ui/app-shell'
import { Button } from '#/components/ui/button'
import { buildCartLinks } from '#/lib/cart-links-server'
import type { CartLinkResult } from '#/lib/cart-links-server'
import { openStoreCart } from '#/lib/open-store-cart'
import { log } from '#/lib/log'

/**
 * Runtime guard for the rebuilt cart link. The server fn's static return type is
 * always a {@link CartLinkResult}, but a full-page redirect back from Mollie can
 * land us with a nullish / malformed value at runtime (the cause of the
 * tip.return_open_cart_failed 'undefined ... t.url' crash). This narrows to a
 * link we can safely hand to openStoreCart.
 */
function isOpenableLink(value: unknown): value is CartLinkResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    'urls' in value &&
    Array.isArray(value.urls) &&
    value.urls.length > 0
  )
}

/**
 * Landing page after the Mollie hosted-checkout redirect for a tip
 * (redirectUrl = /tip/{id}/return?store=ah). The paid/failed status is settled by
 * the Mollie webhook (re-fetched from the API), so this page never reads status,
 * it just thanks the user and opens their store cart. Pay-first flow: the cart
 * opens HERE, after payment, on a tap (a user gesture, so no popup block).
 */
export const Route = createFileRoute('/tip/$id/return')({
  validateSearch: (s: Record<string, unknown>): { store?: 'ah' | 'jumbo' } => ({
    store: s.store === 'ah' || s.store === 'jumbo' ? s.store : undefined,
  }),
  component: TipReturn,
})

function TipReturn() {
  const { store } = Route.useSearch()
  const [busy, setBusy] = useState(false)
  const label = store === 'jumbo' ? 'Jumbo' : 'Albert Heijn'

  async function openCart() {
    if (!store) return
    setBusy(true)
    try {
      // buildCartLinks goes down the DB-read fallback here (no live set on
      // return), which re-runs resolution and can come back empty or, after a
      // full-page redirect from Mollie, with an unexpected runtime shape. Its
      // STATIC type is always a BuiltCartLink, but the Sentry crash
      // ('undefined ... t.url' in tip.return_open_cart_failed) proves the value
      // can be nullish at runtime, so we widen to unknown and guard before
      // reading .urls. The cart was already opened on the tip-confirm click, so
      // an empty rebuild here is a harmless no-op, not a lost basket.
      const link = (await buildCartLinks({ data: { store } })) as unknown
      if (isOpenableLink(link)) openStoreCart(link)
    } catch (err) {
      log.error('tip.return_open_cart_failed', err, { store })
    } finally {
      setBusy(false)
    }
  }

  return (
    <AppShell>
      <ScreenHeader title="Thanks!" />
      <div className="flex flex-col items-center gap-4 px-5 pt-10 text-center">
        <div
          className="bg-secondary text-primary flex h-20 w-20 items-center justify-center rounded-full"
          aria-hidden
        >
          <Heart className="h-9 w-9" fill="currentColor" />
        </div>
        <p className="text-sm font-medium">Thanks for supporting Souso!</p>
        <p className="text-muted-foreground text-xs">
          {store
            ? `Tap to open your basket in ${label}.`
            : 'Your basket is ready in your store. Happy cooking.'}
        </p>
        {store && (
          <Button size="pill" disabled={busy} onClick={() => void openCart()}>
            {busy ? 'Opening…' : `Open my ${label} cart`}
          </Button>
        )}
        <Link to="/shopping">
          <Button variant="outline" size="pill">
            Back to shopping
          </Button>
        </Link>
      </div>
    </AppShell>
  )
}
