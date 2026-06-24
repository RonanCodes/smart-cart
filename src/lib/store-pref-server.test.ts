import { describe, it, expect } from 'vitest'
import {
  normalizeStore,
  storeLabel,
  STORE_OPTIONS,
  effectiveStore,
} from './store-pref-server'
import { mergeFlags } from './flags'

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

  it('gives Picnic a self-hosted brand logo', () => {
    const picnic = STORE_OPTIONS.find((o) => o.name === 'Picnic')
    expect(picnic?.iconSrc).toBe('/brand/stores/picnic.png')
  })
})

describe('effectiveStore (the cart/pricing gate)', () => {
  it('passes a visible store through untouched', () => {
    const flags = mergeFlags(null) // defaults: ah + picnic visible, jumbo hidden
    expect(effectiveStore('ah', flags)).toBe('ah')
    expect(effectiveStore('picnic', flags)).toBe('picnic')
  })

  it('coerces a hidden store to the first visible one', () => {
    // Jumbo hidden by default -> falls back to the first visible store (ah).
    const flags = mergeFlags(null)
    expect(effectiveStore('jumbo', flags)).toBe('ah')
  })

  it('passes a store through once its visible flag is turned on', () => {
    const flags = mergeFlags({ 'store.jumbo.visible': true })
    expect(effectiveStore('jumbo', flags)).toBe('jumbo')
  })

  it('falls back past a hidden ah to the next visible store', () => {
    const flags = mergeFlags({
      'store.ah.visible': false,
      'store.jumbo.visible': false,
      'store.picnic.visible': true,
    })
    expect(effectiveStore('jumbo', flags)).toBe('picnic')
  })
})
