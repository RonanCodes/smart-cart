import { useState } from 'react'
import { Loader2, ShoppingCart } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { formatCents } from '#/lib/pricing'
import type { BasketComparison } from '#/lib/pricing'
import { buildCartLinks } from '#/lib/cart-links-server'
import type { CartLinkResult } from '#/lib/cart-links-server'
import type { CartExtra } from '#/lib/shopping/cart-set'
import { storeLabel } from '#/lib/store-pref-server'
import type { StoreSlug } from '#/lib/store-pref-server'
import { TipSheet } from '#/components/shopping/TipSheet'
import { startTip } from '#/lib/tip-server'
import { log } from '#/lib/log'

/** Rough basket € total for the tip math fallback when we have no priced basket. */
const EUR_PER_ITEM = 2.5

/** The stores whose bulk-cart deep-link is wired today (#293). Picnic is
 *  selectable + priced, but its cart isn't built yet. */
const CART_STORES = new Set<StoreSlug>(['ah', 'jumbo'])

/**
 * The floating total + "Order at <store>" action pinned above the tab bar
 * (#cart-align), replacing the old in-flow PriceComparison + CartLinks stack.
 *
 * It reads the SELECTED store (owned by the route, same selection the top switch
 * sets) and shows that store's REAL basket total from the shared price
 * comparison. Tapping resolves the chosen store's public bulk-cart deep-link for
 * the live UNCHECKED set and opens it after the tip prompt, exactly as the old
 * CartLinks did, so the order flow (incl. the tip) is unchanged.
 *
 * Picnic is priced in the switch but can't receive a cart yet, so when it's the
 * selected store the button is disabled with an honest note.
 */
export function FloatingOrderBar({
  store,
  data,
  itemNames,
  extras,
}: {
  /** The store the top switch currently has selected. */
  store: StoreSlug
  /** The shared price comparison, for the selected store's total. */
  data: BasketComparison | null
  /** Live UNCHECKED recipe + manual item names (#311). */
  itemNames: Array<string>
  /** Live UNCHECKED extras (staples) with their store + saved slug. */
  extras: Array<CartExtra>
}) {
  const [link, setLink] = useState<CartLinkResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [tipOpen, setTipOpen] = useState(false)
  const [tipBusy, setTipBusy] = useState(false)
  const [tipError, setTipError] = useState<string | null>(null)

  const basket = data?.baskets.find((b) => b.store === store)
  const total = basket && basket.lineItems.length > 0 ? basket.totalCents : null
  const productCount = basket?.lineItems.length ?? itemNames.length
  const canOrder = CART_STORES.has(store)

  /** Resolve the selected store's link, then open the tip sheet. */
  async function requestSend() {
    if (!canOrder) return
    setLoading(true)
    setError(false)
    try {
      const live = {
        itemNames,
        staples: extras.map((e) => ({ slug: e.slug, store: e.store })),
      }
      const res = await buildCartLinks({ data: { store, live } })
      setLink(res)
      if (!res.url) {
        setError(true)
        return
      }
      setTipOpen(true)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }

  function openCart() {
    if (link?.url) window.open(link.url, '_blank', 'noopener,noreferrer')
  }

  async function confirmTip(percent: number) {
    setTipBusy(true)
    setTipError(null)
    const items = link?.matched ?? 0
    try {
      if (percent <= 0) {
        log.info('tip.confirmed', { percent, store, tipped: false })
        openCart()
        setTipOpen(false)
        return
      }
      const res = await startTip({
        data: {
          percent,
          basketTotal: Math.max(items * EUR_PER_ITEM, 1),
          store,
        },
      })
      log.info('tip.confirmed', { percent, store, tipped: !!res.checkoutUrl })
      if (res.checkoutUrl) {
        window.location.href = res.checkoutUrl
      } else {
        openCart()
        setTipOpen(false)
      }
    } catch (err) {
      log.error('tip.start_failed', err, { percent, store })
      openCart()
      setTipOpen(false)
      setTipError(
        err instanceof Error && err.message
          ? err.message
          : "We couldn't start that payment. Your cart still opened, no charge was made.",
      )
    } finally {
      setTipBusy(false)
    }
  }

  const basketTotal = Math.max((link?.matched ?? 0) * EUR_PER_ITEM, 1)

  return (
    <>
      <div className="fixed bottom-[calc(var(--tab-bar-space)+0.75rem)] left-1/2 z-40 w-[calc(100%-2.5rem)] max-w-md -translate-x-1/2">
        <div className="bg-card/95 border-border rounded-2xl border p-3 shadow-lg backdrop-blur">
          <div className="mb-2 flex items-baseline justify-between px-1">
            <span className="text-muted-foreground text-xs font-semibold">
              {productCount} {productCount === 1 ? 'product' : 'products'} at{' '}
              {storeLabel(store)}
            </span>
            <span className="text-lg font-extrabold tabular-nums">
              {total !== null ? formatCents(total) : '--'}
            </span>
          </div>

          <Button
            size="pill"
            className="w-full shadow-md"
            disabled={loading || !canOrder}
            aria-label={`Order at ${storeLabel(store)}`}
            onClick={() => void requestSend()}
          >
            {loading ? (
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
            ) : (
              <ShoppingCart className="h-5 w-5" aria-hidden />
            )}
            <span>Order at {storeLabel(store)}</span>
          </Button>

          {!canOrder && (
            <p className="text-muted-foreground mt-1.5 text-center text-[11px]">
              {storeLabel(store)} ordering isn&rsquo;t available yet. Pick
              Albert Heijn or Jumbo to send your cart.
            </p>
          )}

          {canOrder && link?.url && link.matched < link.total && (
            <p className="text-muted-foreground/80 mt-1.5 text-center text-[11px]">
              {link.matched} of {link.total} items matched a {storeLabel(store)}{' '}
              product.
            </p>
          )}

          {error && (
            <p
              className="text-destructive mt-1.5 text-center text-[11px]"
              role="alert"
            >
              {link && !link.url
                ? `None of your items matched a ${storeLabel(store)} product yet.`
                : 'Could not build the cart link. Try again.'}
            </p>
          )}

          {tipError && (
            <p
              className="text-destructive mt-1.5 text-center text-[11px]"
              role="alert"
            >
              {tipError}
            </p>
          )}
        </div>
      </div>

      <TipSheet
        open={tipOpen}
        onOpenChange={setTipOpen}
        basketTotal={basketTotal}
        busy={tipBusy}
        onConfirm={(percent) => void confirmTip(percent)}
      />
    </>
  )
}
