import { describe, it, expect } from 'vitest'
import {
  normalizeStore,
  storeLabel,
  STORE_OPTIONS,
  effectiveStore,
  isStoreSelectable,
} from './store-pref-server'

/**
 * The setStore server fn is thin D1 glue around `normalizeStore` (the slug
 * guard). That guard is the load-bearing logic and is proven here without a
 * DB. It's the same gate setStore's inputValidator runs before any write, so a
 * junk value can never reach the household row.
 */

describe('normalizeStore (the write guard)', () => {
  it('accepts the three selectable stores', () => {
    expect(normalizeStore('ah')).toBe('ah')
    expect(normalizeStore('jumbo')).toBe('jumbo')
    expect(normalizeStore('picnic')).toBe('picnic')
  })

  it('lowercases + trims before matching', () => {
    expect(normalizeStore('  AH ')).toBe('ah')
    expect(normalizeStore('Jumbo')).toBe('jumbo')
    expect(normalizeStore(' Picnic ')).toBe('picnic')
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
  it('maps each slug to its display name', () => {
    expect(storeLabel('ah')).toBe('Albert Heijn')
    expect(storeLabel('jumbo')).toBe('Jumbo')
    expect(storeLabel('picnic')).toBe('Picnic')
  })
})

describe('STORE_OPTIONS', () => {
  it('offers exactly Albert Heijn, Jumbo, and Picnic', () => {
    expect(STORE_OPTIONS.map((o) => o.name)).toEqual([
      'Albert Heijn',
      'Jumbo',
      'Picnic',
    ])
    expect(STORE_OPTIONS.map((o) => o.slug)).toEqual(['ah', 'jumbo', 'picnic'])
  })

  it('marks Jumbo as a parked "Coming soon" option, the others not', () => {
    const byName = (name: string) => STORE_OPTIONS.find((o) => o.name === name)
    expect(byName('Jumbo')?.comingSoon).toBe(true)
    expect(byName('Albert Heijn')?.comingSoon).toBeFalsy()
    expect(byName('Picnic')?.comingSoon).toBeFalsy()
  })

  it('gives Picnic a self-hosted brand logo', () => {
    const picnic = STORE_OPTIONS.find((o) => o.name === 'Picnic')
    expect(picnic?.iconSrc).toBe('/brand/stores/picnic.png')
  })
})

describe('isStoreSelectable', () => {
  it('treats Albert Heijn + Picnic as selectable, Jumbo as not', () => {
    expect(isStoreSelectable('ah')).toBe(true)
    expect(isStoreSelectable('picnic')).toBe(true)
    expect(isStoreSelectable('jumbo')).toBe(false)
  })
})

describe('effectiveStore (the cart/pricing gate)', () => {
  it('coerces a parked "Coming soon" store down to the default', () => {
    // A saved 'jumbo' must still produce a working cart, on AH.
    expect(effectiveStore('jumbo')).toBe('ah')
  })

  it('passes selectable stores through untouched', () => {
    expect(effectiveStore('ah')).toBe('ah')
    expect(effectiveStore('picnic')).toBe('picnic')
  })
})
