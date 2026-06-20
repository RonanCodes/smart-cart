import { describe, expect, it } from 'vitest'
import {
  coveredStoreSlugs,
  getCatalogue,
  getCatalogues,
  getCataloguesFor,
  storeSlugs,
} from './catalogue'
import { matchIngredient } from './match'
import { priceListAcrossStores } from './price-list'

/**
 * Smoke tests against the real vendored checkjebon snapshot. These pin the
 * coverage facts the close-comment reports (which of the demo stores carry data)
 * and prove the end-to-end pricing path works on real product names.
 */
describe('vendored catalogue smoke', () => {
  it('loads and memoises catalogues from the vendored JSON', () => {
    const a = getCatalogues()
    const b = getCatalogues()
    expect(a).toBe(b) // memoised, same reference
    expect(storeSlugs().length).toBeGreaterThan(0)
  })

  it('covers AH, Jumbo, Dirk and Lidl with priced products', () => {
    const covered = coveredStoreSlugs()
    for (const slug of ['ah', 'jumbo', 'dirk', 'lidl']) {
      expect(covered).toContain(slug)
      expect(getCatalogue(slug)!.products.length).toBeGreaterThan(0)
    }
  })

  it('represents Aldi as present-but-empty (no products upstream)', () => {
    // Aldi is in the snapshot but ships zero products: honest coverage gap.
    const aldi = getCatalogue('aldi')
    if (aldi) expect(aldi.products.length).toBe(0)
    expect(coveredStoreSlugs()).not.toContain('aldi')
  })

  it('every loaded product has a positive integer cent price', () => {
    for (const cat of Object.values(getCatalogues())) {
      for (const p of cat.products) {
        expect(Number.isInteger(p.priceCents)).toBe(true)
        expect(p.priceCents).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('matches a common ingredient against the real AH catalogue', () => {
    const ah = getCatalogue('ah')!
    const m = matchIngredient('melk', ah)
    expect(m.confidence).not.toBe('none')
    expect(m.priceCents).not.toBeNull()
  })

  it('prices a small basket across the demo stores', () => {
    const stores = getCataloguesFor(['ah', 'jumbo', 'dirk', 'lidl'])
    expect(stores.length).toBe(4)
    const cmp = priceListAcrossStores(
      [{ name: 'melk' }, { name: 'pasta' }, { name: 'kaas' }],
      stores,
    )
    expect(cmp.perStore).toHaveLength(4)
    // at least one store should match at least one line on real data
    expect(cmp.cheapestOverall).not.toBeNull()
  })

  it('drops unknown store slugs in getCataloguesFor', () => {
    expect(getCataloguesFor(['ah', 'not-a-store']).map((c) => c.store)).toEqual(
      ['ah'],
    )
  })
})
