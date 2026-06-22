import { describe, it, expect } from 'vitest'
import {
  cheapestOf,
  mergeStoreBasket,
  chunkLines,
  mergeChunkBaskets,
  PRICE_COMPARE_CHUNK_SIZE,
} from './use-price-comparison'
import type { PriceCompareLine } from '#/lib/price-compare-server'
import type { StoreBasket } from '#/lib/pricing'

/**
 * #439: the cart prices each store progressively (one fan-out call per store,
 * merged as it lands) instead of one slow call that blocks on every store. The
 * merge shaping is pure, so it's locked here without React: each store basket
 * arriving must (a) accumulate de-duped by store, (b) recompute the cheapest,
 * and (c) ignore stores with nothing matched.
 */

function basket(store: string, totalCents: number, items = 1): StoreBasket {
  return {
    store,
    displayName: store,
    lineItems: Array.from({ length: items }, (_, i) => ({
      ingredient: `item-${i}`,
      lineCents: totalCents,
    })) as StoreBasket['lineItems'],
    totalCents,
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
}

describe('mergeStoreBasket (progressive price fill, #439)', () => {
  it('accumulates baskets as each store lands', () => {
    let acc = mergeStoreBasket(null, basket('ah', 1200))
    expect(acc.baskets.map((b) => b.store)).toEqual(['ah'])
    acc = mergeStoreBasket(acc, basket('jumbo', 1100))
    expect(acc.baskets.map((b) => b.store)).toEqual(['ah', 'jumbo'])
  })

  it('re-prices the cheapest as cheaper stores arrive', () => {
    let acc = mergeStoreBasket(null, basket('ah', 1200))
    expect(acc.cheapest?.store).toBe('ah')
    acc = mergeStoreBasket(acc, basket('jumbo', 1100))
    expect(acc.cheapest?.store).toBe('jumbo')
  })

  it('replaces (does not duplicate) a store priced twice', () => {
    let acc = mergeStoreBasket(null, basket('ah', 1200))
    acc = mergeStoreBasket(acc, basket('ah', 1300))
    expect(acc.baskets).toHaveLength(1)
    expect(acc.baskets[0]?.totalCents).toBe(1300)
  })

  it('drops a null basket (no priceable lines / uncovered store)', () => {
    const acc = mergeStoreBasket(null, null)
    expect(acc.baskets).toEqual([])
    expect(acc.cheapest).toBeNull()
  })

  it('never lets an empty (no-match) basket win cheapest', () => {
    let acc = mergeStoreBasket(null, basket('picnic', 0, 0))
    expect(acc.cheapest).toBeNull()
    acc = mergeStoreBasket(acc, basket('ah', 999))
    expect(acc.cheapest?.store).toBe('ah')
  })
})

describe('cheapestOf', () => {
  it('returns null when nothing matched anywhere', () => {
    expect(cheapestOf([basket('ah', 0, 0), basket('jumbo', 0, 0)])).toBeNull()
  })
})

/**
 * P0 #shopping-1101: a big cart used to 1101 because the cart sent EVERY line to
 * the matcher in ONE comparePriceForStore invocation per store. The accurate
 * tier runs an embedding + retrieval + LLM rerank per uncached line against the
 * in-memory ~4 MB catalogue, so one invocation resolving N lines blew the Worker
 * isolate's 128 MB / CPU cap and Cloudflare killed it -> 1101 for the request.
 *
 * The fix bounds the work PER INVOCATION at the call site: split the lines into
 * fixed-size chunks and fan one comparePriceForStore call per chunk, so no single
 * isolate invocation ever resolves more than PRICE_COMPARE_CHUNK_SIZE lines. The
 * partial baskets for the same store are then merged back into one. These are the
 * two pure seams the hook composes; locked here without React.
 */
function lines(n: number): Array<PriceCompareLine> {
  return Array.from({ length: n }, (_, i) => ({
    name: `ingredient-${i}`,
    amount: '1 stuks',
  }))
}

describe('chunkLines (bound the matcher fan-out per request, #shopping-1101)', () => {
  it('splits a big line set into fixed-size chunks no larger than the cap', () => {
    const all = lines(57)
    const chunks = chunkLines(all, PRICE_COMPARE_CHUNK_SIZE)
    expect(chunks.length).toBeGreaterThan(1)
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(PRICE_COMPARE_CHUNK_SIZE)
      expect(c.length).toBeGreaterThan(0)
    }
    // Every line is preserved, in order, with none lost or duplicated.
    expect(chunks.flat()).toEqual(all)
  })

  it('keeps the cap sane (a real Worker-memory bound, not unbounded)', () => {
    // A guard against someone setting the cap so high it stops bounding anything.
    expect(PRICE_COMPARE_CHUNK_SIZE).toBeGreaterThan(0)
    expect(PRICE_COMPARE_CHUNK_SIZE).toBeLessThanOrEqual(40)
  })

  it('returns a single chunk for a small cart (no extra round-trips)', () => {
    const all = lines(3)
    const chunks = chunkLines(all, PRICE_COMPARE_CHUNK_SIZE)
    expect(chunks).toEqual([all])
  })

  it('returns no chunks for an empty list', () => {
    expect(chunkLines([], PRICE_COMPARE_CHUNK_SIZE)).toEqual([])
  })
})

describe('mergeChunkBaskets (recombine chunked baskets for one store, #shopping-1101)', () => {
  it('sums totals and concatenates line items across chunks', () => {
    const a = basket('ah', 1200, 2)
    const b = basket('ah', 800, 3)
    const merged = mergeChunkBaskets('ah', 'Albert Heijn', [a, b])
    expect(merged).not.toBeNull()
    expect(merged?.store).toBe('ah')
    expect(merged?.totalCents).toBe(2000)
    expect(merged?.lineItems).toHaveLength(5)
  })

  it('ignores null chunk baskets (a chunk that errored / had no priceable lines)', () => {
    const a = basket('ah', 999, 1)
    const merged = mergeChunkBaskets('ah', 'Albert Heijn', [a, null])
    expect(merged?.totalCents).toBe(999)
    expect(merged?.lineItems).toHaveLength(1)
  })

  it('returns null when every chunk failed (so the store is simply dropped)', () => {
    expect(mergeChunkBaskets('ah', 'Albert Heijn', [null, null])).toBeNull()
  })
})
