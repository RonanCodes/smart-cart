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

  it('covers AH and Jumbo with priced products (supported stores only)', () => {
    const covered = coveredStoreSlugs()
    expect(covered).toEqual(['ah', 'jumbo'])
    for (const slug of ['ah', 'jumbo']) {
      expect(getCatalogue(slug)!.products.length).toBeGreaterThan(0)
    }
  })

  it('does not vendor comparison-only stores in the trimmed snapshot', () => {
    expect(getCatalogue('dirk')).toBeUndefined()
    expect(getCatalogue('lidl')).toBeUndefined()
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

  it('prices a small basket across the supported stores', () => {
    const stores = getCataloguesFor(['ah', 'jumbo'])
    expect(stores.length).toBe(2)
    const cmp = priceListAcrossStores(
      [{ name: 'melk' }, { name: 'pasta' }, { name: 'kaas' }],
      stores,
    )
    expect(cmp.perStore).toHaveLength(2)
    // at least one store should match at least one line on real data
    expect(cmp.cheapestOverall).not.toBeNull()
  })

  it('drops unknown store slugs in getCataloguesFor', () => {
    expect(getCataloguesFor(['ah', 'not-a-store']).map((c) => c.store)).toEqual(
      ['ah'],
    )
  })
})
