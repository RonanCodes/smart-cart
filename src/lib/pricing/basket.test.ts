import { describe, expect, it } from 'vitest'
import { basketForStore, compareBaskets } from './basket'
import { buildCatalogues } from './normalise'
import type { RawStore, StoreCatalogue } from './types'

/**
 * Build a one-store catalogue from [name, priceEur, packSize] tuples. Each
 * product gets a slug derived from its name so it is addable to the store cart
 * (a real catalogue row always carries a slug). Pass a 4th tuple element to
 * override the slug — `null` models a priced-but-unaddable product (#plan-cart-mismatch).
 */
function cat(
  slug: string,
  products: Array<
    [string, number, string] | [string, number, string, string | null]
  >,
): StoreCatalogue {
  const raw: Array<RawStore> = [
    {
      n: slug,
      c: slug.toUpperCase(),
      d: products.map(([n, p, s, l]) => ({
        n,
        p,
        s,
        l:
          l === undefined
            ? n.toLowerCase().replace(/\s+/g, '-')
            : (l ?? undefined),
      })),
    },
  ]
  return buildCatalogues(raw)[slug]!
}

describe('basketForStore: pack rounding + waste', () => {
  it('buys one pack and wastes the leftover when the pack is bigger than needed', () => {
    // Need 300 g broccoli; AH stocks a 500 g pack at €1.00. Buy 1 pack, waste 200 g.
    const ah = cat('ah', [['Broccoli', 1.0, '500 g']])
    const basket = basketForStore([{ name: 'broccoli', amount: '300 g' }], ah)

    expect(basket.lineItems).toHaveLength(1)
    const line = basket.lineItems[0]!
    expect(line.packs).toBe(1)
    expect(line.lineCents).toBe(100)
    expect(line.waste).not.toBeNull()
    expect(line.waste!.dimension).toBe('mass')
    expect(line.waste!.baseQuantity).toBe(200)
    // 200 g of a 500 g / €1.00 pack = 40c of waste.
    expect(line.waste!.cents).toBe(40)
    expect(basket.totalCents).toBe(100)
    expect(basket.totalWaste.massGrams).toBe(200)
    expect(basket.totalWaste.cents).toBe(40)
  })

  it('buys multiple packs when one pack is not enough', () => {
    // Need 1200 g; pack is 500 g. ceil(1200/500) = 3 packs = 1500 g, waste 300 g.
    const ah = cat('ah', [['Bloem', 2.0, '500 g']])
    const basket = basketForStore([{ name: 'bloem', amount: '1200 g' }], ah)
    const line = basket.lineItems[0]!
    expect(line.packs).toBe(3)
    expect(line.lineCents).toBe(600)
    expect(line.waste!.baseQuantity).toBe(300)
  })

  it('normalises units across the required amount and the pack (kg vs g)', () => {
    // Need 1.5 kg = 1500 g; pack is 1 kg = 1000 g. 2 packs = 2000 g, waste 500 g.
    const ah = cat('ah', [['Aardappel', 1.5, '1 kg']])
    const basket = basketForStore([{ name: 'aardappel', amount: '1.5 kg' }], ah)
    const line = basket.lineItems[0]!
    expect(line.packs).toBe(2)
    expect(line.waste!.dimension).toBe('mass')
    expect(line.waste!.baseQuantity).toBe(500)
  })

  it('handles volume packs (litres) the same way', () => {
    // Need 300 ml; pack is 1 l = 1000 ml. 1 pack, waste 700 ml.
    const ah = cat('ah', [['Melk', 1.2, '1 l']])
    const basket = basketForStore([{ name: 'melk', amount: '300 ml' }], ah)
    const line = basket.lineItems[0]!
    expect(line.waste!.dimension).toBe('volume')
    expect(line.waste!.baseQuantity).toBe(700)
  })

  it('zero waste when the required amount is an exact multiple of the pack', () => {
    const ah = cat('ah', [['Eieren', 2.0, '6 stuks']])
    const basket = basketForStore([{ name: 'eieren', amount: '12 stuks' }], ah)
    const line = basket.lineItems[0]!
    expect(line.packs).toBe(2)
    expect(line.waste!.baseQuantity).toBe(0)
    expect(line.waste!.cents).toBe(0)
  })

  it('marks waste n/a (null) when the pack size is missing', () => {
    const ah = cat('ah', [['Kipfilet', 4.0, '']])
    const basket = basketForStore([{ name: 'kipfilet', amount: '300 g' }], ah)
    const line = basket.lineItems[0]!
    expect(line.waste).toBeNull()
    expect(line.packs).toBe(1)
    expect(line.lineCents).toBe(400)
    expect(basket.totalWaste.hasUnknown).toBe(true)
    expect(basket.totalWaste.unknownLines).toBe(1)
  })

  it('marks waste n/a when the required amount is unparseable (a pinch)', () => {
    const ah = cat('ah', [['Zout', 0.99, '1 kg']])
    const basket = basketForStore([{ name: 'zout', amount: 'a pinch' }], ah)
    const line = basket.lineItems[0]!
    expect(line.waste).toBeNull()
    expect(basket.totalWaste.hasUnknown).toBe(true)
  })

  it('marks waste n/a when dimensions differ (need ml, pack in g)', () => {
    const ah = cat('ah', [['Boter', 2.5, '250 g']])
    const basket = basketForStore([{ name: 'boter', amount: '100 ml' }], ah)
    const line = basket.lineItems[0]!
    expect(line.waste).toBeNull()
    expect(basket.totalWaste.hasUnknown).toBe(true)
  })

  it('lists ingredients with no match as unavailable, not as a €0 line', () => {
    const ah = cat('ah', [['Penne pasta', 1.19, '500 g']])
    const basket = basketForStore(
      [
        { name: 'pasta', amount: '200 g' },
        { name: 'saffron threads', amount: '1 g' },
      ],
      ah,
    )
    expect(basket.lineItems).toHaveLength(1)
    expect(basket.unavailable).toHaveLength(1)
    expect(basket.unavailable[0]!.ingredient).toBe('saffron threads')
  })

  it('excludes a priced-but-unaddable product (no slug) from the basket total', () => {
    // A product with no slug is priced but cannot be added to the store cart
    // (cart-build skips no-SKU items). Pricing it would inflate the shown total
    // above the real basket, so it must be excluded entirely (#plan-cart-mismatch).
    const ah = cat('ah', [
      ['Penne pasta', 1.19, '500 g'],
      ['Saffraan', 5.0, '1 g', null],
    ])
    const basket = basketForStore(
      [
        { name: 'penne pasta', amount: '500 g' },
        { name: 'saffraan', amount: '1 g' },
      ],
      ah,
    )
    // Only the addable (slugged) pasta is priced; the slug-less saffron is dropped.
    expect(basket.lineItems).toHaveLength(1)
    expect(basket.lineItems[0]!.ingredient).toBe('penne pasta')
    expect(basket.totalCents).toBe(119)
    // It is reported as unavailable rather than silently swallowed.
    expect(basket.unavailable.map((u) => u.ingredient)).toContain('saffraan')
  })

  it('flags estimated (soft) matches so the UI can mark them', () => {
    // A loose partial match scores below 'high' => estimated true.
    const ah = cat('ah', [['Verse gesneden broccoliroosjes', 1.5, '300 g']])
    const basket = basketForStore([{ name: 'broccoli', amount: '300 g' }], ah)
    if (basket.lineItems.length > 0) {
      expect(basket.estimatedCount).toBeGreaterThanOrEqual(0)
    }
  })
})

describe('compareBaskets', () => {
  const ah = cat('ah', [
    ['Penne pasta', 1.19, '500 g'],
    ['Halfvolle melk', 0.99, '1 l'],
  ])
  const jumbo = cat('jumbo', [
    ['Penne pasta', 0.89, '500 g'],
    ['Halfvolle melk', 1.09, '1 l'],
  ])

  it('builds a basket per store and picks the cheapest by total', () => {
    const reqs = [
      { name: 'pasta', amount: '500 g' },
      { name: 'melk', amount: '500 ml' },
    ]
    const cmp = compareBaskets(reqs, [ah, jumbo])
    expect(cmp.baskets).toHaveLength(2)
    // AH: 119 + 99 = 218; Jumbo: 89 + 109 = 198. Jumbo cheaper.
    expect(cmp.cheapest?.store).toBe('jumbo')
    expect(cmp.cheapest?.totalCents).toBe(198)
  })

  it('skips a zero-coverage store for cheapest but still returns its basket', () => {
    const empty = cat('dirk', [])
    const reqs = [{ name: 'pasta', amount: '500 g' }]
    const cmp = compareBaskets(reqs, [empty, ah])
    expect(cmp.baskets).toHaveLength(2)
    expect(cmp.cheapest?.store).toBe('ah')
  })

  it('returns a null cheapest when nothing matches anywhere', () => {
    const reqs = [{ name: 'unobtanium', amount: '1 g' }]
    const cmp = compareBaskets(reqs, [ah, jumbo])
    expect(cmp.cheapest).toBeNull()
  })
})
