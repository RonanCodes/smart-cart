import { describe, it, expect, vi, afterEach } from 'vitest'
import { createServerEntry } from './server'
import type { ServerEntry } from './server'

/**
 * Reproduces the `GET /sse` worker-log finding: a scanner/client that sends
 * `Accept: text/event-stream` (SSE/MCP probes do this) hits ANY route and
 * TanStack Start's own `createStartHandler` returns a hardcoded
 * `{ error: 'Only HTML requests are supported here' }` 500 — a content-
 * negotiation mismatch, not a real server failure. Our `createServerEntry`
 * wrapper (server-hardening) reports every >=500 response to Sentry, so this
 * benign mismatch gets reported as a server error and shows up as worker-log
 * noise for every bot that probes with a non-HTML Accept header.
 */

const captureServerError = vi.fn(async (...args: Array<unknown>) => {
  void args
})
vi.mock('#/lib/sentry-server-forward', () => ({
  captureServerError: (...args: Array<unknown>) => captureServerError(...args),
}))

afterEach(() => {
  captureServerError.mockClear()
})

describe('createServerEntry', () => {
  it('does not report the framework "unsupported Accept" 500 as a server error', async () => {
    const entry: ServerEntry = {
      fetch: async () =>
        Response.json(
          { error: 'Only HTML requests are supported here' },
          { status: 500 },
        ),
    }
    const wrapped = createServerEntry(entry)

    const request = new Request('https://www.souso.app/sse', {
      headers: { Accept: 'text/event-stream' },
    })
    const res = await wrapped.fetch(request)

    expect(res.status).not.toBe(500)
    expect(captureServerError).not.toHaveBeenCalled()
  })

  it('still reports a genuine 500 as a server error (unchanged behaviour)', async () => {
    const entry: ServerEntry = {
      fetch: async () => new Response('boom', { status: 500 }),
    }
    const wrapped = createServerEntry(entry)

    const request = new Request('https://www.souso.app/shopping')
    const res = await wrapped.fetch(request)

    expect(res.status).toBe(500)
    await vi.waitFor(() => expect(captureServerError).toHaveBeenCalledTimes(1))
  })
})
