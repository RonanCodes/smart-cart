import { describe, it, expect } from 'vitest'
import { cheapestOf, mergeStoreBasket } from './use-price-comparison'
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
