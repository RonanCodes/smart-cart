import { useRef, useState } from 'react'
import { ShoppingCart } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { formatCents } from '#/lib/pricing'
import type { BasketComparison } from '#/lib/pricing'
import { buildCartLinks } from '#/lib/cart-links-server'
import type { CartLinkResult } from '#/lib/cart-links-server'
import type { CartExtra, CompareLine } from '#/lib/shopping/cart-set'
import { storeLabel } from '#/lib/store-pref-server'
import type { StoreSlug } from '#/lib/store-pref-server'
import { TipSheet } from '#/components/shopping/TipSheet'
import { startTip } from '#/lib/tip-server'
import { openStoreCart } from '#/lib/open-store-cart'
import { stashPendingCart } from '#/lib/pending-cart'
import { log } from '#/lib/log'
import { track, FUNNEL_EVENTS } from '#/lib/analytics'

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
 * the live SELECTED (in-order) set and opens it after the tip prompt, exactly as
 * the old CartLinks did, so the order flow (incl. the tip) is unchanged.
 *
 * Picnic is priced in the switch but can't receive a cart yet, so when it's the
 * selected store the button is disabled with an honest note.
 */
export function FloatingOrderBar({
  store,
  data,
  compareLines,
  extras,
}: {
  /** The store the top switch currently has selected. */
  store: StoreSlug
  /** The shared price comparison, for the selected store's total. */
  data: BasketComparison | null
  /** Live SELECTED (in-order) recipe + manual lines with amounts (#311). */
  compareLines: Array<CompareLine>
  /** Live SELECTED (in-order) extras (staples) with their store + saved slug. */
  extras: Array<CartExtra>
}) {
  const [link, setLink] = useState<CartLinkResult | null>(null)
  const [error, setError] = useState(false)
  const [tipOpen, setTipOpen] = useState(false)
  const [tipBusy, setTipBusy] = useState(false)
  const [tipError, setTipError] = useState<string | null>(null)

  // The in-flight cart-link build (#440). Tapping "Order" opens the tip sheet
  // INSTANTLY and kicks this off in the background; confirmTip awaits it so the
  // user never stares at a spinner waiting for the (slow, accurate-tier) match.
  const linkPromiseRef = useRef<Promise<CartLinkResult> | null>(null)

  const basket = data?.baskets.find((b) => b.store === store)
  const total = basket && basket.lineItems.length > 0 ? basket.totalCents : null
  const productCount = basket?.lineItems.length ?? compareLines.length
  const canOrder = CART_STORES.has(store)

  /**
   * Open the tip sheet INSTANTLY and start building the selected store's cart
   * link in the BACKGROUND (#440). The build (accurate-tier matching) is slow,
   * so we never block showing the tip screen on it: the promise is stashed and
   * awaited at confirm time. The link state still populates for the "(N of M
   * matched)" note when the build resolves.
   */
  function requestSend() {
    if (!canOrder) return
    setError(false)
    setTipError(null)
    setLink(null)
    // Cart opened: the user tapped "Order at <store>" to build the basket link.
    track(FUNNEL_EVENTS.cartOpened, { store, productCount })
    // Show the tip sheet first, on this gesture, so it appears with no wait.
    setTipOpen(true)
    const live = {
      items: compareLines.map((l) => ({ name: l.name, amount: l.amount })),
      staples: extras.map((e) => ({ slug: e.slug, store: e.store })),
    }
    const promise = buildCartLinks({ data: { store, live } })
    linkPromiseRef.current = promise
    promise
      .then((res) => {
        // Only adopt this result if it's still the latest build (the user could
        // have closed + reopened with a different selection).
        if (linkPromiseRef.current === promise) setLink(res)
      })
      .catch(() => {
        // Swallow here; confirmTip awaits the same promise and surfaces the
        // error to the user when they actually try to open the cart.
      })
  }

  /**
   * The current build's resolved link, awaited (#440). If the background build
   * is still running we wait on it here; if it already resolved we reuse it.
   * Throws on a build failure so confirmTip can show the error.
   */
  async function resolveLink(): Promise<CartLinkResult> {
    const inFlight = linkPromiseRef.current
    if (!inFlight) throw new Error('No cart build in progress')
    return inFlight
  }

  function openCart(resolved: CartLinkResult) {
    openStoreCart(resolved)
    // Order placed (Souso's no-auto-buy model): the store's ready-to-order
    // basket opened. The user checks out themselves — this is the conversion.
    track(FUNNEL_EVENTS.orderPlaced, {
      store,
      matched: resolved.matched,
      total: resolved.total,
    })
  }

  async function confirmTip(percent: number) {
    setTipBusy(true)
    setTipError(null)
    try {
      // The background build (#440) is usually done by the time the user picks a
      // tip. If it already resolved, open synchronously inside this click so the
      // popup stays gesture-trusted; otherwise await it (rare slow case, the tip
      // return route re-opens the cart as a belt-and-braces fallback either way).
      const resolved = link ?? (await resolveLink())
      if (!resolved.urls.length) {
        setError(true)
        setTipOpen(false)
        return
      }
      const items = resolved.matched
      if (percent <= 0) {
        log.info('tip.confirmed', { percent, store, tipped: false })
        openCart(resolved)
        setTipOpen(false)
        return
      }
      // Pay-first tip path: stash the resolved link, redirect to Mollie, then
      // open the store cart on /tip/{id}/return after payment (popup-safe there).
      const res = await startTip({
        data: {
          percent,
          basketTotal: Math.max(items * EUR_PER_ITEM, 1),
          store,
        },
      })
      log.info('tip.confirmed', { percent, store, tipped: !!res.checkoutUrl })
      if (res.checkoutUrl) {
        track(FUNNEL_EVENTS.checkoutStarted, { store, percent })
        stashPendingCart(res.tipPaymentId, resolved)
        window.location.href = res.checkoutUrl
      } else {
        setTipOpen(false)
      }
    } catch (err) {
      log.error('tip.start_failed', err, { percent, store })
      // Pay-first: no cart opened yet; build failure means nothing to recover.
      setTipOpen(false)
      setTipError(
        err instanceof Error && err.message
          ? err.message
          : "We couldn't start that payment. No charge was made.",
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
            disabled={!canOrder}
            aria-label={`Order at ${storeLabel(store)}`}
            onClick={requestSend}
          >
            <ShoppingCart className="h-5 w-5" aria-hidden />
            <span>Order at {storeLabel(store)}</span>
          </Button>

          {/* Honest pricing note: the comparison is our best match against the
              store's catalogue, but the real total is whatever the store charges
              at checkout (sizes, offers, substitutions can differ). */}
          <p className="text-muted-foreground/80 mt-1.5 text-center text-[11px]">
            Prices are approximate and may differ at checkout.
          </p>

          {!canOrder && (
            <div className="mt-2 flex flex-col items-center gap-1 text-center">
              <img
                src="/stickers/person-ok.png"
                alt=""
                aria-hidden
                className="souso-sticker h-20 w-auto object-contain"
                style={{ transform: 'rotate(-3deg)' }}
              />
              <p className="text-muted-foreground text-[11px] font-medium">
                Picnic goes live the second they say yes. This guy&rsquo;s ready
                when they are. Pick Albert Heijn to send your cart now.
              </p>
            </div>
          )}

          {canOrder &&
            link &&
            link.urls.length > 0 &&
            link.matched < link.total && (
              <p className="text-muted-foreground/80 mt-1.5 text-center text-[11px]">
                {link.matched} of {link.total} items matched a{' '}
                {storeLabel(store)} product.
              </p>
            )}

          {error && (
            <p
              className="text-destructive mt-1.5 text-center text-[11px]"
              role="alert"
            >
              {link && !link.urls.length
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
