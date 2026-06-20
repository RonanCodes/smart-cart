import { describe, expect, it } from 'vitest'
import { buildCatalogues } from './normalise'
import {
  formatCents,
  priceListAcrossStores,
  priceListForStore,
} from './price-list'
import type { RawStore, StoreCatalogue } from './types'

function cat(slug: string, products: Array<[string, number]>): StoreCatalogue {
  const raw: Array<RawStore> = [
    { n: slug, c: slug.toUpperCase(), d: products.map(([n, p]) => ({ n, p })) },
  ]
  return buildCatalogues(raw)[slug]!
}

describe('priceListForStore', () => {
  it('totals matched lines and counts matched / missing', () => {
    const ah = cat('ah', [
      ['Penne pasta', 1.19],
      ['Halfvolle melk', 0.99],
    ])
    const list = priceListForStore(
      [{ name: 'pasta' }, { name: 'melk' }, { name: 'saffron' }],
      ah,
    )
    expect(list.matchedCount).toBe(2)
    expect(list.missingCount).toBe(1)
    expect(list.totalCents).toBe(119 + 99)
    expect(list.lines).toHaveLength(3)
  })

  it('a missing line contributes nothing to the total but flags a soft total', () => {
    const ah = cat('ah', [['Penne pasta', 1.19]])
    const list = priceListForStore([{ name: 'pasta' }, { name: 'octopus' }], ah)
    expect(list.totalCents).toBe(119)
    expect(list.missingCount).toBe(1)
    expect(list.hasSoftTotal).toBe(true)
  })

  it('a fully-confident basket has no soft total', () => {
    const ah = cat('ah', [
      ['pasta', 1.19],
      ['melk', 0.99],
    ])
    const list = priceListForStore([{ name: 'pasta' }, { name: 'melk' }], ah)
    expect(list.estimatedCount).toBe(0)
    expect(list.missingCount).toBe(0)
    expect(list.hasSoftTotal).toBe(false)
  })
})

describe('priceListAcrossStores', () => {
  const stores = [
    cat('ah', [
      ['pasta', 1.19],
      ['melk', 1.09],
    ]),
    cat('jumbo', [
      ['pasta', 0.99],
      ['melk', 0.95],
    ]),
    cat('dirk', [['pasta', 0.89]]), // missing melk -> soft
  ]

  it('prices every store and picks the cheapest confident basket', () => {
    const cmp = priceListAcrossStores(
      [{ name: 'pasta' }, { name: 'melk' }],
      stores,
    )
    expect(cmp.perStore).toHaveLength(3)
    // jumbo is cheapest AND confident (99 + 95)
    expect(cmp.cheapestConfident?.store).toBe('jumbo')
    expect(cmp.cheapestConfident?.totalCents).toBe(99 + 95)
  })

  it('cheapestConfident excludes a store with a missing line even if its partial total is lower', () => {
    const cmp = priceListAcrossStores(
      [{ name: 'pasta' }, { name: 'melk' }],
      stores,
    )
    // dirk's partial total (89) is the lowest raw total
    expect(cmp.cheapestOverall?.store).toBe('dirk')
    // but it is NOT the confident pick
    expect(cmp.cheapestConfident?.store).not.toBe('dirk')
  })

  it('cheapestConfident is null when every store has a soft line', () => {
    const onlyPartial = [
      cat('ah', [['pasta', 1.19]]),
      cat('jumbo', [['pasta', 0.99]]),
    ]
    const cmp = priceListAcrossStores(
      [{ name: 'pasta' }, { name: 'melk' }],
      onlyPartial,
    )
    expect(cmp.cheapestConfident).toBeNull()
    expect(cmp.cheapestOverall?.store).toBe('jumbo')
  })

  it('handles an all-miss list with null cheapest picks', () => {
    const cmp = priceListAcrossStores([{ name: 'octopus' }], stores)
    expect(cmp.cheapestConfident).toBeNull()
    expect(cmp.cheapestOverall).toBeNull()
  })
})

describe('formatCents', () => {
  it('formats integer cents as a euro string', () => {
    expect(formatCents(1234)).toBe('€12.34')
    expect(formatCents(99)).toBe('€0.99')
    expect(formatCents(0)).toBe('€0.00')
  })
})
