import { useState } from 'react'
import { Check, Loader2, ShoppingCart } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { buildCartLinks } from '#/lib/cart-links-server'
import type { CartLinkResult } from '#/lib/cart-links-server'
import type { CartExtra } from '#/lib/shopping/cart-set'
import { STORE_OPTIONS, storeLabel } from '#/lib/store-pref-server'
import type { StoreSlug } from '#/lib/store-pref-server'
import { TipSheet } from '#/components/shopping/TipSheet'
import { startTip } from '#/lib/tip-server'
import { log } from '#/lib/log'

/** Rough basket € total for the tip math: we don't price the list yet, so
 * estimate from the matched item count. The fee floor (€0.50) bounds the low end. */
const EUR_PER_ITEM = 2.5

/** The stores we can build a bulk-cart deep-link for today. Picnic is a
 * selectable preference (#294) but its cart isn't wired yet (#293), so it's not
 * offered as a cart target here. */
const CART_STORES = new Set<StoreSlug>(['ah', 'jumbo'])
const SELECTABLE_STORES = STORE_OPTIONS.filter((o) => CART_STORES.has(o.slug))

/**
 * The bottom "Send everything to a store" action for the Shopping tab (#238).
 *
 * One store SELECTOR (defaulting to the household's preferred store, #212) plus
 * ONE primary button. Picking a store and tapping the button resolves the WHOLE
 * list, the week's items AND the staples / extras, to that one store's public
 * bulk-cart deep-link and opens it in a new tab, so everything above the button
 * lands in the store's cart in a single tap. No store login, no credentials.
 *
 * Two #238 fixes are structural here:
 *  - Decoupled stores: the resolve + open only ever touch the SELECTED store, so
 *    sending to Jumbo can never also fetch or fire AH (the old two-button build
 *    resolved both at once).
 *  - Everything-included: the server fn folds the staples in, and the copy says
 *    so, so the extras are visibly part of the cart action.
 *
 * The link is resolved lazily on tap (one server call for the chosen store),
 * keeping the shopping-tab load cheap. Mobile-first (390px), iOS card styling.
 */
export function CartLinks({
  preferredStore,
  itemNames,
  extras,
}: {
  /** The household's preferred store (#212), pre-selected in the selector. */
  preferredStore: StoreSlug
  /**
   * The live UNCHECKED recipe + manual item names from the list above. Passed so
   * a tick the user just made is honoured immediately (#311): a ticked item is
   * "already have" and is not re-bought, with no DB round-trip lag. Undefined
   * keeps the legacy behaviour (the server reads the unchecked rows itself).
   */
  itemNames?: Array<string>
  /** The live UNCHECKED extras (staples), with their store + saved slug. */
  extras?: Array<CartExtra>
}) {
  const [store, setStore] = useState<StoreSlug>(preferredStore)
  const [link, setLink] = useState<CartLinkResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [tipOpen, setTipOpen] = useState(false)
  const [tipBusy, setTipBusy] = useState(false)
  // The friendly message from a failed Mollie payment (#307). Shown after the
  // cart opens, so the user knows the charge didn't go through (e.g. live
  // payments not enabled), never a silent no-op.
  const [tipError, setTipError] = useState<string | null>(null)

  // Switching store invalidates a previously-resolved link (it was for the old
  // store), so the next tap re-resolves for the now-selected store.
  function selectStore(next: StoreSlug) {
    if (next === store) return
    setStore(next)
    setLink(null)
    setError(false)
  }

  /** Step 1: tap "Send to <store>" -> resolve the selected store's link, then
   * open the tip sheet. We always prompt (the free tier is skipped for the demo,
   * #16). */
  async function requestSend() {
    setLoading(true)
    setError(false)
    try {
      // Hand the server the live unchecked set when the route lifted it up, so
      // ticks made since load are honoured with no DB lag (#311). When it is not
      // supplied, omit `live` and the server reads the unchecked rows itself.
      const live =
        itemNames !== undefined
          ? {
              itemNames,
              staples: (extras ?? []).map((e) => ({
                slug: e.slug,
                store: e.store,
              })),
            }
          : undefined
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

  /** Step 2: the user picked a tip percent. Record it (and charge via Mollie for
   * a positive tip), open the store cart, and for a real tip redirect this tab to
   * the hosted checkout. No-tip is a normal, unpunished outcome (#18). */
  async function confirmTip(percent: number) {
    setTipBusy(true)
    setTipError(null)
    const items = link?.matched ?? 0
    try {
      // No tip: nothing to pay, just open the cart.
      if (percent <= 0) {
        log.info('tip.confirmed', { percent, store, tipped: false })
        openCart()
        setTipOpen(false)
        return
      }
      // Tip: PAY FIRST. Redirect to Mollie's hosted checkout; the cart opens on
      // the /tip/:id/return page after payment (store passed through).
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
        // No checkout URL came back: don't strand the user, open the cart.
        openCart()
        setTipOpen(false)
      }
    } catch (err) {
      // Never block the cart on a tip failure (#18): open it anyway. But surface
      // the friendly message (#307) so the failure isn't silent. startTip
      // rethrows a user-safe message; fall back to a generic line.
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

  const label = `Send to ${storeLabel(store)}`
  const basketTotal = Math.max((link?.matched ?? 0) * EUR_PER_ITEM, 1)

  return (
    <section aria-labelledby="cart-links-heading" className="space-y-3">
      <div className="flex items-center gap-2">
        <ShoppingCart className="text-muted-foreground h-4 w-4" aria-hidden />
        <h2
          id="cart-links-heading"
          className="text-sm font-semibold tracking-tight"
        >
          Send everything to a store
        </h2>
      </div>

      <p className="text-muted-foreground/80 text-xs">
        Your whole list above, the week's items and the extras, lands in the
        store's cart in one tap. No login needed.
      </p>

      {/* Store selector: brand-chip segmented control, preferred store
          pre-selected. Tapping a chip only changes the selection; nothing
          fires until the button below. */}
      <div
        role="radiogroup"
        aria-label="Choose a store"
        className="grid grid-cols-2 gap-2"
      >
        {SELECTABLE_STORES.map((option) => {
          const selected = option.slug === store
          return (
            <button
              key={option.slug}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => selectStore(option.slug)}
              className={`flex items-center justify-center gap-2 rounded-[var(--radius-ios)] border px-3 py-3 transition-colors ${
                selected
                  ? 'border-primary bg-primary/5 ring-primary/40 ring-1'
                  : 'border-border bg-card'
              }`}
            >
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${option.chipClassName}`}
                aria-hidden
              >
                {option.initials}
              </span>
              <span className="text-sm font-medium">{option.name}</span>
              {selected && (
                <Check className="text-primary h-4 w-4" aria-hidden />
              )}
            </button>
          )
        })}
      </div>

      {/* The single primary action, at the very bottom of the page. */}
      <Button
        size="pill"
        className="w-full"
        disabled={loading}
        aria-label={label}
        onClick={() => void requestSend()}
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <ShoppingCart className="h-4 w-4" aria-hidden />
        )}
        <span>{label}</span>
      </Button>

      {link?.url && link.matched < link.total && (
        <p className="text-muted-foreground/80 text-center text-xs">
          {link.matched} of {link.total} items matched a {storeLabel(store)}{' '}
          product.
        </p>
      )}

      {error && (
        <p className="text-destructive text-xs" role="alert">
          {link && !link.url
            ? `None of your items matched a ${storeLabel(store)} product yet.`
            : 'Could not build the cart link. Try again.'}
        </p>
      )}

      {tipError && (
        <p className="text-destructive text-xs" role="alert">
          {tipError}
        </p>
      )}

      <TipSheet
        open={tipOpen}
        onOpenChange={setTipOpen}
        basketTotal={basketTotal}
        busy={tipBusy}
        onConfirm={(percent) => void confirmTip(percent)}
      />
    </section>
  )
}
