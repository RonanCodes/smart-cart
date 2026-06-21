import { describe, it, expect, vi } from 'vitest'
import {
  asDataMode,
  requireDataMode,
  householdWriteOp,
  GLOBAL_SCOPE,
} from './data-mode'
import { resolveDataMode } from './data-mode-resolve'

/**
 * A tiny fake of the drizzle read chain resolveDataMode uses:
 *   db.select(...).from(dataMode).where(inArray(scope, [hh, 'global']))
 * The terminal `.where(...)` is awaited and resolves to the row array, so we stub
 * exactly that surface (matching how payment-mode.test stubs the DB).
 */
function fakeDb(rows: Array<{ scope: string; mode: string }>) {
  const where = vi.fn().mockResolvedValue(rows)
  const from = vi.fn().mockReturnValue({ where })
  const select = vi.fn().mockReturnValue({ from })
  return { select } as unknown as Parameters<typeof resolveDataMode>[0]
}

describe('asDataMode / requireDataMode (strict validation)', () => {
  it('accepts only the two valid modes', () => {
    expect(asDataMode('real')).toBe('real')
    expect(asDataMode('demo')).toBe('demo')
  })

  it('rejects anything else as null', () => {
    expect(asDataMode('REAL')).toBeNull()
    expect(asDataMode('prod')).toBeNull()
    expect(asDataMode('')).toBeNull()
    expect(asDataMode(undefined)).toBeNull()
    expect(asDataMode(null)).toBeNull()
    expect(asDataMode(1)).toBeNull()
  })

  it('requireDataMode throws on a bad value', () => {
    expect(() => requireDataMode('nope')).toThrow(/Invalid data mode/)
    expect(() => requireDataMode('DEMO')).toThrow()
    expect(requireDataMode('demo')).toBe('demo')
  })
})

describe('householdWriteOp (null clears the override, a mode upserts it)', () => {
  it('null mode = inherit -> delete the override row', () => {
    expect(householdWriteOp(null)).toEqual({ op: 'delete' })
  })

  it('a valid mode -> upsert that mode', () => {
    expect(householdWriteOp('real')).toEqual({ op: 'upsert', mode: 'real' })
    expect(householdWriteOp('demo')).toEqual({ op: 'upsert', mode: 'demo' })
  })
})

describe('resolveDataMode (precedence: override > global > default real)', () => {
  it('uses the household override when present, ignoring the global', async () => {
    const db = fakeDb([
      { scope: GLOBAL_SCOPE, mode: 'real' },
      { scope: 'hh-1', mode: 'demo' },
    ])
    expect(await resolveDataMode(db, 'hh-1')).toBe('demo')
  })

  it('falls back to the global default when there is no override', async () => {
    const db = fakeDb([{ scope: GLOBAL_SCOPE, mode: 'demo' }])
    expect(await resolveDataMode(db, 'hh-1')).toBe('demo')
  })

  it("defaults to 'real' when neither row exists", async () => {
    const db = fakeDb([])
    expect(await resolveDataMode(db, 'hh-1')).toBe('real')
  })

  it("falls through a bad override value to the global, then to 'real'", async () => {
    // A legacy/garbage override must never flip the app to demo by mistake; it
    // falls to the global, and a garbage global falls to the safe 'real' default.
    const db = fakeDb([
      { scope: GLOBAL_SCOPE, mode: 'demo' },
      { scope: 'hh-1', mode: 'bogus' },
    ])
    expect(await resolveDataMode(db, 'hh-1')).toBe('demo')

    const db2 = fakeDb([
      { scope: GLOBAL_SCOPE, mode: 'bogus' },
      { scope: 'hh-1', mode: 'also-bad' },
    ])
    expect(await resolveDataMode(db2, 'hh-1')).toBe('real')
  })
})
