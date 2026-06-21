/**
 * PWA add-to-home-screen logic (the pure, testable half of the install prompt).
 *
 * The install prompt is a dismissible toast that nudges the user to add Souso to
 * their home screen. There is no single cross-platform install API, so the copy
 * and behaviour change by platform:
 *
 *   - Android / Chromium fire a `beforeinstallprompt` event we can stash and
 *     replay from an 'Install' button (a real native prompt).
 *   - iOS Safari has no install API at all; the only route is the Share sheet,
 *     so we show a short instruction ('Tap the Share icon, then Add to Home
 *     Screen').
 *   - iOS in a non-Safari browser (Chrome / Firefox on iOS) cannot install a PWA
 *     at all, so we tell the user to open the site in Safari.
 *   - When the app is already running standalone (installed) we never show it.
 *
 * Everything here is pure: platform detection takes a user-agent string + a
 * standalone flag, and the show/no-show decision takes a plain state object and
 * the current time. That keeps the React component thin (effects + storage only)
 * and lets the rules be unit-tested without a DOM. Storage helpers mirror the
 * `anon-swipes` SwipeStorage shape so they no-op (rather than throw) on the
 * server or when storage is blocked.
 */

/** How the user can install on their current platform. */
export type InstallPlatform =
  | 'android' // Chromium-based with a beforeinstallprompt event: native prompt.
  | 'ios-safari' // iOS Safari: guide them through the Share sheet.
  | 'ios-other' // iOS Chrome / Firefox / etc: tell them to open Safari.
  | 'unsupported' // Desktop or anything we don't prompt on.

/** Suppress a dismissed prompt for ~7 days before it may reappear. */
export const DISMISS_SUPPRESS_MS = 7 * 24 * 60 * 60 * 1000

/** Lifetime cap: never show the prompt more than this many times in total. */
export const MAX_LIFETIME_SHOWS = 3

/** localStorage key for the persisted install-prompt state. */
export const INSTALL_PROMPT_KEY = 'smartcart.install-prompt.v1'

/**
 * Persisted state for the prompt. `shownCount` is the lifetime total; the two
 * timestamps are epoch millis (0 / undefined when never set).
 */
export interface InstallPromptState {
  /** First time the user reached engaged-enough state (post-onboarding). */
  engagedAt?: number
  /** Last time we showed the prompt. */
  lastShownAt?: number
  /** Last time the user dismissed the prompt. */
  dismissedAt?: number
  /** Lifetime number of times the prompt has been shown. */
  shownCount?: number
}

/** A minimal Storage shape so the helpers can be unit-tested without the DOM. */
export interface InstallStorage {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
}

/** Resolve the browser's localStorage, or null on the server / when blocked. */
export function browserStorage(): InstallStorage | null {
  try {
    if (typeof window === 'undefined') return null
    return window.localStorage
  } catch {
    // Accessing localStorage can throw in some privacy modes.
    return null
  }
}

/**
 * True when the app is running as an installed PWA (home-screen / standalone).
 * Chromium reports this via the `display-mode: standalone` media query; iOS
 * Safari exposes the legacy `navigator.standalone` boolean instead.
 */
/**
 * The slice of `window` `isStandalone` reads, so it can be stubbed in tests.
 * `navigator` is typed loosely (the real DOM `Navigator` has no `standalone`
 * field; it is an iOS-only legacy property) and read defensively below.
 */
export interface StandaloneWindow {
  matchMedia?: (q: string) => { matches: boolean }
  navigator?: unknown
}

export function isStandalone(
  win: StandaloneWindow = typeof window === 'undefined' ? {} : window,
): boolean {
  try {
    const displayStandalone =
      typeof win.matchMedia === 'function' &&
      win.matchMedia('(display-mode: standalone)').matches
    const nav = win.navigator as { standalone?: boolean } | undefined
    const iosStandalone = nav?.standalone === true
    return Boolean(displayStandalone || iosStandalone)
  } catch {
    return false
  }
}

/** True for any iOS / iPadOS device (covers the iPad-as-desktop UA case). */
export function isIos(ua: string): boolean {
  const s = ua || ''
  // iPhone / iPad / iPod, plus iPadOS which now reports as "Macintosh" but is
  // the only "Mac" with a touch screen (Maps over `maxTouchPoints` at the call
  // site; here we match the classic tokens).
  return /iphone|ipad|ipod/i.test(s)
}

/**
 * True for Safari specifically (not Chrome / Firefox / Edge wearing a WebKit
 * shell on iOS). On iOS every browser is WebKit, so we sniff by ruling out the
 * other vendors' UA tokens.
 */
export function isIosSafari(ua: string): boolean {
  if (!isIos(ua)) return false
  const s = ua.toLowerCase()
  // Chrome=CriOS, Firefox=FxiOS, Edge=EdgiOS, Opera=OPiOS/OPT. Any of these means
  // a non-Safari browser that cannot install a PWA.
  const otherBrowser = /crios|fxios|edgios|opios|opt\//.test(s)
  return !otherBrowser
}

/**
 * Resolve which install affordance to offer. `hasBeforeInstallPrompt` is whether
 * we captured a `beforeinstallprompt` event (Chromium only); when true we can do
 * a real native prompt regardless of the exact UA.
 */
export function detectPlatform(
  ua: string,
  hasBeforeInstallPrompt: boolean,
): InstallPlatform {
  if (isIos(ua)) {
    return isIosSafari(ua) ? 'ios-safari' : 'ios-other'
  }
  // Android / desktop Chromium: only meaningful if the browser actually offered
  // us an install event. Without it there is nothing to prompt.
  if (hasBeforeInstallPrompt) return 'android'
  return 'unsupported'
}

/**
 * The show / no-show decision. Pure: takes the platform, the persisted state,
 * whether the user is engaged enough yet, whether we already showed it this
 * session, and the current time.
 *
 * Rules (all must pass):
 *   - platform is one we prompt on (not 'unsupported');
 *   - the user is engaged (post-onboarding / first week);
 *   - we have not already shown it this session;
 *   - lifetime show count is under the cap;
 *   - if previously dismissed, the suppression window has elapsed.
 */
export function shouldShowInstallPrompt(args: {
  platform: InstallPlatform
  state: InstallPromptState
  engaged: boolean
  shownThisSession: boolean
  now: number
}): boolean {
  const { platform, state, engaged, shownThisSession, now } = args

  if (platform === 'unsupported') return false
  if (!engaged) return false
  if (shownThisSession) return false

  const shownCount = state.shownCount ?? 0
  if (shownCount >= MAX_LIFETIME_SHOWS) return false

  if (typeof state.dismissedAt === 'number' && state.dismissedAt > 0) {
    if (now - state.dismissedAt < DISMISS_SUPPRESS_MS) return false
  }

  return true
}

/** Read the persisted state. Returns {} for missing / malformed / absent storage. */
export function readInstallPromptState(
  storage: InstallStorage | null = browserStorage(),
): InstallPromptState {
  if (!storage) return {}
  let raw: string | null
  try {
    raw = storage.getItem(INSTALL_PROMPT_KEY)
  } catch {
    return {}
  }
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed && typeof parsed === 'object') {
      return parsed
    }
    return {}
  } catch {
    return {}
  }
}

/** Persist the state. No-op when storage is absent or write throws (quota). */
export function writeInstallPromptState(
  state: InstallPromptState,
  storage: InstallStorage | null = browserStorage(),
): void {
  if (!storage) return
  try {
    storage.setItem(INSTALL_PROMPT_KEY, JSON.stringify(state))
  } catch {
    // Ignore quota / private-mode write failures; the prompt is best-effort.
  }
}

/**
 * Record that the prompt was shown: bump the lifetime count and stamp the time.
 * Returns the next state (callers persist it).
 */
export function recordShown(
  state: InstallPromptState,
  now: number,
): InstallPromptState {
  return {
    ...state,
    lastShownAt: now,
    shownCount: (state.shownCount ?? 0) + 1,
  }
}

/** Record a dismissal so the suppression window starts now. */
export function recordDismissed(
  state: InstallPromptState,
  now: number,
): InstallPromptState {
  return { ...state, dismissedAt: now }
}

/** Stamp the first-engaged time if not already set (post-onboarding signal). */
export function markEngaged(
  state: InstallPromptState,
  now: number,
): InstallPromptState {
  if (typeof state.engagedAt === 'number' && state.engagedAt > 0) return state
  return { ...state, engagedAt: now }
}
