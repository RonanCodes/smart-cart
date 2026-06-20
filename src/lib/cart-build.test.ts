import { describe, it, expect } from 'vitest'
import { buildAllItemsCartUrl } from './cart-build'

describe('buildAllItemsCartUrl', () => {
  it('builds an AH link from resolved slugs across week + extras', () => {
    const res = buildAllItemsCartUrl('ah', [
      { slug: 'wi415202/100-coconut-grove' }, // a week line
      { slug: 'wi2798' }, // a staple
    ])
    expect(res.store).toBe('ah')
    expect(res.matched).toBe(2)
    expect(res.total).toBe(2)
    expect(res.url).toBe(
      'https://www.ah.nl/mijnlijst/add-multiple?p=415202:1&p=2798:1',
    )
  })

  it('builds a Jumbo link from trailing-token slugs', () => {
    const res = buildAllItemsCartUrl('jumbo', [
      { slug: '11er-spek-rosti-350-g-128692ZK' },
      { slug: '1fruit-appel-200ml-764448PAK' },
    ])
    expect(res.matched).toBe(2)
    const add = new URL(res.url!).searchParams.get('add')!
    expect(JSON.parse(add)).toEqual([
      { sku: '128692ZK', quantity: 1 },
      { sku: '764448PAK', quantity: 1 },
    ])
  })

  it('skips unmatched (null) slugs but still counts them in the total', () => {
    const res = buildAllItemsCartUrl('ah', [
      { slug: 'wi415202/x' },
      { slug: null },
      { slug: null },
    ])
    expect(res.matched).toBe(1)
    expect(res.total).toBe(3)
    expect(res.url).toBe('https://www.ah.nl/mijnlijst/add-multiple?p=415202:1')
  })

  it('returns a null url when nothing resolved', () => {
    const res = buildAllItemsCartUrl('jumbo', [{ slug: null }, { slug: null }])
    expect(res.url).toBeNull()
    expect(res.matched).toBe(0)
    expect(res.total).toBe(2)
  })

  it('only ever resolves the SELECTED store (decoupling)', () => {
    // The same slugs, sent to each store, produce store-specific URLs and never
    // a cross-store leak: an AH build is an ah.nl URL, a Jumbo build a jumbo.com
    // URL. Picking one store can never fire the other.
    const slugs = [{ slug: 'wi415202/x' }]
    expect(buildAllItemsCartUrl('ah', slugs).url).toContain('ah.nl')
    expect(buildAllItemsCartUrl('jumbo', slugs).url).toContain('jumbo.com')
  })
})
