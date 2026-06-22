import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Reproduce-first regression for "in-app feedback never reaches Sentry" (#443
 * follow-up). The wrapper around `Sentry.captureFeedback` was a silent no-op in
 * the cases that mattered, and even when it ran it omitted the `source`/`url`
 * the SDK's own `sendFeedback` sets and never flushed the envelope before the
 * panel closed / the user navigated. These tests lock the contract:
 *
 *   1. it sends when a Sentry client exists (guard on the live client, not only
 *      our module-local `started` flag, which can be false at submit time),
 *   2. the payload carries message + email + the API source + the page url,
 *   3. the optional screenshot rides as an attachment in the capture hint,
 *   4. the phone rides in the feedback context,
 *   5. it flushes after capture so the envelope leaves before navigation,
 *   6. it never throws (observability must never crash a request).
 *
 * `@sentry/react` is mocked so we assert the exact call shape without booting
 * the real SDK.
 */

const captureFeedback = vi.fn<
  (params: Record<string, unknown>, hint: Record<string, unknown>) => string
>(() => 'evt-1')
const flush = vi.fn<(timeout?: number) => Promise<boolean>>(() =>
  Promise.resolve(true),
)
const getClient = vi.fn<() => object | undefined>(() => ({}))

vi.mock('@sentry/react', () => ({
  // The functions the wrapper touches. `captureFeedback`/`flush`/`getClient`
  // are the load-bearing ones; the rest are present so importing the real
  // module's siblings (init etc.) does not explode if it changes.
  captureFeedback: (p: Record<string, unknown>, h: Record<string, unknown>) =>
    captureFeedback(p, h),
  flush: (t?: number) => flush(t),
  getClient: () => getClient(),
  feedbackIntegration: vi.fn(),
  init: vi.fn(),
  setTag: vi.fn(),
  setUser: vi.fn(),
  addBreadcrumb: vi.fn(),
  captureException: vi.fn(),
  setContext: vi.fn(),
}))

// PostHog is imported at module top-level; stub it so the import resolves.
vi.mock('posthog-js', () => ({
  default: {
    init: vi.fn(),
    capture: vi.fn(),
    get_distinct_id: vi.fn(() => 'd1'),
    register: vi.fn(),
  },
}))

async function loadCapture() {
  const mod = await import('./observability-client')
  return mod.captureSentryFeedback
}

/** The first `captureFeedback` call's [params, hint], asserted present. */
function firstCall() {
  const call = captureFeedback.mock.calls[0]
  expect(call).toBeDefined()
  return call as [Record<string, unknown>, Record<string, unknown>]
}

beforeEach(() => {
  captureFeedback.mockClear()
  flush.mockClear()
  getClient.mockReset()
  getClient.mockReturnValue({})
  // The wrapper reads window.location.href for the feedback `url`; pin it.
  window.history.replaceState({}, '', '/week')
})

describe('captureSentryFeedback', () => {
  it('sends to Sentry whenever a client exists (not gated on the local flag)', async () => {
    const capture = await loadCapture()
    await capture({
      message: 'the swap button is hidden',
      email: 'nico@example.com',
    })
    expect(captureFeedback).toHaveBeenCalledTimes(1)
  })

  it('does nothing when there is no Sentry client (local dev / pre-init)', async () => {
    getClient.mockReturnValue(undefined)
    const capture = await loadCapture()
    await capture({ message: 'hello' })
    expect(captureFeedback).not.toHaveBeenCalled()
  })

  it('carries message, email, the API source, and the page url', async () => {
    const capture = await loadCapture()
    await capture({ message: 'love the recipes', email: 'nico@example.com' })
    const payload = firstCall()[0]
    expect(payload.message).toBe('love the recipes')
    expect(payload.email).toBe('nico@example.com')
    expect(payload.source).toBeTruthy()
    expect(payload.url).toContain('/week')
  })

  it('attaches the screenshot bytes in the capture hint', async () => {
    const capture = await loadCapture()
    const bytes = new Uint8Array([1, 2, 3])
    await capture({
      message: 'see attached',
      attachment: { filename: 'screenshot.png', data: bytes },
    })
    const hint = firstCall()[1] as unknown as {
      attachments?: Array<{ filename: string; data: Uint8Array }>
    }
    expect(hint.attachments).toHaveLength(1)
    expect(hint.attachments?.[0]?.filename).toBe('screenshot.png')
    expect(hint.attachments?.[0]?.data).toBe(bytes)
  })

  it('puts the phone in the feedback context', async () => {
    const capture = await loadCapture()
    await capture({ message: 'call me', phone: '+31 6 12345678' })
    const hint = firstCall()[1] as unknown as {
      captureContext?: { contexts?: { feedback?: { phone?: string } } }
    }
    expect(hint.captureContext?.contexts?.feedback?.phone).toBe(
      '+31 6 12345678',
    )
  })

  it('flushes after capture so the envelope leaves before navigation', async () => {
    const capture = await loadCapture()
    await capture({ message: 'flush me' })
    expect(flush).toHaveBeenCalled()
  })

  it('never throws even if captureFeedback blows up', async () => {
    captureFeedback.mockImplementationOnce(() => {
      throw new Error('sentry exploded')
    })
    const capture = await loadCapture()
    await expect(capture({ message: 'boom' })).resolves.toBeUndefined()
  })
})
