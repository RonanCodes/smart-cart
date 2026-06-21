import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

/**
 * Behavioural coverage for the shipped service worker (#249, #149).
 *
 * public/sw.js is served verbatim (no build step, never imported), so it has no
 * natural unit-test seam. The notificationclick handler is the load-bearing half
 * of the rate-meal push: a tap must FOCUS an open Souso tab and navigate it to the
 * deep link (/rate/$planId/$day), or OPEN a fresh tab when none exist. This test
 * loads the real sw.js into a simulated ServiceWorkerGlobalScope, captures the
 * listeners it registers, then dispatches synthetic push + notificationclick
 * events and asserts the navigation it performs. If sw.js ever stops carrying the
 * deep-link url through to the click, this fails.
 */

interface SwListeners {
  install?: (event: unknown) => void
  activate?: (event: { waitUntil: (p: unknown) => void }) => void
  push?: (event: PushEventLike) => void
  notificationclick?: (event: NotificationClickEventLike) => void
}

interface PushEventLike {
  data: { json: () => unknown } | null
  waitUntil: (p: unknown) => void
}

interface NotificationClickEventLike {
  notification: { close: () => void; data: { url?: string } | undefined }
  waitUntil: (p: Promise<unknown>) => void
}

/**
 * Load public/sw.js into an isolated VM context with a minimal
 * ServiceWorkerGlobalScope (`self`), returning the listeners it registered plus
 * the mocked `self` so a test can drive `clients` / `registration`.
 */
function loadServiceWorker(selfStub: Record<string, unknown>): SwListeners {
  const swPath = path.resolve(process.cwd(), 'public/sw.js')
  const source = readFileSync(swPath, 'utf8')

  const listeners: Record<string, (event: never) => void> = {}
  const swSelf = selfStub as Record<string, unknown> & {
    addEventListener: (type: string, fn: (event: never) => void) => void
  }
  swSelf.addEventListener = (type: string, fn: (event: never) => void) => {
    listeners[type] = fn
  }

  const context = vm.createContext({ self: swSelf })
  vm.runInContext(source, context)
  return listeners
}

describe('service worker notificationclick (#249)', () => {
  let navigate: ReturnType<typeof vi.fn>
  let focus: ReturnType<typeof vi.fn>
  let openWindow: ReturnType<typeof vi.fn>
  let showNotification: ReturnType<typeof vi.fn>
  let matchAllResult: Array<unknown>
  let listeners: SwListeners

  beforeEach(() => {
    navigate = vi.fn().mockResolvedValue(undefined)
    focus = vi.fn().mockResolvedValue(undefined)
    openWindow = vi.fn().mockResolvedValue(undefined)
    showNotification = vi.fn().mockResolvedValue(undefined)
    matchAllResult = []

    listeners = loadServiceWorker({
      skipWaiting: vi.fn(),
      registration: { showNotification },
      clients: {
        claim: vi.fn().mockResolvedValue(undefined),
        matchAll: vi
          .fn()
          .mockImplementation(() => Promise.resolve(matchAllResult)),
        openWindow,
      },
    })
  })

  it('registers push + notificationclick handlers', () => {
    expect(typeof listeners.push).toBe('function')
    expect(typeof listeners.notificationclick).toBe('function')
  })

  it('push stashes the payload url on the notification data so the tap can deep-link', () => {
    let waited: unknown
    listeners.push?.({
      data: {
        json: () => ({
          title: 'How was dinner?',
          body: 'How was Thai green curry? Tap to rate.',
          url: '/rate/p1/Monday',
        }),
      },
      waitUntil: (p) => {
        waited = p
      },
    })

    expect(showNotification).toHaveBeenCalledTimes(1)
    const [title, opts] = showNotification.mock.calls[0] as [
      string,
      { data: { url: string } },
    ]
    expect(title).toBe('How was dinner?')
    expect(opts.data.url).toBe('/rate/p1/Monday')
    expect(waited).toBeInstanceOf(Promise)
  })

  it('a tap FOCUSES an open Souso tab and navigates it to the deep link', async () => {
    matchAllResult = [{ focus, navigate }]

    let waited: Promise<unknown> | undefined
    listeners.notificationclick?.({
      notification: { close: vi.fn(), data: { url: '/rate/p1/Monday' } },
      waitUntil: (p) => {
        waited = p
      },
    })
    await waited

    expect(focus).toHaveBeenCalledTimes(1)
    expect(navigate).toHaveBeenCalledWith('/rate/p1/Monday')
    expect(openWindow).not.toHaveBeenCalled()
  })

  it('a tap OPENS a fresh tab at the deep link when no Souso tab is open', async () => {
    matchAllResult = []

    let waited: Promise<unknown> | undefined
    listeners.notificationclick?.({
      notification: { close: vi.fn(), data: { url: '/rate/p1/Monday' } },
      waitUntil: (p) => {
        waited = p
      },
    })
    await waited

    expect(openWindow).toHaveBeenCalledWith('/rate/p1/Monday')
    expect(focus).not.toHaveBeenCalled()
  })

  it('falls back to / when the notification carries no url', async () => {
    matchAllResult = []

    let waited: Promise<unknown> | undefined
    listeners.notificationclick?.({
      notification: { close: vi.fn(), data: undefined },
      waitUntil: (p) => {
        waited = p
      },
    })
    await waited

    expect(openWindow).toHaveBeenCalledWith('/')
  })

  it('closes the notification on tap', () => {
    const close = vi.fn()
    listeners.notificationclick?.({
      notification: { close, data: { url: '/rate/p1/Monday' } },
      waitUntil: () => {},
    })
    expect(close).toHaveBeenCalledTimes(1)
  })
})
