import { describe, it, expect } from 'vitest'
import {
  normalizeLocale,
  localeLabel,
  LOCALE_OPTIONS,
} from './locale-pref-server'

/**
 * The setLocale server fn is thin D1 glue around `normalizeLocale` (the slug
 * guard). That guard is the load-bearing logic and is proven here without a DB.
 * It's the same gate setLocale's inputValidator runs before any write, so a junk
 * value can never reach the household row.
 */

describe('normalizeLocale (the write guard)', () => {
  it('accepts the two selectable locales', () => {
    expect(normalizeLocale('en')).toBe('en')
    expect(normalizeLocale('nl')).toBe('nl')
  })

  it('lowercases + trims before matching', () => {
    expect(normalizeLocale('  EN ')).toBe('en')
    expect(normalizeLocale('NL')).toBe('nl')
  })

  it('rejects unknown / empty / non-string input', () => {
    expect(normalizeLocale('de')).toBeNull()
    expect(normalizeLocale('english')).toBeNull()
    expect(normalizeLocale('')).toBeNull()
    expect(normalizeLocale(null)).toBeNull()
    expect(normalizeLocale(undefined)).toBeNull()
    expect(normalizeLocale(42)).toBeNull()
  })
})

describe('localeLabel', () => {
  it('maps each slug to its display name', () => {
    expect(localeLabel('en')).toBe('English')
    expect(localeLabel('nl')).toBe('Nederlands')
  })
})

describe('LOCALE_OPTIONS', () => {
  it('offers exactly English then Dutch, English first (the default)', () => {
    expect(LOCALE_OPTIONS.map((o) => o.slug)).toEqual(['en', 'nl'])
    expect(LOCALE_OPTIONS.map((o) => o.short)).toEqual(['EN', 'NL'])
  })
})
