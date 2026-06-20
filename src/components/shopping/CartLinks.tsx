import { useState } from 'react'
import { Check, Loader2, ShoppingCart } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { buildCartLinks } from '#/lib/cart-links-server'
import type { CartLinkResult } from '#/lib/cart-links-server'
import { STORE_OPTIONS, storeLabel } from '#/lib/store-pref-server'
import type { StoreSlug } from '#/lib/store-pref-server'
import { TipSheet } from '#/components/shopping/TipSheet'
import { startTip } from '#/lib/tip-server'

/** Rough basket € total for the tip math: we don't price the list yet, so
 * estimate from the matched item count. The fee floor (€0.50) bounds the low end. */
const EUR_PER_ITEM = 2.5

/** The two stores we actually fulfil a basket against (Picnic is the joke). */
const SELECTABLE_STORES = STORE_OPTIONS.filter(
  (o): o is typeof o & { slug: StoreSlug } => o.slug !== null,
)

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
}: {
  /** The household's preferred store (#212), pre-selected in the selector. */
  preferredStore: StoreSlug
}) {
  const [store, setStore] = useState<StoreSlug>(preferredStore)
  const [link, setLink] = useState<CartLinkResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [tipOpen, setTipOpen] = useState(false)
  const [tipBusy, setTipBusy] = useState(false)

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
      const res = await buildCartLinks({ data: { store } })
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
    const items = link?.matched ?? 0
    try {
      const res = await startTip({
        data: { percent, basketTotal: Math.max(items * EUR_PER_ITEM, 1) },
      })
      openCart() // cart lands in a new tab
      setTipOpen(false)
      if (res.checkoutUrl) window.location.href = res.checkoutUrl // tip in this tab
    } catch {
      // Never block the cart on a tip failure (#18): just open it.
      openCart()
      setTipOpen(false)
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
