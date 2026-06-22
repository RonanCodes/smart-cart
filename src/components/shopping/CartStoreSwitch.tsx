import { Loader2, Sparkles } from 'lucide-react'
import { formatCents } from '#/lib/pricing'
import type { BasketComparison } from '#/lib/pricing'
import { STORE_OPTIONS } from '#/lib/store-pref-server'
import type { StoreSlug } from '#/lib/store-pref-server'
import { track, FUNNEL_EVENTS } from '#/lib/analytics'
import { cn } from '#/lib/utils'

/**
 * The 3-way store switch at the top of the Cart screen (#cart-align).
 *
 * The design prototype faked this with hardcoded per-store prices. Here the
 * prices are REAL: each store's total comes from the shared price comparison
 * (usePriceComparison, fanning out one comparePriceForStore call per store so the
 * totals fill in progressively, the vendored catalogue priced server-side, #439).
 * Picking a store drives the per-item prices in the list, the
 * floating total, and the order button all at once, so the whole screen reprices
 * in a tap.
 *
 * Albert Heijn + Picnic are selectable; Jumbo is parked as a disabled
 * "Coming soon" option until its pricing + cart are tested (it stays visible so
 * we can re-enable it later). Picnic shows its price but its cart isn't wired
 * yet (#293), which the floating order bar communicates.
 */
export function CartStoreSwitch({
  data,
  loading,
  selected,
  onSelect,
}: {
  data: BasketComparison | null
  loading: boolean
  selected: StoreSlug
  onSelect: (store: StoreSlug) => void
}) {
  const cheapest = data?.cheapest?.store ?? null

  return (
    <div
      role="radiogroup"
      aria-label="Compare stores"
      className="border-border bg-card grid grid-cols-3 gap-1 rounded-2xl border p-1 shadow-sm"
    >
      {STORE_OPTIONS.map((option) => {
        const comingSoon = option.comingSoon === true
        const on = option.slug === selected && !comingSoon
        const basket = data?.baskets.find((b) => b.store === option.slug)
        const total =
          basket && basket.lineItems.length > 0 ? basket.totalCents : null
        // #439: prices fill in PER STORE as each fan-out call lands. A store that
        // hasn't reported yet (no basket in the comparison) still shows a spinner
        // while any fetch is in flight, so an already-arrived store shows its real
        // total immediately instead of every cell spinning until the slowest one.
        const pending = loading && basket === undefined
        const isCheapest = cheapest === option.slug
        return (
          <button
            key={option.slug}
            type="button"
            role="radio"
            aria-checked={on}
            aria-disabled={comingSoon}
            disabled={comingSoon}
            onClick={() => {
              if (comingSoon) return
              onSelect(option.slug)
              // Which store the user repriced the cart against. Source separates
              // this in-cart switch from the onboarding store step.
              track(FUNNEL_EVENTS.storeSelected, {
                store: option.slug,
                source: 'cart',
              })
            }}
            className={cn(
              'flex flex-col items-center rounded-xl px-2 py-2 transition active:scale-95',
              on ? 'bg-primary text-primary-foreground' : 'text-foreground',
              comingSoon && 'cursor-not-allowed opacity-50 active:scale-100',
            )}
          >
            <span className="flex items-center gap-1 text-[0.78rem] font-bold">
              {option.name}
              {isCheapest && !on && !comingSoon && (
                <Sparkles
                  className="text-primary h-2.5 w-2.5"
                  aria-label="Cheapest"
                />
              )}
            </span>
            <span
              className={cn(
                'mt-0.5 text-[0.72rem] font-semibold tabular-nums',
                on ? 'text-primary-foreground/85' : 'text-muted-foreground',
              )}
            >
              {comingSoon ? (
                'Coming soon'
              ) : pending ? (
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
              ) : total !== null ? (
                formatCents(total)
              ) : (
                'no match'
              )}
            </span>
          </button>
        )
      })}
    </div>
  )
}
