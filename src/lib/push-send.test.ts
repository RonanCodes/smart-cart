import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { sendOne } from './push-send'

// Mock the WebCrypto push lib so the test never touches real VAPID keys or
// crypto: buildPushPayload just returns a canned request shape. vi.mock is
// hoisted above the imports by Vitest, so the mock is in place before sendOne
// pulls in the lib.
vi.mock('@block65/webcrypto-web-push', () => ({
  buildPushPayload: vi.fn(async () => ({
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body: new Uint8Array([1, 2, 3]),
  })),
}))

const sub = {
  endpoint: 'https://push.example/abc',
  p256dh: 'PUB',
  auth: 'SECRET',
}
const payload = {
  title: 'Souso',
  body: 'How was dinner? Tap to rate.',
  url: '/week',
}
const vapid = { subject: 'mailto:a@b.c', publicKey: 'PUB', privateKey: 'PRIV' }

describe('sendOne', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('POSTs the encrypted payload to the endpoint and reports sent on 2xx', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await sendOne(sub, payload, vapid)

    expect(result).toEqual({
      endpoint: sub.endpoint,
      status: 'sent',
      code: 201,
    })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledWith(
      sub.endpoint,
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('classifies a 410 as gone so the caller prunes the dead subscription', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 410 })),
    )
    const result = await sendOne(sub, payload, vapid)
    expect(result).toEqual({
      endpoint: sub.endpoint,
      status: 'gone',
      code: 410,
    })
  })

  it('classifies a 404 as gone', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 404 })),
    )
    const result = await sendOne(sub, payload, vapid)
    expect(result.status).toBe('gone')
  })

  it('reports error on a non-ok, non-gone status (e.g. 500)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 500 })),
    )
    const result = await sendOne(sub, payload, vapid)
    expect(result).toEqual({
      endpoint: sub.endpoint,
      status: 'error',
      code: 500,
    })
  })

  it('never throws when fetch rejects, returns error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down')
      }),
    )
    const result = await sendOne(sub, payload, vapid)
    expect(result).toEqual({ endpoint: sub.endpoint, status: 'error' })
  })
})
