import { describe, it, expect } from 'vitest'
import {
  DISMISS_SUPPRESS_MS,
  MAX_LIFETIME_SHOWS,
  INSTALL_PROMPT_KEY,
  detectPlatform,
  isIos,
  isIosSafari,
  isStandalone,
  markEngaged,
  readInstallPromptState,
  recordDismissed,
  recordShown,
  shouldShowInstallPrompt,
  writeInstallPromptState,
} from './pwa-install'
import type { InstallPromptState, InstallStorage } from './pwa-install'

/** An in-memory storage stub matching the InstallStorage shape. */
function memoryStorage(initial: Record<string, string> = {}): InstallStorage {
  const map = new Map(Object.entries(initial))
  return {
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    setItem: (k, v) => {
      map.set(k, v)
    },
    removeItem: (k) => {
      map.delete(k)
    },
  }
}

// Representative user-agent strings.
const UA = {
  iphoneSafari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  iphoneChrome:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0 Mobile/15E148 Safari/604.1',
  iphoneFirefox:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/126.0 Mobile/15E148 Safari/604.1',
  androidChrome:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36',
  desktopChrome:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
} as const

describe('isIos / isIosSafari', () => {
  it('detects iOS devices', () => {
    expect(isIos(UA.iphoneSafari)).toBe(true)
    expect(isIos(UA.iphoneChrome)).toBe(true)
    expect(isIos(UA.androidChrome)).toBe(false)
    expect(isIos(UA.desktopChrome)).toBe(false)
  })

  it('distinguishes Safari from other iOS browsers', () => {
    expect(isIosSafari(UA.iphoneSafari)).toBe(true)
    expect(isIosSafari(UA.iphoneChrome)).toBe(false)
    expect(isIosSafari(UA.iphoneFirefox)).toBe(false)
    expect(isIosSafari(UA.androidChrome)).toBe(false)
  })
})

describe('detectPlatform', () => {
  it('returns ios-safari for iPhone Safari', () => {
    expect(detectPlatform(UA.iphoneSafari, false)).toBe('ios-safari')
  })

  it('returns ios-other for iPhone Chrome / Firefox', () => {
    expect(detectPlatform(UA.iphoneChrome, false)).toBe('ios-other')
    expect(detectPlatform(UA.iphoneFirefox, false)).toBe('ios-other')
  })

  it('returns android only when a beforeinstallprompt was captured', () => {
    expect(detectPlatform(UA.androidChrome, true)).toBe('android')
    expect(detectPlatform(UA.androidChrome, false)).toBe('unsupported')
  })

  it('returns unsupported for desktop without an install event', () => {
    expect(detectPlatform(UA.desktopChrome, false)).toBe('unsupported')
  })

  it('prefers iOS guidance over a (spurious) install event on iOS', () => {
    // iOS never fires beforeinstallprompt, but guard against it anyway.
    expect(detectPlatform(UA.iphoneSafari, true)).toBe('ios-safari')
  })
})

describe('isStandalone', () => {
  it('true when display-mode standalone matches', () => {
    expect(isStandalone({ matchMedia: () => ({ matches: true }) })).toBe(true)
  })

  it('true when iOS navigator.standalone is set', () => {
    expect(
      isStandalone({
        matchMedia: () => ({ matches: false }),
        navigator: { standalone: true },
      }),
    ).toBe(true)
  })

  it('false in a normal browser tab', () => {
    expect(
      isStandalone({
        matchMedia: () => ({ matches: false }),
        navigator: { standalone: false },
      }),
    ).toBe(false)
  })

  it('false (no throw) when matchMedia is missing', () => {
    expect(isStandalone({})).toBe(false)
  })
})

describe('shouldShowInstallPrompt', () => {
  const base = {
    platform: 'android' as const,
    state: {} as InstallPromptState,
    engaged: true,
    shownThisSession: false,
    now: 1_000_000,
  }

  it('shows on the happy path', () => {
    expect(shouldShowInstallPrompt(base)).toBe(true)
  })

  it('never shows on an unsupported platform', () => {
    expect(shouldShowInstallPrompt({ ...base, platform: 'unsupported' })).toBe(
      false,
    )
  })

  it('does not show before the user is engaged', () => {
    expect(shouldShowInstallPrompt({ ...base, engaged: false })).toBe(false)
  })

  it('shows at most once per session', () => {
    expect(shouldShowInstallPrompt({ ...base, shownThisSession: true })).toBe(
      false,
    )
  })

  it('respects the lifetime cap', () => {
    expect(
      shouldShowInstallPrompt({
        ...base,
        state: { shownCount: MAX_LIFETIME_SHOWS },
      }),
    ).toBe(false)
    expect(
      shouldShowInstallPrompt({
        ...base,
        state: { shownCount: MAX_LIFETIME_SHOWS - 1 },
      }),
    ).toBe(true)
  })

  it('suppresses for ~7 days after a dismissal, then shows again', () => {
    const dismissedAt = 1_000_000
    expect(
      shouldShowInstallPrompt({
        ...base,
        state: { dismissedAt },
        now: dismissedAt + DISMISS_SUPPRESS_MS - 1,
      }),
    ).toBe(false)
    expect(
      shouldShowInstallPrompt({
        ...base,
        state: { dismissedAt },
        now: dismissedAt + DISMISS_SUPPRESS_MS + 1,
      }),
    ).toBe(true)
  })

  it('works for iOS platforms too', () => {
    expect(shouldShowInstallPrompt({ ...base, platform: 'ios-safari' })).toBe(
      true,
    )
    expect(shouldShowInstallPrompt({ ...base, platform: 'ios-other' })).toBe(
      true,
    )
  })
})

describe('state mutators', () => {
  it('recordShown bumps count and stamps time', () => {
    const next = recordShown({ shownCount: 1 }, 5000)
    expect(next.shownCount).toBe(2)
    expect(next.lastShownAt).toBe(5000)
  })

  it('recordShown starts from zero when count is absent', () => {
    expect(recordShown({}, 5000).shownCount).toBe(1)
  })

  it('recordDismissed stamps the dismissal time', () => {
    expect(recordDismissed({}, 7777).dismissedAt).toBe(7777)
  })

  it('markEngaged stamps once and is idempotent', () => {
    const first = markEngaged({}, 100)
    expect(first.engagedAt).toBe(100)
    const second = markEngaged(first, 999)
    expect(second.engagedAt).toBe(100) // unchanged
  })
})

describe('read / write state', () => {
  it('round-trips state through storage', () => {
    const storage = memoryStorage()
    writeInstallPromptState({ shownCount: 2, dismissedAt: 42 }, storage)
    expect(readInstallPromptState(storage)).toEqual({
      shownCount: 2,
      dismissedAt: 42,
    })
  })

  it('returns {} for absent storage (SSR / blocked)', () => {
    expect(readInstallPromptState(null)).toEqual({})
  })

  it('write is a no-op for absent storage', () => {
    expect(() => writeInstallPromptState({ shownCount: 1 }, null)).not.toThrow()
  })

  it('returns {} for malformed JSON', () => {
    const storage = memoryStorage({ [INSTALL_PROMPT_KEY]: 'not json {' })
    expect(readInstallPromptState(storage)).toEqual({})
  })

  it('returns {} when nothing stored', () => {
    expect(readInstallPromptState(memoryStorage())).toEqual({})
  })
})
