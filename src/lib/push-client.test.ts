import { describe, it, expect, vi, afterEach } from 'vitest'
import { promptForNotifications, urlBase64ToUint8Array } from './push-client'

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
})
