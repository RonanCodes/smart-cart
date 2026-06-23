import { Sparkles } from 'lucide-react'
import { CartPriceSlot } from '#/components/shopping/CartPriceSlot'
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
 * While a store is still pricing, its cell shows a live `priced/total` count so
 * the matcher never looks stuck (#cart-incremental-price).
 *
 * Albert Heijn + Picnic are selectable; Jumbo is parked as a disabled
 * "Coming soon" option until its pricing + cart are tested (it stays visible so
 * we can re-enable it later). Picnic shows its price but its cart isn't wired
 * yet (#293), which the floating order bar communicates.
 */
export function CartStoreSwitch({
  data,
  loading,
  lineTotal = 0,
  storePendingLineKeys,
  selected,
  onSelect,
}: {
  data: BasketComparison | null
  loading: boolean
  /** Selected (in-order) lines being priced — same total for every store. */
  lineTotal?: number
  /** Per-store line keys still being priced (#cart-incremental-price). */
  storePendingLineKeys?: Record<string, ReadonlySet<string>>
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
        const pendingCount = storePendingLineKeys?.[option.slug]?.size ?? 0
        const pricedCount =
          lineTotal > 0 ? Math.max(0, lineTotal - pendingCount) : 0
        const stillPricing =
          pendingCount > 0 || (loading && total === null && lineTotal > 0)
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
              track(FUNNEL_EVENTS.storeSelected, {
                store: option.slug,
                source: 'cart',
              })
            }}
            className={cn(
              'flex min-h-[3.5rem] flex-col items-center justify-center rounded-xl px-2 py-2 transition active:scale-95',
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
            <StoreSubtitle
              comingSoon={comingSoon}
              lineTotal={lineTotal}
              pricedCount={pricedCount}
              selected={on}
              stillPricing={stillPricing}
              total={total}
            />
          </button>
        )
      })}
    </div>
  )
}

/** Fixed-height subtitle row: price and/or progress on one line, no height jump. */
function StoreSubtitle({
  comingSoon,
  lineTotal,
  pricedCount,
  selected,
  stillPricing,
  total,
}: {
  comingSoon: boolean
  lineTotal: number
  pricedCount: number
  selected: boolean
  stillPricing: boolean
  total: number | null
}) {
  const tone = selected ? 'text-primary-foreground/85' : 'text-muted-foreground'

  if (comingSoon) {
    return (
      <span
        className={cn(
          'mt-0.5 flex h-[1.125rem] items-center justify-center text-[0.72rem] font-semibold',
          tone,
        )}
      >
        Coming soon
      </span>
    )
  }

  const showProgress = stillPricing && lineTotal > 0
  const showPrice = total !== null

  if (!showProgress && !showPrice) {
    return (
      <span
        className={cn(
          'mt-0.5 flex h-[1.125rem] items-center justify-center text-[0.72rem] font-semibold',
          tone,
        )}
      >
        no match
      </span>
    )
  }

  return (
    <span
      className={cn(
        'mt-0.5 flex h-[1.125rem] items-center justify-center gap-1',
        tone,
      )}
    >
      {showPrice ? (
        <CartPriceSlot
          priceCents={total}
          size="total"
          inheritColor
          reserve
          emphasize
        />
      ) : null}
      {showProgress ? (
        <StorePricingProgress
          priced={pricedCount}
          total={lineTotal}
          selected={selected}
          besidePrice={showPrice}
        />
      ) : null}
    </span>
  )
}

function StorePricingProgress({
  priced,
  total,
  selected,
  besidePrice = false,
}: {
  priced: number
  total: number
  selected: boolean
  /** True when a settled total is already shown — keep this quiet. */
  besidePrice?: boolean
}) {
  return (
    <span
      className={cn(
        'tabular-nums',
        besidePrice
          ? 'text-[0.62rem] font-medium'
          : 'text-[0.68rem] font-medium',
        selected
          ? besidePrice
            ? 'text-primary-foreground/55'
            : 'text-primary-foreground/75'
          : besidePrice
            ? 'text-muted-foreground/65'
            : 'text-muted-foreground',
      )}
      aria-label={`Pricing ${priced} of ${total} items`}
    >
      {priced}/{total}
    </span>
  )
}
