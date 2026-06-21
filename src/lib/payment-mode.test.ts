import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  asPaymentMode,
  requirePaymentMode,
  householdWriteOp,
  GLOBAL_SCOPE,
} from './payment-mode'
import { resolvePaymentMode, mollieKeyForMode } from './payment-mode-resolve'

// readEnv is the single env reader mollieKeyForMode uses; mock it per-test so we
// can assert which key each mode picks and that an unset key throws.
const readEnv = vi.fn<(key: string) => Promise<string | undefined>>()
vi.mock('./env', () => ({ readEnv: (k: string) => readEnv(k) }))

/**
 * A tiny fake of the drizzle read chain resolvePaymentMode uses:
 *   db.select(...).from(paymentMode).where(inArray(scope, [hh, 'global']))
 * The terminal `.where(...)` is awaited and resolves to the row array, so we
 * stub exactly that surface (matching how tip-server.test stubs the DB).
 */
function fakeDb(rows: Array<{ scope: string; mode: string }>) {
  const where = vi.fn().mockResolvedValue(rows)
  const from = vi.fn().mockReturnValue({ where })
  const select = vi.fn().mockReturnValue({ from })
  // Cast through unknown: we only exercise the select read path here.
  return { select } as unknown as Parameters<typeof resolvePaymentMode>[0]
}

beforeEach(() => {
  readEnv.mockReset()
})

describe('asPaymentMode / requirePaymentMode (strict validation)', () => {
  it('accepts only the two valid modes', () => {
    expect(asPaymentMode('test')).toBe('test')
    expect(asPaymentMode('live')).toBe('live')
  })

  it('rejects anything else as null', () => {
    expect(asPaymentMode('TEST')).toBeNull()
    expect(asPaymentMode('prod')).toBeNull()
    expect(asPaymentMode('')).toBeNull()
    expect(asPaymentMode(undefined)).toBeNull()
    expect(asPaymentMode(null)).toBeNull()
    expect(asPaymentMode(1)).toBeNull()
  })

  it('requirePaymentMode throws on a bad value', () => {
    expect(() => requirePaymentMode('nope')).toThrow(/Invalid payment mode/)
    expect(() => requirePaymentMode('LIVE')).toThrow()
    expect(requirePaymentMode('live')).toBe('live')
  })
})

describe('householdWriteOp (null clears the override, a mode upserts it)', () => {
  it('null mode = inherit -> delete the override row', () => {
    expect(householdWriteOp(null)).toEqual({ op: 'delete' })
  })

  it('a valid mode -> upsert that mode', () => {
    expect(householdWriteOp('test')).toEqual({ op: 'upsert', mode: 'test' })
    expect(householdWriteOp('live')).toEqual({ op: 'upsert', mode: 'live' })
  })
})

describe('resolvePaymentMode (precedence: override > global > default test)', () => {
  it('uses the household override when present, ignoring the global', async () => {
    const db = fakeDb([
      { scope: GLOBAL_SCOPE, mode: 'test' },
      { scope: 'hh-1', mode: 'live' },
    ])
    expect(await resolvePaymentMode(db, 'hh-1')).toBe('live')
  })

  it('falls back to the global default when there is no override', async () => {
    const db = fakeDb([{ scope: GLOBAL_SCOPE, mode: 'live' }])
    expect(await resolvePaymentMode(db, 'hh-1')).toBe('live')
  })

  it("defaults to 'test' when neither row exists", async () => {
    const db = fakeDb([])
    expect(await resolvePaymentMode(db, 'hh-1')).toBe('test')
  })

  it("falls through a bad override value to the global, then to 'test'", async () => {
    // A legacy/garbage override must never charge live by mistake; it falls to
    // the global, and a garbage global falls to the safe 'test' default.
    const db = fakeDb([
      { scope: GLOBAL_SCOPE, mode: 'live' },
      { scope: 'hh-1', mode: 'bogus' },
    ])
    expect(await resolvePaymentMode(db, 'hh-1')).toBe('live')

    const db2 = fakeDb([
      { scope: GLOBAL_SCOPE, mode: 'bogus' },
      { scope: 'hh-1', mode: 'also-bad' },
    ])
    expect(await resolvePaymentMode(db2, 'hh-1')).toBe('test')
  })
})

describe('mollieKeyForMode (picks the right env key, throws when unset)', () => {
  it("reads MOLLIE_API_KEY for 'test'", async () => {
    readEnv.mockImplementation(async (k) =>
      k === 'MOLLIE_API_KEY' ? 'test_abc' : undefined,
    )
    expect(await mollieKeyForMode('test')).toBe('test_abc')
    expect(readEnv).toHaveBeenCalledWith('MOLLIE_API_KEY')
  })

  it("reads MOLLIE_API_KEY_LIVE for 'live'", async () => {
    readEnv.mockImplementation(async (k) =>
      k === 'MOLLIE_API_KEY_LIVE' ? 'live_xyz' : undefined,
    )
    expect(await mollieKeyForMode('live')).toBe('live_xyz')
    expect(readEnv).toHaveBeenCalledWith('MOLLIE_API_KEY_LIVE')
  })

  it('throws a clear error naming the missing key when unset', async () => {
    readEnv.mockResolvedValue(undefined)
    await expect(mollieKeyForMode('live')).rejects.toThrow(
      'MOLLIE_API_KEY_LIVE not configured',
    )
    await expect(mollieKeyForMode('test')).rejects.toThrow(
      'MOLLIE_API_KEY not configured',
    )
  })
})
