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

/** Re-sum totals and waste after line items were added or removed. */
export function resummariseStoreBasket(b: StoreBasket): StoreBasket {
  let totalCents = 0
  let estimatedCount = 0
  const totalWaste: StoreBasket['totalWaste'] = {
    cents: 0,
    massGrams: 0,
    volumeMl: 0,
    count: 0,
    unknownLines: 0,
    hasUnknown: false,
  }
  for (const li of b.lineItems) {
    totalCents += li.lineCents
    if (li.estimated) estimatedCount += 1
    if (!li.waste) {
      if (li.lineCents > 0) {
        totalWaste.unknownLines += 1
        totalWaste.hasUnknown = true
      }
      continue
    }
    totalWaste.cents += li.waste.cents
    if (li.waste.dimension === 'mass')
      totalWaste.massGrams += li.waste.baseQuantity
    else if (li.waste.dimension === 'volume')
      totalWaste.volumeMl += li.waste.baseQuantity
    else totalWaste.count += li.waste.baseQuantity
  }
  totalWaste.massGrams = Math.round(totalWaste.massGrams * 100) / 100
  totalWaste.volumeMl = Math.round(totalWaste.volumeMl * 100) / 100
  totalWaste.count = Math.round(totalWaste.count * 100) / 100
  return { ...b, totalCents, estimatedCount, totalWaste }
}

/** Stable key for a compare line (name + amount). Used for incremental pricing. */
export function lineKey(line: PriceCompareLine): string {
  return `${line.name}|${line.amount ?? ''}`
}

/**
 * Drop priced lines that left the live cart (unchecked / removed / renamed) and
 * recompute the cheapest. Keeps already-priced lines when the set grows (#cart-
 * incremental-price).
 */
export function pruneComparison(
  data: BasketComparison | null,
  lines: ReadonlyArray<PriceCompareLine>,
): BasketComparison | null {
  if (!data) return null
  const currentNames = new Set(lines.map((l) => l.name))
  const baskets = data.baskets.map((b) => {
    const lineItems = b.lineItems.filter((li) =>
      currentNames.has(li.ingredient),
    )
    const unavailable = b.unavailable.filter((u) =>
      currentNames.has(u.ingredient),
    )
    if (
      lineItems.length === b.lineItems.length &&
      unavailable.length === b.unavailable.length
    ) {
      return b
    }
    return resummariseStoreBasket({ ...b, lineItems, unavailable })
  })
  return { baskets, cheapest: cheapestOf(baskets) }
}

/**
 * Lines that still need an accurate-tier price for at least one store. The
 * priced-keys map is the source of truth so a partial in-flight run that was
 * aborted does not skip re-pricing.
 */
export function linesNeedingPrice(
  lines: ReadonlyArray<PriceCompareLine>,
  stores: ReadonlyArray<string>,
  pricedKeysPerStore: ReadonlyMap<string, ReadonlySet<string>>,
): Array<PriceCompareLine> {
  return lines.filter((line) => {
    const key = lineKey(line)
    return stores.some((store) => !pricedKeysPerStore.get(store)?.has(key))
  })
}

/**
 * Merge a freshly-priced delta basket into an existing store basket, replacing
 * any prior line for the same ingredient (#cart-incremental-price).
 */
export function mergeIncrementalBasket(
  existing: StoreBasket | undefined,
  delta: StoreBasket,
): StoreBasket {
  const touched = new Set([
    ...delta.lineItems.map((li) => li.ingredient),
    ...delta.unavailable.map((u) => u.ingredient),
  ])
  const kept: StoreBasket | null = existing
    ? {
        ...existing,
        lineItems: existing.lineItems.filter(
          (li) => !touched.has(li.ingredient),
        ),
        unavailable: existing.unavailable.filter(
          (u) => !touched.has(u.ingredient),
        ),
      }
    : null
  return mergeChunkBaskets(delta.store, delta.displayName, [kept, delta])!
}

/** Drop priced-key entries that no longer appear in the live line set. */
export function prunePricedKeys(
  pricedKeysPerStore: Map<string, Set<string>>,
  lines: ReadonlyArray<PriceCompareLine>,
): void {
  const current = new Set(lines.map(lineKey))
  for (const keys of pricedKeysPerStore.values()) {
    for (const key of [...keys]) {
      if (!current.has(key)) keys.delete(key)
    }
  }
}

/** How many lines are fully priced across every covered store. */
export function pricedLineCount(
  lines: ReadonlyArray<PriceCompareLine>,
  stores: ReadonlyArray<string>,
  pricedKeysPerStore: ReadonlyMap<string, ReadonlySet<string>>,
): number {
  return lines.filter((line) => {
    const key = lineKey(line)
    return stores.every((store) => pricedKeysPerStore.get(store)?.has(key))
  }).length
}

/** How many lines one store has priced (matches that store's visible prices). */
export function pricedLineCountForStore(
  lines: ReadonlyArray<PriceCompareLine>,
  store: string,
  pricedKeysPerStore: ReadonlyMap<string, ReadonlySet<string>>,
): number {
  const keys = pricedKeysPerStore.get(store)
  if (!keys || keys.size === 0) return 0
  return lines.filter((line) => keys.has(lineKey(line))).length
}

/** Line keys still pending for one store. */
export function pendingLineKeysForStore(
  lines: ReadonlyArray<PriceCompareLine>,
  store: string,
  pricedKeysPerStore: ReadonlyMap<string, ReadonlySet<string>>,
): ReadonlySet<string> {
  const keys = pricedKeysPerStore.get(store)
  return new Set(lines.filter((line) => !keys?.has(lineKey(line))).map(lineKey))
}

export type StorePricingProgress = { priced: number; total: number }

/** Per-store priced/total counts from the priced-keys map. */
export function buildStoreProgress(
  lines: ReadonlyArray<PriceCompareLine>,
  stores: ReadonlyArray<string>,
  pricedKeysPerStore: ReadonlyMap<string, ReadonlySet<string>>,
): Record<string, StorePricingProgress> {
  const total = lines.length
  const out: Record<string, StorePricingProgress> = {}
  for (const store of stores) {
    out[store] = {
      priced: pricedLineCountForStore(lines, store, pricedKeysPerStore),
      total,
    }
  }
  return out
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
 * The 4 MB catalogue stays server-side. We re-fetch only the lines that are NEW
 * or changed (serialised key), keeping already-priced rows visible (#cart-
 * incremental-price). Each chunk merges into the running basket as it lands so
 * per-item prices and store totals fill in progressively.
 */
export function usePriceComparison(lines: Array<PriceCompareLine>): {
  data: BasketComparison | null
  loading: boolean
  failed: boolean
  /** Per-store line keys still being priced. Empty sets when idle. */
  storePendingLineKeys: Record<string, ReadonlySet<string>>
} {
  const [data, setData] = useState<BasketComparison | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [storePendingLineKeys, setStorePendingLineKeys] = useState<
    Record<string, ReadonlySet<string>>
  >({})

  const key = lines.map((l) => lineKey(l)).join('\n')
  const linesRef = useRef(lines)
  linesRef.current = lines
  /** Per-store set of line keys already priced this session (#cart-incremental). */
  const pricedKeysRef = useRef<Map<string, Set<string>>>(new Map())

  const syncStorePendingLineKeys = (
    snapshot: ReadonlyArray<PriceCompareLine>,
    stores: ReadonlyArray<string>,
  ) => {
    const pending: Record<string, ReadonlySet<string>> = {}
    for (const store of stores) {
      pending[store] = pendingLineKeysForStore(
        snapshot,
        store,
        pricedKeysRef.current,
      )
    }
    setStorePendingLineKeys(pending)
  }

  useEffect(() => {
    const ac = new AbortController()
    const cancelled = () => ac.signal.aborted
    const snapshot = linesRef.current

    if (snapshot.length === 0) {
      pricedKeysRef.current.clear()
      setData({ baskets: [], cheapest: null })
      setLoading(false)
      setFailed(false)
      setStorePendingLineKeys({})
      return
    }

    prunePricedKeys(pricedKeysRef.current, snapshot)
    setData((prev) => pruneComparison(prev, snapshot))
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
          setStorePendingLineKeys({})
        }
        return
      }
      if (cancelled()) return
      if (stores.length === 0) {
        setData({ baskets: [], cheapest: null })
        setLoading(false)
        setStorePendingLineKeys({})
        return
      }

      const toPrice = linesNeedingPrice(snapshot, stores, pricedKeysRef.current)
      if (toPrice.length === 0) {
        setLoading(false)
        setStorePendingLineKeys({})
        return
      }

      syncStorePendingLineKeys(snapshot, stores)
      setLoading(true)

      const chunks = chunkLines(toPrice, PRICE_COMPARE_CHUNK_SIZE)
      const outcomes = await Promise.all(
        stores.map(async (store): Promise<boolean> => {
          const chunkOutcomes = await Promise.all(
            chunks.map(async (chunk): Promise<boolean> => {
              if (cancelled()) return false
              let partial: StoreBasket | null
              try {
                partial = await comparePriceForStore({
                  data: { store, lines: chunk },
                })
              } catch (err) {
                log.warn('price-compare chunk failed', {
                  event: 'price_compare.chunk_degraded',
                  store,
                  chunkLines: chunk.length,
                  totalLines: snapshot.length,
                  err: String(err),
                })
                return false
              }
              if (cancelled() || partial === null) return false

              let keys = pricedKeysRef.current.get(store)
              if (!keys) {
                keys = new Set()
                pricedKeysRef.current.set(store, keys)
              }
              for (const line of chunk) keys.add(lineKey(line))

              if (!cancelled()) {
                setData((prev) => {
                  const existing = prev?.baskets.find((b) => b.store === store)
                  const merged = mergeIncrementalBasket(existing, partial)
                  return mergeStoreBasket(prev, merged)
                })
                syncStorePendingLineKeys(snapshot, stores)
              }
              return true
            }),
          )
          return chunkOutcomes.some(Boolean)
        }),
      )

      if (cancelled()) return
      setLoading(false)
      setStorePendingLineKeys({})
      if (outcomes.every((ok) => !ok)) setFailed(true)
    })()

    return () => {
      ac.abort()
    }
  }, [key])

  return { data, loading, failed, storePendingLineKeys }
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
