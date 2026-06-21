import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Loader2, Sparkles } from 'lucide-react'
import { formatCents } from '#/lib/pricing'
import type { BasketComparison, StoreBasket } from '#/lib/pricing'
import { comparePrices } from '#/lib/price-compare-server'
import type { PriceCompareLine } from '#/lib/price-compare-server'
import { StoreBadge } from '#/components/shopping/StoreBadge'
import { log } from '#/lib/log'

/**
 * Per-store price + wastage comparison, BELOW the store-agnostic list (#293).
 *
 * The list above stays store-agnostic (exact grams, #292). This block answers
 * "where is this basket cheapest, and how much do I waste buying it there?" with
 * one card per store. Each card shows the total basket price and the leftover
 * (because stores stock different PACK SIZES, needing 300 g of a 500 g pack
 * leaves 200 g over). Tap a card to expand the chosen products; an
 * "unavailable" footer lists ingredients with no match at that store.
 *
 * The actual store icon (real favicon) comes from StoreBadge. The data comes
 * from the server fn comparePrices (the 4 MB catalogue never reaches the
 * client); we pass the loaded list lines in and render the small result.
 *
 * Mobile-first (390px). The comparison HELPS pick a store; the single
 * "Send to <store>" action (CartLinks, #243) stays the one cart action.
 */
export function PriceComparison({ lines }: { lines: Array<PriceCompareLine> }) {
  const [data, setData] = useState<BasketComparison | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  // Serialise the lines so the effect re-runs only when the list really changes.
  // `lines` is a fresh array each render, so we depend on the serialised key and
  // read the latest lines through a ref (no stale closure, no re-fetch churn).
  const key = lines.map((l) => `${l.name}|${l.amount ?? ''}`).join('\n')
  const linesRef = useRef(lines)
  linesRef.current = lines

  useEffect(() => {
    let live = true
    setLoading(true)
    setFailed(false)
    comparePrices({ data: { lines: linesRef.current } })
      .then((res) => {
        if (live) setData(res)
      })
      .catch((err: unknown) => {
        log.warn('price-compare failed', { err: String(err) })
        if (live) setFailed(true)
      })
      .finally(() => {
        if (live) setLoading(false)
      })
    return () => {
      live = false
    }
  }, [key])

  if (lines.length === 0) return null

  if (loading) {
    return (
      <section aria-label="Price comparison" className="space-y-3">
        <Heading />
        <p className="text-muted-foreground flex items-center gap-2 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Comparing stores...
        </p>
      </section>
    )
  }

  if (failed || data === null) return null

  const baskets = data.baskets.filter((b) => b.lineItems.length > 0)
  if (baskets.length === 0) {
    return (
      <section aria-label="Price comparison" className="space-y-2">
        <Heading />
        <p className="text-muted-foreground text-sm">
          No price matches for this list yet.
        </p>
      </section>
    )
  }

  const cheapestStore = data.cheapest?.store ?? null

  return (
    <section aria-label="Price comparison" className="space-y-3">
      <Heading />
      <ul className="space-y-2">
        {baskets.map((basket) => (
          <li key={basket.store}>
            <StoreCard
              basket={basket}
              isCheapest={basket.store === cheapestStore}
            />
          </li>
        ))}
      </ul>
      <p className="text-muted-foreground text-[11px] leading-snug">
        Prices are an estimate from a public price snapshot, not a live shelf
        price. Waste assumes you buy whole packs.
      </p>
    </section>
  )
}

function Heading() {
  return (
    <div>
      <h2 className="text-foreground text-sm font-semibold">Compare stores</h2>
      <p className="text-muted-foreground text-xs">
        Same basket, priced per store, with the leftover each pack size forces.
      </p>
    </div>
  )
}

/** One expandable store card: header (total + waste) + expandable basket. */
function StoreCard({
  basket,
  isCheapest,
}: {
  basket: StoreBasket
  isCheapest: boolean
}) {
  const [open, setOpen] = useState(false)
  const panelId = `store-basket-${basket.store}`

  return (
    <div
      className={`border-border/60 bg-card overflow-hidden rounded-2xl border ${
        isCheapest ? 'ring-primary/40 ring-2' : ''
      }`}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <StoreBadge store={basket.store} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="text-foreground truncate text-sm font-medium">
              {basket.displayName}
            </span>
            {isCheapest && (
              <span className="bg-primary/10 text-primary inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold">
                <Sparkles className="h-2.5 w-2.5" aria-hidden />
                Cheapest
              </span>
            )}
          </span>
          <WasteSummaryLine basket={basket} />
        </span>
        <span className="text-foreground text-base font-semibold tabular-nums">
          {formatCents(basket.totalCents)}
        </span>
        <ChevronDown
          aria-hidden
          className={`text-muted-foreground h-4 w-4 shrink-0 transition-transform ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>

      {open && (
        <div id={panelId} className="border-border/60 border-t px-4 py-3">
          <BasketLines basket={basket} />
          {basket.unavailable.length > 0 && (
            <div className="border-border/40 mt-3 border-t pt-3">
              <p className="text-muted-foreground mb-1 text-xs font-medium">
                Not available here ({basket.unavailable.length})
              </p>
              <ul className="text-muted-foreground space-y-0.5 text-xs">
                {basket.unavailable.map((u) => (
                  <li key={u.ingredient} className="truncate">
                    {u.ingredient}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** The one-line waste readout under the store name in the card header. */
function WasteSummaryLine({ basket }: { basket: StoreBasket }) {
  const w = basket.totalWaste
  const parts: Array<string> = []
  if (w.massGrams > 0) parts.push(formatGrams(w.massGrams))
  if (w.volumeMl > 0) parts.push(formatMl(w.volumeMl))
  if (w.count > 0) parts.push(`${trimNum(w.count)} extra`)

  if (parts.length === 0) {
    // Either no waste, or every comparable line was exact, but some lines may be
    // n/a. Keep the message honest.
    return (
      <span className="text-muted-foreground block text-xs">
        {w.hasUnknown ? 'Waste n/a for some items' : 'No leftover'}
      </span>
    )
  }

  return (
    <span className="text-muted-foreground block text-xs">
      {parts.join(' + ')} leftover
      {w.cents > 0 ? ` (~${formatCents(w.cents)})` : ''}
      {w.hasUnknown ? ', some n/a' : ''}
    </span>
  )
}

/** The expanded list of chosen products: name, pack size, qty, line price. */
function BasketLines({ basket }: { basket: StoreBasket }) {
  return (
    <ul className="space-y-2">
      {basket.lineItems.map((item) => (
        <li
          key={`${item.ingredient}-${item.productName}`}
          className="flex items-start justify-between gap-3"
        >
          <span className="min-w-0">
            <StoreBadge
              store={basket.store}
              slug={item.slug}
              productName={item.productName}
              className="float-left mr-1.5"
            />
            <span className="text-foreground block text-sm leading-tight">
              {item.productName}
              {item.estimated && (
                <span className="text-muted-foreground ml-1 text-[10px]">
                  (est.)
                </span>
              )}
            </span>
            <span className="text-muted-foreground block text-xs">
              {item.packSize.trim() ? item.packSize.trim() : 'pack size n/a'}
              {item.packs > 1 ? ` x ${item.packs}` : ''}
              {item.waste && item.waste.baseQuantity > 0
                ? ` , ${wasteText(item.waste)} leftover`
                : item.waste === null
                  ? ' , waste n/a'
                  : ''}
            </span>
          </span>
          <span className="text-foreground shrink-0 text-sm font-medium tabular-nums">
            {formatCents(item.lineCents)}
          </span>
        </li>
      ))}
    </ul>
  )
}

function wasteText(w: { baseQuantity: number; unit: string }): string {
  if (w.unit === 'g') return formatGrams(w.baseQuantity)
  if (w.unit === 'ml') return formatMl(w.baseQuantity)
  return `${trimNum(w.baseQuantity)}`
}

function formatGrams(g: number): string {
  if (g >= 1000) return `${trimNum(g / 1000)} kg`
  return `${trimNum(g)} g`
}

function formatMl(ml: number): string {
  if (ml >= 1000) return `${trimNum(ml / 1000)} l`
  return `${trimNum(ml)} ml`
}

function trimNum(n: number): string {
  return String(Math.round(n * 100) / 100)
}
