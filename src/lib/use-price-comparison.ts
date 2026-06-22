import { useEffect, useRef, useState } from 'react'
import {
  comparePriceForStore,
  listCompareStores,
} from '#/lib/price-compare-server'
import type { PriceCompareLine } from '#/lib/price-compare-server'
import type { BasketComparison, StoreBasket } from '#/lib/pricing'
import { log } from '#/lib/log'

/**
 * Recompute the cheapest store from a set of per-store baskets. The cheapest is
 * the lowest non-empty total; a store with nothing matched never wins. Exported
 * so the progressive merge + its test agree on the rule.
 */
export function cheapestOf(baskets: Array<StoreBasket>): StoreBasket | null {
  let cheapest: StoreBasket | null = null
  for (const b of baskets) {
    if (b.lineItems.length === 0) continue
    if (cheapest === null || b.totalCents < cheapest.totalCents) cheapest = b
  }
  return cheapest
}

/**
 * The maximum number of lines sent to the matcher in ONE comparePriceForStore
 * invocation (#shopping-1101).
 *
 * The accurate tier runs an embedding + multi-query retrieval + LLM rerank PER
 * uncached line against the in-memory ~4 MB catalogue. A single invocation that
 * resolved every line of a big cart blew the Cloudflare Worker isolate's hard
 * 128 MB / CPU cap, killing it -> a Cloudflare 1101 for the whole request. The
 * cart now splits its lines into chunks of this size and fans one call per chunk
 * (per store), so no single isolate invocation ever fans out across an unbounded
 * N. This is a CALL-SITE bound; the matcher internals are untouched.
 *
 * 25 keeps the worst-case per-invocation work well under the limit while staying
 * a single chunk for an ordinary week's cart (so no extra round-trips there).
 */
export const PRICE_COMPARE_CHUNK_SIZE = 25

/**
 * Split a line set into fixed-size chunks of at most `size` (#shopping-1101), in
 * order, so the matcher fan-out per request is bounded. Pure; the order + count
 * invariant is locked by the test. An empty list yields no chunks.
 */
export function chunkLines<T>(
  lines: ReadonlyArray<T>,
  size: number,
): Array<Array<T>> {
  const safeSize = size > 0 ? size : 1
  const chunks: Array<Array<T>> = []
  for (let i = 0; i < lines.length; i += safeSize) {
    chunks.push(lines.slice(i, i + safeSize))
  }
  return chunks
}

/**
 * Recombine the per-chunk baskets for ONE store back into a single basket
 * (#shopping-1101). Because the lines were chunked across several invocations,
 * each chunk returns its own partial StoreBasket; this sums their totals and
 * concatenates their line items / unavailable / waste into the whole-store
 * basket the UI expects. A null chunk basket (the chunk errored, or had no
 * priceable lines) is skipped, so a partial set still produces a basket. Returns
 * null only when EVERY chunk failed, so the store is dropped (never crashes).
 */
export function mergeChunkBaskets(
  store: string,
  displayName: string,
  chunks: ReadonlyArray<StoreBasket | null>,
): StoreBasket | null {
  const present = chunks.filter((b): b is StoreBasket => b !== null)
  if (present.length === 0) return null

  const merged: StoreBasket = {
    store,
    displayName: present[0]?.displayName ?? displayName,
    lineItems: [],
    totalCents: 0,
    totalWaste: {
      cents: 0,
      massGrams: 0,
      volumeMl: 0,
      count: 0,
      unknownLines: 0,
      hasUnknown: false,
    },
    unavailable: [],
    estimatedCount: 0,
  }
  for (const b of present) {
    merged.lineItems.push(...b.lineItems)
    merged.totalCents += b.totalCents
    merged.unavailable.push(...b.unavailable)
    merged.estimatedCount += b.estimatedCount
    merged.totalWaste.cents += b.totalWaste.cents
    merged.totalWaste.massGrams += b.totalWaste.massGrams
    merged.totalWaste.volumeMl += b.totalWaste.volumeMl
    merged.totalWaste.count += b.totalWaste.count
    merged.totalWaste.unknownLines += b.totalWaste.unknownLines
    merged.totalWaste.hasUnknown =
      merged.totalWaste.hasUnknown || b.totalWaste.hasUnknown
  }
  return merged
}

/**
 * Merge one freshly-resolved store basket into a running comparison, keeping the
 * baskets de-duped by store and the cheapest recomputed. A null basket (a store
 * with no priceable lines / not covered) is dropped, not stored. Pure, so the
 * progressive-fill shaping is unit-testable without React (#439).
 */
export function mergeStoreBasket(
  prev: BasketComparison | null,
  basket: StoreBasket | null,
): BasketComparison {
  const baskets = prev ? [...prev.baskets] : []
  if (basket) {
    const at = baskets.findIndex((b) => b.store === basket.store)
    if (at >= 0) baskets[at] = basket
    else baskets.push(basket)
  }
  return { baskets, cheapest: cheapestOf(baskets) }
}

/**
 * Shared price-comparison fetch for the Cart screen (#cart-align), loaded
 * PROGRESSIVELY (#439).
 *
 * The Cart screen has ONE store switch (AH / Jumbo / Picnic) that drives the
 * running total, the per-item prices in the list, and the order button at once.
 * All three read from the same per-store baskets, so the comparison is fetched
 * here and shared, instead of each surface fetching its own.
 *
 * #439: the accurate-tier matcher costs an LLM call per line PER store, so a
 * single call that priced every store before returning made the switch sit on a
 * spinner for the slowest store. Instead we fan out one {@link comparePriceForStore}
 * call per covered store IN PARALLEL and merge each basket into `data` the moment
 * it resolves, so the cart renders immediately and every store's total fills in
 * independently. The cart structure never waits on pricing; `loading` stays true
 * until every store has settled so a not-yet-arrived store keeps its own spinner
 * while arrived stores already show their total. `failed` is set only when every
 * store errors (a partial set is a success).
 *
 * The 4 MB catalogue stays server-side. We re-fetch only when the set of lines
 * actually changes (serialised key), reading the latest lines through a ref so a
 * fresh array each render doesn't churn.
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
    // An AbortController is the cancel token: the cleanup aborts it so a settle
    // that lands after the lines changed / the component unmounted is dropped.
    // (signal.aborted is opaque to the linter, unlike a bare boolean it would
    // wrongly narrow to "never flips" across the async IIFE.)
    const ac = new AbortController()
    const cancelled = () => ac.signal.aborted
    const snapshot = linesRef.current
    if (snapshot.length === 0) {
      setData({ baskets: [], cheapest: null })
      setLoading(false)
      setFailed(false)
      return
    }
    // Reset to a clean empty comparison so the switch shows the per-store
    // spinners (not stale totals) while the new lines re-price.
    setData(null)
    setLoading(true)
    setFailed(false)

    void (async () => {
      let stores: Array<string>
      try {
        stores = await listCompareStores()
      } catch (err) {
        log.warn('price-compare store-list failed', { err: String(err) })
        if (!cancelled()) {
          setFailed(true)
          setLoading(false)
        }
        return
      }
      if (cancelled()) return
      if (stores.length === 0) {
        setData({ baskets: [], cheapest: null })
        setLoading(false)
        return
      }

      // Fan out per store; merge each basket as it arrives (progressive fill).
      // Each store's total appears the moment its own call resolves; the global
      // `loading` stays true until every store has settled so a not-yet-arrived
      // store keeps its spinner (CartStoreSwitch shows price-or-spinner per store).
      // Each task returns whether it landed (true) or errored (false) so the
      // all-failed check reads off the settled results, not a closure counter.
      //
      // #shopping-1101: a big cart used to send EVERY line in ONE invocation per
      // store. The accurate matcher's per-line embedding + rerank against the
      // in-memory ~4 MB catalogue blew the Worker isolate's 128 MB / CPU cap, so
      // Cloudflare killed it (1101) for the whole request. We now split the lines
      // into PRICE_COMPARE_CHUNK_SIZE chunks and fan one call PER CHUNK, so no
      // single isolate invocation ever resolves more than the cap. A chunk that
      // throws (or the isolate that runs it) degrades to a null partial basket
      // instead of bubbling; the store still shows whatever its other chunks
      // priced. The store counts as landed if ANY chunk resolved.
      const chunks = chunkLines(snapshot, PRICE_COMPARE_CHUNK_SIZE)
      const outcomes = await Promise.all(
        stores.map(async (store): Promise<boolean> => {
          const chunkBaskets = await Promise.all(
            chunks.map(async (chunk): Promise<StoreBasket | null> => {
              try {
                return await comparePriceForStore({
                  data: { store, lines: chunk },
                })
              } catch (err) {
                // A single chunk overran / errored: degrade THIS chunk to null so
                // the store still totals from the chunks that did resolve. Never
                // rethrow — a failed comparePrices must never reach a page error.
                log.warn('price-compare chunk failed', {
                  event: 'price_compare.chunk_degraded',
                  store,
                  chunkLines: chunk.length,
                  totalLines: snapshot.length,
                  err: String(err),
                })
                return null
              }
            }),
          )
          const basket = mergeChunkBaskets(store, store, chunkBaskets)
          // Every chunk failed for this store: count it as not-landed so the
          // all-failed check can surface `failed` when no store priced at all.
          if (basket === null) return false
          if (!cancelled()) setData((prev) => mergeStoreBasket(prev, basket))
          return true
        }),
      )
      if (cancelled()) return
      setLoading(false)
      // Every store errored: surface the failure (a partial set is a success).
      if (outcomes.every((ok) => !ok)) setFailed(true)
    })()

    return () => {
      ac.abort()
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
