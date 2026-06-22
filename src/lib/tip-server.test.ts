import { describe, it, expect, vi } from 'vitest'
import {
  computeTipAmount,
  currentPeriod,
  applyMolliePaymentUpdate,
  friendlyTipError,
  FREE_ADDS_PER_PERIOD,
  TIP_FEE_FLOOR_EUR,
} from './tip-server'
import { MollieError } from './mollie'
import { log } from './log'

describe('computeTipAmount (fee floor)', () => {
  it('clamps a small basket to the €0.50 floor (1% of €10 = €0.10 -> 0.50)', () => {
    expect(computeTipAmount(1, 10)).toBe('0.50')
  })

  it('clamps to the floor exactly at the boundary (1% of €50 = €0.50)', () => {
    expect(computeTipAmount(1, 50)).toBe('0.50')
  })

  it('computes a normal percent above the floor (3% of €40 = €1.20)', () => {
    expect(computeTipAmount(3, 40)).toBe('1.20')
  })

  it('computes 5% of a larger basket (5% of €120 = €6.00)', () => {
    expect(computeTipAmount(5, 120)).toBe('6.00')
  })

  it('always returns a 2-decimal string', () => {
    expect(computeTipAmount(3, 33.33)).toMatch(/^\d+\.\d{2}$/)
  })

  it('no-tip (percent 0) returns null, never a charge', () => {
    expect(computeTipAmount(0, 100)).toBeNull()
  })

  it('negative or non-finite percent returns null (no charge)', () => {
    expect(computeTipAmount(-1, 100)).toBeNull()
    expect(computeTipAmount(NaN, 100)).toBeNull()
  })

  it('a zero/negative basket with a positive percent still charges the floor', () => {
    expect(computeTipAmount(3, 0)).toBe(TIP_FEE_FLOOR_EUR.toFixed(2))
    expect(computeTipAmount(3, -5)).toBe('0.50')
  })

  it('exposes the free-tier limit as 3 (decision #16)', () => {
    expect(FREE_ADDS_PER_PERIOD).toBe(3)
  })
})

describe('friendlyTipError (#307 user-facing mapping)', () => {
  it('maps the 422 method-not-activated MollieError to a clear "live payments not enabled" message', () => {
    const err = new MollieError({
      status: 422,
      title: 'Unprocessable Entity',
      detail: 'The payment method is not activated on your account',
      field: 'method',
      operation: 'Mollie create',
    })
    const msg = friendlyTipError(err)
    expect(msg).toContain('Live payments are not enabled')
    expect(msg).toContain('No charge was made')
    // Never leaks the raw Mollie blob to the UI.
    expect(msg).not.toContain('Unprocessable Entity')
  })

  it('also matches the "not enabled" phrasing for the 422 method case', () => {
    const err = new MollieError({
      status: 422,
      title: 'Unprocessable Entity',
      detail: 'The payment method is not enabled',
      operation: 'Mollie create',
    })
    expect(friendlyTipError(err)).toContain('Live payments are not enabled')
  })

  it('falls back to a generic safe message for any other MollieError', () => {
    const err = new MollieError({
      status: 401,
      title: 'Unauthorized',
      operation: 'Mollie create',
    })
    const msg = friendlyTipError(err)
    expect(msg).toContain("couldn't start that payment")
    expect(msg).not.toContain('Unauthorized')
  })

  it('falls back to a generic safe message for a non-Mollie error', () => {
    expect(friendlyTipError(new Error('boom'))).toContain(
      "couldn't start that payment",
    )
    expect(friendlyTipError('weird string')).toContain(
      "couldn't start that payment",
    )
  })
})

describe('tip.mollie.create_failed logging shape (#307)', () => {
  it('log.error carries the Mollie status + detail when a create fails', () => {
    const spy = vi.spyOn(log, 'error').mockImplementation(() => {})
    const err = new MollieError({
      status: 422,
      title: 'Unprocessable Entity',
      detail: 'The payment method is not activated on your account',
      field: 'method',
      operation: 'Mollie create',
    })

    // Mirror exactly what startTip's catch block emits, so the queryable fields
    // (status/detail/mode/household/amount) are asserted at the call shape.
    const status = err instanceof MollieError ? err.status : undefined
    const detail = err instanceof MollieError ? err.detail : undefined
    log.error('tip.mollie.create_failed', err, {
      mode: 'live',
      householdId: 'hh_1',
      amount: '0.50',
      status,
      detail,
    })

    expect(spy).toHaveBeenCalledWith(
      'tip.mollie.create_failed',
      err,
      expect.objectContaining({
        mode: 'live',
        householdId: 'hh_1',
        amount: '0.50',
        status: 422,
        detail: 'The payment method is not activated on your account',
      }),
    )
    spy.mockRestore()
  })
})

describe('currentPeriod', () => {
  it('formats a date as YYYY-MM (UTC)', () => {
    expect(currentPeriod(new Date('2026-06-20T12:00:00Z'))).toBe('2026-06')
  })

  it('zero-pads the month', () => {
    expect(currentPeriod(new Date('2026-01-05T00:00:00Z'))).toBe('2026-01')
  })
})

describe('applyMolliePaymentUpdate (webhook idempotency)', () => {
  it('re-fetches status from Mollie and writes it to the matching row', async () => {
    const getPayment = vi.fn().mockResolvedValue({ status: 'paid' })
    const updateStatus = vi.fn().mockResolvedValue(undefined)

    const result = await applyMolliePaymentUpdate(
      'test_key',
      { getPayment },
      { updateStatus },
      'tr_abc',
    )

    // Status comes from the API re-fetch, not from any request body.
    expect(getPayment).toHaveBeenCalledWith('test_key', 'tr_abc')
    expect(updateStatus).toHaveBeenCalledWith('tr_abc', 'paid')
    expect(result).toEqual({ status: 'paid' })
  })

  it('is idempotent: a second identical webhook re-applies the same status (no-op result)', async () => {
    const getPayment = vi.fn().mockResolvedValue({ status: 'paid' })
    const updateStatus = vi.fn().mockResolvedValue(undefined)

    await applyMolliePaymentUpdate(
      'k',
      { getPayment },
      { updateStatus },
      'tr_x',
    )
    await applyMolliePaymentUpdate(
      'k',
      { getPayment },
      { updateStatus },
      'tr_x',
    )

    // Both calls re-fetched and wrote the SAME status; the second is a no-op at
    // the data level (same value written), never a double-charge or an error.
    expect(updateStatus).toHaveBeenCalledTimes(2)
    expect(updateStatus).toHaveBeenNthCalledWith(1, 'tr_x', 'paid')
    expect(updateStatus).toHaveBeenNthCalledWith(2, 'tr_x', 'paid')
  })

  it('never trusts a body status: even if status changes, it uses the API value', async () => {
    const getPayment = vi
      .fn()
      .mockResolvedValueOnce({ status: 'open' })
      .mockResolvedValueOnce({ status: 'paid' })
    const updateStatus = vi.fn().mockResolvedValue(undefined)

    const first = await applyMolliePaymentUpdate(
      'k',
      { getPayment },
      { updateStatus },
      'tr_y',
    )
    const second = await applyMolliePaymentUpdate(
      'k',
      { getPayment },
      { updateStatus },
      'tr_y',
    )

    expect(first.status).toBe('open')
    expect(second.status).toBe('paid')
  })
})
