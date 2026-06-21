import { describe, it, expect } from 'vitest'
import { productUrl } from './product-url'

describe('productUrl', () => {
  it('builds an AH product page URL from a checkjebon AH slug', () => {
    expect(productUrl('ah', 'wi415202/100-coconut-grove')).toBe(
      'https://www.ah.nl/producten/product/wi415202/100-coconut-grove',
    )
  })

  it('builds a Jumbo product page URL from a checkjebon Jumbo slug', () => {
    expect(productUrl('jumbo', '11er-spek-rosti-350-g-128692ZK')).toBe(
      'https://www.jumbo.com/producten/11er-spek-rosti-350-g-128692ZK',
    )
  })

  it('is case-insensitive on the store slug', () => {
    expect(productUrl('AH', 'wi1/x')).toBe(
      'https://www.ah.nl/producten/product/wi1/x',
    )
    expect(productUrl('Jumbo', 'foo-1')).toBe(
      'https://www.jumbo.com/producten/foo-1',
    )
  })

  it('strips an accidental leading slash so the base does not double up', () => {
    expect(productUrl('ah', '/wi1/x')).toBe(
      'https://www.ah.nl/producten/product/wi1/x',
    )
  })

  it('trims surrounding whitespace on the slug', () => {
    expect(productUrl('jumbo', '  foo-1  ')).toBe(
      'https://www.jumbo.com/producten/foo-1',
    )
  })

  it('returns null for an unknown store (no broken link)', () => {
    expect(productUrl('picnic', 'whatever')).toBeNull()
    expect(productUrl('dirk', 'whatever')).toBeNull()
  })

  it('returns null when the slug is missing or empty', () => {
    expect(productUrl('ah', null)).toBeNull()
    expect(productUrl('ah', undefined)).toBeNull()
    expect(productUrl('ah', '')).toBeNull()
    expect(productUrl('ah', '   ')).toBeNull()
  })

  it('returns null when the store is missing', () => {
    expect(productUrl(null, 'wi1/x')).toBeNull()
    expect(productUrl(undefined, 'wi1/x')).toBeNull()
  })
})
