import { describe, it, expect, vi, afterEach } from 'vitest'
import { promptForNotifications, urlBase64ToUint8Array } from './push-client'

// #414 (Sentry SOUSO-Z): on iOS, when the page is tearing down for the post-auth
// navigation, `await import('./push-server')` resolves to a null/empty module and
// the destructure `const { getPushConfig } = mod` throws
// "Cannot destructure property 'getPushConfig' from null or undefined value".
// Simulate a torn-down module (the expected server fns are absent) so the guard
// is exercised. push-server imports server-only code anyway, so it must be mocked
// in jsdom regardless. (vitest factories cannot return raw null; an empty module
// drives the same guard: `typeof mod.getPushConfig !== 'function'`.)
vi.mock('./push-server', () => ({
  getPushConfig: undefined,
  subscribePush: undefined,
}))
const logError = vi.fn()
vi.mock('./log', () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: (...a: Array<unknown>) => logError(...a),
  },
}))

describe('urlBase64ToUint8Array', () => {
  it('decodes a standard base64url string to the right bytes', () => {
    // "hello" -> base64 "aGVsbG8="; base64url drops padding -> "aGVsbG8"
    const bytes = urlBase64ToUint8Array('aGVsbG8')
    expect(Array.from(bytes)).toEqual([104, 101, 108, 108, 111])
  })

  it('handles the url-safe alphabet (- and _) like + and /', () => {
    // bytes [255, 224] -> base64 "/+A=" -> base64url "_-A"
    const bytes = urlBase64ToUint8Array('_-A')
    expect(Array.from(bytes)).toEqual([255, 224])
  })

  it('tolerates a string that needs no padding', () => {
    // "test" decodes cleanly with padding restored
    const bytes = urlBase64ToUint8Array('dGVzdA')
    expect(Array.from(bytes)).toEqual([116, 101, 115, 116])
  })
})

describe('promptForNotifications', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('is a safe no-op when push is unsupported (the iOS-non-PWA / SSR case)', async () => {
    // No serviceWorker / PushManager / Notification on the globals -> pushSupported()
    // is false. The helper must resolve without throwing and never touch the
    // Notification API (which is what would break sign-in on mobile Safari).
    const requestPermission = vi.fn()
    vi.stubGlobal('Notification', undefined)
    await expect(promptForNotifications()).resolves.toBeUndefined()
    expect(requestPermission).not.toHaveBeenCalled()
  })

  it('does nothing when permission is already denied (cannot re-prompt)', async () => {
    const requestPermission = vi.fn()
    vi.stubGlobal('window', { PushManager: function () {} })
    vi.stubGlobal('navigator', { serviceWorker: {} })
    vi.stubGlobal('Notification', { permission: 'denied', requestPermission })
    await expect(promptForNotifications()).resolves.toBeUndefined()
    expect(requestPermission).not.toHaveBeenCalled()
  })

  it('resolves WITHOUT throwing when import("./push-server") yields null (#414 / SOUSO-Z)', async () => {
    // Browser looks push-capable so we get PAST pushSupported() and reach the
    // dynamic import — the exact line that throws in the wild during teardown.
    // pushSupported() checks 'PushManager' in window AND 'Notification' in window.
    const NotificationStub = Object.assign(function () {}, {
      permission: 'default',
      requestPermission: vi.fn(),
    })
    vi.stubGlobal('window', {
      PushManager: function () {},
      Notification: NotificationStub,
    })
    vi.stubGlobal('navigator', { serviceWorker: {} })
    vi.stubGlobal('Notification', NotificationStub)
    logError.mockReset()
    // Must resolve cleanly. With the unguarded destructure the TypeError is caught
    // and logged as `push.prompt_failed` (the SOUSO-Z noise). The guard makes a
    // null module a SILENT no-op: no throw, no error log, nothing reaching Sentry.
    await expect(promptForNotifications()).resolves.toBeUndefined()
    expect(logError).not.toHaveBeenCalled()
  })
})
