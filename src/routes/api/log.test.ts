import { describe, it, expect, vi, beforeEach } from 'vitest'
import { forwardErrorToSentry } from '#/lib/sentry-server-forward'
import { Route } from './log'

vi.mock('#/lib/sentry-server-forward', () => ({
  forwardErrorToSentry: vi.fn(),
}))

/**
 * find_cd430082 (worker-logs, "Network connection lost."): a Cloudflare Worker
 * tears down a request's in-flight I/O (any un-awaited, non-`waitUntil`'d
 * fetch) the instant its handler's `Response` is returned. The route fired the
 * Sentry-ingest fetch via `void forwardErrorToSentry(body)` and returned its
 * 204 immediately without awaiting it or anchoring it in `ctx.waitUntil`, so
 * the Worker could cancel the still-in-flight connection and workerd logged a
 * bare, stackless `TypeError: Network connection lost.` straight to Workers
 * Logs — exactly the finding's evidence (no stack, single occurrence).
 */
describe('POST /api/log', () => {
  const handler = (
    Route.options as unknown as {
      server: { handlers: { POST: (args: { request: Request }) => unknown } }
    }
  ).server.handlers.POST

  beforeEach(() => {
    vi.mocked(forwardErrorToSentry).mockClear()
  })

  it('awaits the Sentry forward before responding, so the Worker cannot tear down the in-flight fetch', async () => {
    let resolveForward!: () => void
    const forwardPromise = new Promise<void>((resolve) => {
      resolveForward = resolve
    })
    let forwardSettled = false
    vi.mocked(forwardErrorToSentry).mockImplementation(() =>
      forwardPromise.then(() => {
        forwardSettled = true
      }),
    )

    const request = new Request('http://test.local/api/log', {
      method: 'POST',
      body: JSON.stringify({
        level: 'error',
        event: 'test.error',
        error: { name: 'Error', message: 'boom' },
      }),
    })

    const responsePromise = Promise.resolve(
      handler({ request }),
    ) as Promise<Response>
    let responseSettled = false
    void responsePromise.then(() => {
      responseSettled = true
    })

    // Flush plenty of microtasks (Request#json()'s own stream plumbing takes
    // several ticks) WITHOUT resolving the forward — a correct handler must
    // still be pending here, because it awaits the forward.
    for (let i = 0; i < 20; i++) {
      await Promise.resolve()
    }
    expect(responseSettled).toBe(false)

    resolveForward()
    await responsePromise
    expect(forwardSettled).toBe(true)
    expect(responseSettled).toBe(true)
  })
})
