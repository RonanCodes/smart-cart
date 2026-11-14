import { describe, it, expect, vi, afterEach } from 'vitest'
import { createServerEntry } from './server'

/**
 * Bots/crawlers probing well-known discovery paths (eg `/.well-known/mcp`) send
 * `Accept: application/json`. TanStack Start's SSR handler can only render HTML,
 * so for ANY unmatched/non-HTML-negotiable request it synthesizes a
 * `{"error":"Only HTML requests are supported here"}` 500 response — not a real
 * application error. Our wrapper treated every >=500 as a genuine server error
 * and forwarded it to Sentry/Workers Logs, so routine bot traffic showed up as
 * spurious worker errors (finding find_223534fc).
 */
const captureServerError = vi.fn().mockResolvedValue(undefined)
vi.mock('#/lib/sentry-server-forward', () => ({
  captureServerError: (...args: Array<unknown>) => captureServerError(...args),
}))

afterEach(() => {
  vi.clearAllMocks()
})

describe('createServerEntry', () => {
  it('downgrades the "Only HTML requests are supported here" placeholder to 404 and does not report it', async () => {
    const entry = {
      fetch: vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { error: 'Only HTML requests are supported here' },
            { status: 500 },
          ),
        ),
    }
    const wrapped = createServerEntry(entry)

    const res = await wrapped.fetch(
      new Request('https://smartcart.ronanconnolly.dev/.well-known/mcp', {
        headers: { Accept: 'application/json' },
      }),
    )

    expect(res.status).toBe(404)
    // Let the fire-and-forget report() microtask (if any) flush.
    await new Promise((r) => setTimeout(r, 0))
    expect(captureServerError).not.toHaveBeenCalled()
  })

  it('still reports a genuine 500 response to Sentry, unchanged', async () => {
    const entry = {
      fetch: vi.fn().mockResolvedValue(new Response('boom', { status: 500 })),
    }
    const wrapped = createServerEntry(entry)

    const res = await wrapped.fetch(
      new Request('https://smartcart.ronanconnolly.dev/app'),
    )

    expect(res.status).toBe(500)
    await new Promise((r) => setTimeout(r, 0))
    expect(captureServerError).toHaveBeenCalledTimes(1)
  })
})
