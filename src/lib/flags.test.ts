import { describe, it, expect } from 'vitest'
import {
  FLAG_DEFAULTS,
  FLAG_KEYS,
  FLAG_META,
  ORDERING_FLAG_KEYS,
  isFlagKey,
  mergeFlags,
  storeOrderable,
  storeVisible,
} from './flags'

/**
 * The pure flag layer. The VALUES come from D1 at runtime, but the defaults,
 * merge, and predicates are the load-bearing logic and are proven here without a
 * DB. The defaults double as the safe fallback whenever D1 is empty / unreachable
 * (mergeFlags(null)), so this is also the contract for "what's on when nothing is
 * configured".
 */

describe('FLAG_DEFAULTS (the safe fallback)', () => {
  it('is conservative: AH on, Jumbo off, Picnic visible-not-orderable, tipping on', () => {
    expect(FLAG_DEFAULTS['store.ah.visible']).toBe(true)
    expect(FLAG_DEFAULTS['store.ah.ordering']).toBe(true)
    expect(FLAG_DEFAULTS['store.jumbo.visible']).toBe(false)
    expect(FLAG_DEFAULTS['store.jumbo.ordering']).toBe(false)
    expect(FLAG_DEFAULTS['store.picnic.visible']).toBe(true)
    expect(FLAG_DEFAULTS['store.picnic.ordering']).toBe(false)
    expect(FLAG_DEFAULTS.tipping).toBe(true)
  })

  it('every key has a meta entry, and every meta key is a real flag', () => {
    expect(FLAG_META.map((m) => m.key).sort()).toEqual([...FLAG_KEYS].sort())
  })

  it('ORDERING_FLAG_KEYS is exactly the per-store ordering flags', () => {
    expect([...ORDERING_FLAG_KEYS].sort()).toEqual([
      'store.ah.ordering',
      'store.jumbo.ordering',
      'store.picnic.ordering',
    ])
  })
})

describe('isFlagKey', () => {
  it('accepts known keys and rejects junk', () => {
    expect(isFlagKey('tipping')).toBe(true)
    expect(isFlagKey('store.jumbo.visible')).toBe(true)
    expect(isFlagKey('store.lidl.visible')).toBe(false)
    expect(isFlagKey('')).toBe(false)
  })
})

describe('mergeFlags', () => {
  it('returns the full defaults for null / empty input', () => {
    expect(mergeFlags(null)).toEqual(FLAG_DEFAULTS)
    expect(mergeFlags(undefined)).toEqual(FLAG_DEFAULTS)
    expect(mergeFlags({})).toEqual(FLAG_DEFAULTS)
  })

  it('overlays only the provided boolean keys', () => {
    const merged = mergeFlags({ 'store.jumbo.visible': true })
    expect(merged['store.jumbo.visible']).toBe(true)
    // Everything else stays at the default.
    expect(merged['store.jumbo.ordering']).toBe(false)
    expect(merged.tipping).toBe(true)
  })

  it('ignores unknown keys and non-boolean values (junk never flips a flag)', () => {
    const merged = mergeFlags({
      'store.lidl.visible': true,
      tipping: 'yes',
      'store.ah.visible': 0,
    })
    expect(merged).toEqual(FLAG_DEFAULTS)
    expect('store.lidl.visible' in merged).toBe(false)
  })
})

describe('storeVisible / storeOrderable', () => {
  it('read the matching per-store flag', () => {
    const flags = mergeFlags({
      'store.jumbo.visible': true,
      'store.jumbo.ordering': true,
    })
    expect(storeVisible(flags, 'jumbo')).toBe(true)
    expect(storeOrderable(flags, 'jumbo')).toBe(true)
    // Picnic default: visible but not orderable.
    expect(storeVisible(flags, 'picnic')).toBe(true)
    expect(storeOrderable(flags, 'picnic')).toBe(false)
  })
})
