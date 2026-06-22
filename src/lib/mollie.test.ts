import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  MollieError,
  createPayment,
  getPayment,
  isMolliePaymentId,
} from './mollie'

/**
 * MollieError parsing (#307). The old client threw a bare string on a non-2xx;
 * now it throws a structured MollieError carrying { status, title, detail, field }
 * parsed from Mollie's JSON error body, so a caller can log + branch on them.
 */

const PARAMS = {
  amount: '0.50',
  description: 'Souso tip',
  redirectUrl: 'https://souso.test/tip/x/return',
  webhookUrl: 'https://souso.test/api/mollie/webhook',
}

/** A realistic Mollie 422 "method not activated" error body. */
const BODY_422 = JSON.stringify({
  status: 422,
  title: 'Unprocessable Entity',
  detail: 'The payment method is not activated on your account',
  field: 'method',
})

function mockFetch(status: number, body: string, ok = false): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok,
      status,
      text: () => Promise.resolve(body),
      json: () => Promise.resolve(JSON.parse(body)),
    }),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('MollieError parsing', () => {
  it('createPayment throws a MollieError carrying status/title/detail/field from a 422 body', async () => {
    mockFetch(422, BODY_422)

    const err = await createPayment('test_key', PARAMS).catch((e) => e)

    expect(err).toBeInstanceOf(MollieError)
    expect(err.status).toBe(422)
    expect(err.title).toBe('Unprocessable Entity')
    expect(err.detail).toBe(
      'The payment method is not activated on your account',
    )
    expect(err.field).toBe('method')
    // The message stays readable for code that just logs the text.
    expect(err.message).toContain('422')
    expect(err.message).toContain('not activated')
  })

  it('falls back to the raw text as detail when the body is not JSON', async () => {
    mockFetch(401, 'Unauthorized')

    const err = await createPayment('bad_key', PARAMS).catch((e) => e)

    expect(err).toBeInstanceOf(MollieError)
    expect(err.status).toBe(401)
    expect(err.detail).toBe('Unauthorized')
  })

  it('getPayment throws a MollieError on a non-2xx fetch', async () => {
    mockFetch(404, JSON.stringify({ status: 404, title: 'Not Found' }))

    const err = await getPayment('test_key', 'tr_missing').catch((e) => e)

    expect(err).toBeInstanceOf(MollieError)
    expect(err.status).toBe(404)
    expect(err.title).toBe('Not Found')
  })

  it('does not throw a MollieError on a successful create', async () => {
    mockFetch(
      201,
      JSON.stringify({ id: 'tr_ok', status: 'open', _links: {} }),
      true,
    )

    const payment = await createPayment('test_key', PARAMS)
    expect(payment.id).toBe('tr_ok')
  })
})

describe('Mollie payment id validation', () => {
  it('accepts payment ids with Mollie tr_ shape', () => {
    expect(isMolliePaymentId('tr_WDqYK6vllg')).toBe(true)
    expect(isMolliePaymentId('tr_7UhSN1zuXS')).toBe(true)
  })

  it('rejects empty, wrong-prefix, path, query, and oversized ids', () => {
    expect(isMolliePaymentId('')).toBe(false)
    expect(isMolliePaymentId('ord_WDqYK6vllg')).toBe(false)
    expect(isMolliePaymentId('tr_abc/../../customers')).toBe(false)
    expect(isMolliePaymentId('tr_abc?expand=customer')).toBe(false)
    expect(isMolliePaymentId(`tr_${'a'.repeat(80)}`)).toBe(false)
  })

  it('getPayment rejects malformed ids before fetch', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const err = await getPayment('test_key', 'tr_abc/../x').catch((e) => e)

    expect(err).toBeInstanceOf(MollieError)
    expect(err.status).toBe(400)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
