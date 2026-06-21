import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  parseDsn,
  ingestUrl,
  forwardErrorToSentry,
} from './sentry-server-forward'

// env.ts imports `cloudflare:workers`, a virtual module Vitest can't resolve, so
// mock it (same pattern as payment-mode.test.ts; vi.mock is hoisted above the
// imports at transform time). Returning undefined makes resolveDsn() fall back
// to the committed client DSN in observability.ts.
vi.mock('./env', () => ({ readEnv: async () => undefined }))

describe('parseDsn', () => {
  it('parses a standard DSN into host / publicKey / projectId', () => {
    const dsn = parseDsn(
      'https://9bfd2e79834ed6bc91f1c93bf31ca8ea@o4511243313414144.ingest.de.sentry.io/4511600359178320',
    )
    expect(dsn).toEqual({
      host: 'o4511243313414144.ingest.de.sentry.io',
      publicKey: '9bfd2e79834ed6bc91f1c93bf31ca8ea',
      projectId: '4511600359178320',
    })
  })

  it('returns null for undefined / garbage', () => {
    expect(parseDsn(undefined)).toBeNull()
    expect(parseDsn('not-a-url')).toBeNull()
    // Missing public key or project id -> null (no crash).
    expect(parseDsn('https://host.sentry.io/123')).toBeNull()
    expect(parseDsn('https://key@host.sentry.io/')).toBeNull()
  })
})

describe('ingestUrl', () => {
  it('derives the envelope ingest URL from the DSN parts', () => {
    expect(
      ingestUrl({
        host: 'o123.ingest.de.sentry.io',
        publicKey: 'pub',
        projectId: '456',
      }),
    ).toBe(
      'https://o123.ingest.de.sentry.io/api/456/envelope/?sentry_key=pub&sentry_version=7',
    )
  })
})

describe('forwardErrorToSentry', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('POSTs a well-formed envelope to the ingest URL and never throws', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, init })
        return new Response(null, { status: 200 })
      }),
    )

    await expect(
      forwardErrorToSentry({
        level: 'error',
        event: 'react.error_boundary',
        ts: '2026-06-21T00:00:00.000Z',
        origin: 'client',
        error: {
          name: 'TypeError',
          message: 'x is not a function',
          stack: 'TypeError: x is not a function\n    at foo (app.js:1:1)',
        },
        userId: 'u_1',
      }),
    ).resolves.toBeUndefined()

    expect(calls).toHaveLength(1)
    const call = calls[0]!
    expect(call.url).toContain('/api/')
    expect(call.url).toContain('/envelope/?sentry_key=')
    expect((call.init.headers as Record<string, string>)['content-type']).toBe(
      'application/x-sentry-envelope',
    )

    // Three newline-delimited JSON lines: envelope header, item header, event.
    const lines = String(call.init.body).split('\n')
    expect(lines).toHaveLength(3)
    const header = JSON.parse(lines[0]!)
    expect(header.event_id).toMatch(/^[0-9a-f]{32}$/)
    expect(typeof header.sent_at).toBe('string')
    expect(JSON.parse(lines[1]!)).toEqual({ type: 'event' })
    const event = JSON.parse(lines[2]!)
    expect(event.level).toBe('error')
    expect(event.exception.values[0].type).toBe('TypeError')
    expect(event.exception.values[0].value).toBe('x is not a function')
    expect(event.exception.values[0].stacktrace.frames.length).toBeGreaterThan(
      0,
    )
    expect(event.tags.log_event).toBe('react.error_boundary')
    expect(event.tags.origin).toBe('client-via-server')
    // Unknown context goes to `extra`; recognised fields don't.
    expect(event.extra.userId).toBe('u_1')
    expect(event.extra.level).toBeUndefined()
    expect(event.extra.error).toBeUndefined()
  })

  it('swallows a fetch rejection (never propagates into the request path)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down')
      }),
    )
    await expect(
      forwardErrorToSentry({ level: 'error', event: 'x' }),
    ).resolves.toBeUndefined()
  })
})
