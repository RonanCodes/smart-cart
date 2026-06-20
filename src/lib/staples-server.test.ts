import { describe, it, expect } from 'vitest'
import {
  deriveProductKey,
  hitToResult,
  rowToLine,
  searchStaplesPure,
  frequentlyBoughtPure,
} from './staples-server'
import type { ProductSearchHit } from './pricing'

/** A minimal StoreProduct-bearing hit for the mapping tests. */
function hit(
  over: Partial<ProductSearchHit['product']> = {},
): ProductSearchHit {
  return {
    score: 0.9,
    product: {
      store: 'ah',
      name: 'AH Halfvolle melk',
      normalisedName: 'ah halfvolle melk',
      priceCents: 119,
      slug: 'wi1/melk-half',
      size: {
        raw: '1 l',
        quantity: 1,
        unit: 'l',
        dimension: 'volume',
        approx: false,
      },
      ...over,
    },
  }
}

describe('deriveProductKey', () => {
  it('uses store + slug when a slug exists', () => {
    expect(deriveProductKey('ah', 'wi1/melk', 'AH Melk')).toBe('ah:wi1/melk')
  })

  it('falls back to store + normalised name with no slug', () => {
    const key = deriveProductKey('jumbo', null, 'Jumbo Volle Melk')
    expect(key).toBe('jumbo:jumbo volle melk')
  })

  it('lower-cases the store and is stable for the same product', () => {
    const a = deriveProductKey('AH', 'wi1/melk', 'AH Melk')
    const b = deriveProductKey('ah', 'wi1/melk', 'AH Melk')
    expect(a).toBe(b)
    expect(a.startsWith('ah:')).toBe(true)
  })
})

describe('hitToResult', () => {
  it('maps a hit to the UI result shape with a formatted price', () => {
    const r = hitToResult(hit())
    expect(r.name).toBe('AH Halfvolle melk')
    expect(r.store).toBe('ah')
    expect(r.priceCents).toBe(119)
    expect(r.priceLabel).toBe('€1.19')
    expect(r.size).toBe('1 l')
    expect(r.productKey).toBe('ah:wi1/melk-half')
  })

  it('tolerates a missing/non-finite price', () => {
    const r = hitToResult(hit({ priceCents: Number.NaN }))
    expect(r.priceCents).toBeNull()
    expect(r.priceLabel).toBeNull()
  })

  it('nulls an empty size', () => {
    const r = hitToResult(
      hit({
        size: {
          raw: '',
          quantity: null,
          unit: null,
          dimension: 'unknown',
          approx: false,
        },
      }),
    )
    expect(r.size).toBeNull()
  })
})

describe('rowToLine', () => {
  it('formats a persisted staple row into a shopping line', () => {
    const line = rowToLine({
      id: 'abc',
      name: 'AH Koffiebonen',
      store: 'ah',
      priceCents: 499,
      productSlug: 'wi3/koffie',
    })
    expect(line).toEqual({
      id: 'abc',
      name: 'AH Koffiebonen',
      store: 'ah',
      priceCents: 499,
      priceLabel: '€4.99',
      productSlug: 'wi3/koffie',
    })
  })

  it('handles a null price', () => {
    const line = rowToLine({
      id: 'x',
      name: 'Snacks',
      store: 'jumbo',
      priceCents: null,
      productSlug: null,
    })
    expect(line.priceLabel).toBeNull()
  })
})

describe('searchStaplesPure (against the vendored catalogue)', () => {
  it('finds real milk products with a key, price label and store', () => {
    const results = searchStaplesPure('melk', ['ah', 'jumbo'], 5)
    expect(results.length).toBeGreaterThan(0)
    const first = results[0]!
    expect(first.name.toLowerCase()).toContain('melk')
    expect(['ah', 'jumbo']).toContain(first.store)
    expect(first.productKey.length).toBeGreaterThan(0)
  })

  it('de-dupes by productKey', () => {
    const results = searchStaplesPure('melk', ['ah', 'jumbo'], 8)
    const keys = results.map((r) => r.productKey)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('respects the limit', () => {
    const results = searchStaplesPure('melk', ['ah', 'jumbo'], 3)
    expect(results.length).toBeLessThanOrEqual(3)
  })

  it('returns nothing for a blank query', () => {
    expect(searchStaplesPure('  ', ['ah', 'jumbo'])).toEqual([])
  })
})

describe('frequentlyBoughtPure', () => {
  it('resolves common staples to real products with labels', () => {
    const items = frequentlyBoughtPure(['ah', 'jumbo'])
    expect(items.length).toBeGreaterThan(0)
    for (const item of items) {
      expect(item.label.length).toBeGreaterThan(0)
      expect(item.result.name.length).toBeGreaterThan(0)
      expect(item.result.productKey.length).toBeGreaterThan(0)
    }
  })

  it('includes Milk as a resolvable staple', () => {
    const items = frequentlyBoughtPure(['ah', 'jumbo'])
    expect(items.some((i) => i.label === 'Milk')).toBe(true)
  })
})
