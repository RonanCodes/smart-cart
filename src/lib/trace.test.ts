import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  newTraceId,
  isTraceId,
  getClientTraceId,
  TRACE_STORAGE_KEY,
} from './trace'

describe('newTraceId', () => {
  it('produces a 32-char lowercase hex id (UUID without dashes)', () => {
    const id = newTraceId()
    expect(id).toMatch(/^[0-9a-f]{32}$/)
  })

  it('produces a fresh id each call', () => {
    expect(newTraceId()).not.toBe(newTraceId())
  })

  it('falls back to a valid id when crypto.randomUUID is unavailable', () => {
    const orig = globalThis.crypto
    // Simulate an environment without randomUUID (older Workers / Safari).
    vi.stubGlobal('crypto', {})
    try {
      const id = newTraceId()
      expect(isTraceId(id)).toBe(true)
    } finally {
      vi.stubGlobal('crypto', orig)
    }
  })
})

describe('isTraceId', () => {
  it('accepts a 32-char hex string', () => {
    expect(isTraceId('a'.repeat(32))).toBe(true)
    expect(isTraceId(newTraceId())).toBe(true)
  })

  it('rejects the wrong shape', () => {
    expect(isTraceId('')).toBe(false)
    expect(isTraceId('xyz')).toBe(false)
    expect(isTraceId('a'.repeat(31))).toBe(false)
    expect(isTraceId('a'.repeat(33))).toBe(false)
    expect(isTraceId('G'.repeat(32))).toBe(false) // not hex
    expect(isTraceId(undefined)).toBe(false)
    expect(isTraceId(null)).toBe(false)
    expect(isTraceId(123)).toBe(false)
  })
})

describe('getClientTraceId', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
  })

  it('generates one id and reuses it across calls (session-scoped)', () => {
    const first = getClientTraceId()
    const second = getClientTraceId()
    expect(first).toBe(second)
    expect(isTraceId(first)).toBe(true)
  })

  it('persists the id in sessionStorage under the shared key', () => {
    const id = getClientTraceId()
    expect(window.sessionStorage.getItem(TRACE_STORAGE_KEY)).toBe(id)
  })

  it('restores a previously stored id', () => {
    const stored = newTraceId()
    window.sessionStorage.setItem(TRACE_STORAGE_KEY, stored)
    expect(getClientTraceId()).toBe(stored)
  })

  it('replaces a malformed stored value with a fresh valid one', () => {
    window.sessionStorage.setItem(TRACE_STORAGE_KEY, 'not-a-trace')
    const id = getClientTraceId()
    expect(isTraceId(id)).toBe(true)
    expect(id).not.toBe('not-a-trace')
  })

  it('never throws when sessionStorage is unavailable (returns a valid id)', () => {
    const getItem = vi
      .spyOn(Storage.prototype, 'getItem')
      .mockImplementation(() => {
        throw new Error('blocked')
      })
    const setItem = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('blocked')
      })
    try {
      const id = getClientTraceId()
      expect(isTraceId(id)).toBe(true)
    } finally {
      getItem.mockRestore()
      setItem.mockRestore()
    }
  })
})
