import { describe, it, expect } from 'vitest'
import { normalizeStore, storeLabel, STORE_OPTIONS } from './store-pref-server'

/**
 * The setStore server fn is thin D1 glue around `normalizeStore` (the slug
 * guard). That guard is the load-bearing logic and is proven here without a
 * DB. It's the same gate setStore's inputValidator runs before any write, so a
 * Picnic / junk value can never reach the household row.
 */

describe('normalizeStore (the write guard)', () => {
  it('accepts the two real stores', () => {
    expect(normalizeStore('ah')).toBe('ah')
    expect(normalizeStore('jumbo')).toBe('jumbo')
  })

  it('lowercases + trims before matching', () => {
    expect(normalizeStore('  AH ')).toBe('ah')
    expect(normalizeStore('Jumbo')).toBe('jumbo')
  })

  it('rejects Picnic (the coming-soon joke never persists)', () => {
    expect(normalizeStore('picnic')).toBeNull()
  })

  it('rejects unknown / empty / non-string input', () => {
    expect(normalizeStore('lidl')).toBeNull()
    expect(normalizeStore('')).toBeNull()
    expect(normalizeStore(null)).toBeNull()
    expect(normalizeStore(undefined)).toBeNull()
    expect(normalizeStore(42)).toBeNull()
  })
})

describe('storeLabel', () => {
  it('maps each real slug to its display name', () => {
    expect(storeLabel('ah')).toBe('Albert Heijn')
    expect(storeLabel('jumbo')).toBe('Jumbo')
  })
})

describe('STORE_OPTIONS', () => {
  it('offers exactly Albert Heijn, Jumbo, and a coming-soon Picnic', () => {
    expect(STORE_OPTIONS.map((o) => o.name)).toEqual([
      'Albert Heijn',
      'Jumbo',
      'Picnic',
    ])
    const picnic = STORE_OPTIONS.find((o) => o.name === 'Picnic')
    expect(picnic?.comingSoon).toBe(true)
    expect(picnic?.slug).toBeNull()
  })
})
