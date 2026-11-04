import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * find_cd430082 (worker-logs): the Worker's top-level request wrapper
 * (`createServerEntry`) rethrows EVERY thrown error unconditionally, so when
 * the client disconnects mid-response — a normal, expected network blip, not
 * an app bug — workerd throws `TypeError: Network connection lost.` while
 * writing the response, the wrapper reports it to Sentry, then rethrows it,
 * and Cloudflare logs the rethrow as an uncaught exception in Workers Logs.
 *
 * This is exactly the client-side SOUSO-A/Y/X story (#417) one layer down:
 * there, a dropped connection surfaces to the browser as `Failed to fetch` /
 * `Load failed` / `NetworkError...` and `isIgnorableNetworkError` drops it
 * before it reaches Sentry. `Network connection lost.` is workerd's own name
 * for the identical "client is gone" condition, so it should be dropped the
 * same way: no Sentry report, no rethrow (there is no one left to see a
 * response anyway).
 */

const { captureServerError } = vi.hoisted(() => ({
  captureServerError: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('#/lib/sentry-server-forward', () => ({ captureServerError }))

beforeEach(() => {
  captureServerError.mockClear()
})

describe('createServerEntry', () => {
  it('drops a benign "Network connection lost." throw: no Sentry report, no rethrow', async () => {
    const { createServerEntry } = await import('./server')
    const wrapped = createServerEntry({
      fetch: () => {
        throw new TypeError('Network connection lost.')
      },
    })

    await expect(
      wrapped.fetch(new Request('https://example.com/test')),
    ).resolves.toBeInstanceOf(Response)
    expect(captureServerError).not.toHaveBeenCalled()
  })

  it('still reports and rethrows a genuine application error', async () => {
    const { createServerEntry } = await import('./server')
    const wrapped = createServerEntry({
      fetch: () => {
        throw new Error('Cannot read properties of undefined')
      },
    })

    await expect(
      wrapped.fetch(new Request('https://example.com/test')),
    ).rejects.toThrow('Cannot read properties of undefined')
    // `report` is fire-and-forget (no execution context to `waitUntil` on in
    // this test), so give its dynamic import + call a tick to land.
    await vi.waitFor(() => expect(captureServerError).toHaveBeenCalledTimes(1))
  })
})
