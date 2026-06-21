import { describe, it, expect } from 'vitest'
import {
  isValidDow,
  isValidTime,
  validateNotifyPrefs,
  DEFAULT_NOTIFY_PREFS,
} from './notify-prefs'

describe('isValidDow', () => {
  it('accepts 0..6', () => {
    for (let d = 0; d <= 6; d++) expect(isValidDow(d)).toBe(true)
  })
  it('rejects out of range + non-integers', () => {
    expect(isValidDow(-1)).toBe(false)
    expect(isValidDow(7)).toBe(false)
    expect(isValidDow(1.5)).toBe(false)
    expect(isValidDow('3')).toBe(false)
    expect(isValidDow(undefined)).toBe(false)
  })
})

describe('isValidTime', () => {
  it('accepts HH:MM 24h', () => {
    expect(isValidTime('00:00')).toBe(true)
    expect(isValidTime('17:00')).toBe(true)
    expect(isValidTime('23:59')).toBe(true)
    expect(isValidTime('08:30')).toBe(true)
  })
  it('rejects malformed / out of range', () => {
    expect(isValidTime('24:00')).toBe(false)
    expect(isValidTime('17:60')).toBe(false)
    expect(isValidTime('7:00')).toBe(false)
    expect(isValidTime('17:0')).toBe(false)
    expect(isValidTime('1700')).toBe(false)
    expect(isValidTime('')).toBe(false)
    expect(isValidTime(17)).toBe(false)
  })
})

describe('validateNotifyPrefs', () => {
  it('passes a well-formed pref through', () => {
    expect(
      validateNotifyPrefs({ enabled: true, dow: 3, time: '18:30' }),
    ).toEqual({ enabled: true, dow: 3, time: '18:30' })
  })
  it('throws on a bad dow', () => {
    expect(() =>
      validateNotifyPrefs({ enabled: true, dow: 9, time: '18:30' }),
    ).toThrow(/dow/)
  })
  it('throws on a bad time', () => {
    expect(() =>
      validateNotifyPrefs({ enabled: true, dow: 3, time: '99:99' }),
    ).toThrow(/time/)
  })
  it('throws on a non-boolean enabled', () => {
    expect(() =>
      validateNotifyPrefs({ enabled: 'yes', dow: 3, time: '18:30' }),
    ).toThrow(/enabled/)
  })
})

describe('DEFAULT_NOTIFY_PREFS', () => {
  it('is off, Sunday, 17:00', () => {
    expect(DEFAULT_NOTIFY_PREFS).toEqual({
      enabled: false,
      dow: 0,
      time: '17:00',
    })
  })
})
