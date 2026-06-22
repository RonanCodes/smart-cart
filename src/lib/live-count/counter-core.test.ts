import { describe, it, expect } from 'vitest'
import {
  toCount,
  nextCount,
  countMessage,
  serializeCount,
  parseUpdate,
} from './counter-core'

describe('toCount', () => {
  it('passes through non-negative integers', () => {
    expect(toCount(0)).toBe(0)
    expect(toCount(42)).toBe(42)
  })
  it('floors fractional values', () => {
    expect(toCount(3.9)).toBe(3)
  })
  it('coerces numeric strings', () => {
    expect(toCount('17')).toBe(17)
  })
  it('rejects negatives, NaN, and junk as null', () => {
    expect(toCount(-1)).toBeNull()
    expect(toCount(NaN)).toBeNull()
    expect(toCount('abc')).toBeNull()
    expect(toCount(undefined)).toBeNull()
    expect(toCount(Infinity)).toBeNull()
  })
})

describe('nextCount (monotonic absolute count)', () => {
  it('takes the larger of current and incoming count', () => {
    expect(nextCount(10, { count: 12 })).toBe(12)
    expect(nextCount(10, { count: 5 })).toBe(10) // never decreases
  })
  it('seeds from 0', () => {
    expect(nextCount(0, { count: 100 })).toBe(100)
  })
  it('ignores a garbage absolute count, keeping current', () => {
    expect(nextCount(10, { count: -3 })).toBe(10)
    expect(nextCount(10, { count: 'nope' })).toBe(10)
  })
  it('treats a non-finite current as 0', () => {
    expect(nextCount(NaN, { count: 7 })).toBe(7)
  })
})

describe('nextCount (delta)', () => {
  it('adds a positive delta', () => {
    expect(nextCount(10, { delta: 1 })).toBe(11)
  })
  it('clamps a negative delta at 0', () => {
    expect(nextCount(2, { delta: -5 })).toBe(0)
  })
  it('ignores a non-finite delta', () => {
    expect(nextCount(10, { delta: 'x' })).toBe(10)
  })
  it('prefers absolute count over delta when both present', () => {
    expect(nextCount(10, { count: 20, delta: 100 })).toBe(20)
  })
})

describe('countMessage / serializeCount', () => {
  it('shapes the payload', () => {
    expect(countMessage(5)).toEqual({ count: 5 })
  })
  it('clamps a bad count to 0 in the payload', () => {
    expect(countMessage(-1)).toEqual({ count: 0 })
  })
  it('serializes to the exact wire string', () => {
    expect(serializeCount(8)).toBe('{"count":8}')
  })
})

describe('parseUpdate', () => {
  it('parses a count update', () => {
    expect(parseUpdate('{"count":3}')).toEqual({ count: 3 })
  })
  it('parses a delta update', () => {
    expect(parseUpdate('{"delta":1}')).toEqual({ delta: 1 })
  })
  it('returns null for empty / invalid JSON', () => {
    expect(parseUpdate('')).toBeNull()
    expect(parseUpdate(null)).toBeNull()
    expect(parseUpdate('not json')).toBeNull()
  })
  it('returns null for an object with neither count nor delta', () => {
    expect(parseUpdate('{"foo":1}')).toBeNull()
  })
  it('returns null for a JSON primitive', () => {
    expect(parseUpdate('42')).toBeNull()
  })
})
