import { useEffect, useRef, useState } from 'react'
import { comparePrices } from '#/lib/price-compare-server'
import type { PriceCompareLine } from '#/lib/price-compare-server'
import type { BasketComparison } from '#/lib/pricing'
import { log } from '#/lib/log'

/**
 * Shared price-comparison fetch for the Cart screen (#cart-align).
 *
 * The Cart screen now has ONE store switch (AH / Jumbo / Picnic) that drives the
 * running total, the per-item prices in the list, and the order button at once.
 * All three read from the same per-store baskets, so the comparison is fetched
 * ONCE here and shared, instead of each surface fetching its own (the old
 * PriceComparison owned its own call).
 *
 * The 4 MB catalogue stays server-side: comparePrices does the matching +
 * pack-rounding + waste maths and ships only the small result. We re-fetch only
 * when the set of unchecked lines actually changes (serialised key), reading the
 * latest lines through a ref so a fresh array each render doesn't churn.
 */
export function usePriceComparison(lines: Array<PriceCompareLine>): {
  data: BasketComparison | null
  loading: boolean
  failed: boolean
} {
  const [data, setData] = useState<BasketComparison | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  const key = lines.map((l) => `${l.name}|${l.amount ?? ''}`).join('\n')
  const linesRef = useRef(lines)
  linesRef.current = lines

  useEffect(() => {
    let live = true
    if (linesRef.current.length === 0) {
      setData({ baskets: [], cheapest: null })
      setLoading(false)
      setFailed(false)
      return
    }
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

  return { data, loading, failed }
}

/**
 * Build a name -> line-price-in-cents map for one store's basket, so the list
 * rows can show a per-item price. Keyed on the ingredient name the request sent
 * (BasketLineItem.ingredient), which is the shopping-list name, so the lookup is
 * a direct match. Returns an empty map when the store isn't in the comparison.
 */
export function priceMapForStore(
  data: BasketComparison | null,
  store: string,
): Map<string, number> {
  const map = new Map<string, number>()
  const basket = data?.baskets.find((b) => b.store === store)
  if (!basket) return map
  for (const item of basket.lineItems) {
    // First match wins; consolidate already de-duped ingredient names.
    if (!map.has(item.ingredient)) map.set(item.ingredient, item.lineCents)
  }
  return map
}
