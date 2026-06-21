import * as React from 'react'
import { Share, X, Download } from 'lucide-react'
import { cn } from '#/lib/utils'
import { Button } from '#/components/ui/button'
import {
  detectPlatform,
  isStandalone,
  markEngaged,
  readInstallPromptState,
  recordDismissed,
  recordShown,
  shouldShowInstallPrompt,
  writeInstallPromptState,
} from '#/lib/pwa-install'
import type { InstallPlatform } from '#/lib/pwa-install'

/**
 * InstallPrompt , a dismissible bottom card that nudges the user to add Souso to
 * their home screen. Mounted ONCE inside AppShell (the app chrome), so by the
 * time it renders the user is already past onboarding; we treat reaching the
 * shell as the engagement signal and stamp it the first time.
 *
 * It never shows on first paint: it waits a short beat, then asks the pure
 * `shouldShowInstallPrompt` decision (platform + engagement + dismissal window +
 * lifetime cap + standalone). The native path (Android / Chromium) replays the
 * captured `beforeinstallprompt` event from the 'Install' button; iOS gets a
 * guided instruction because there is no install API there.
 *
 * All the rules live in `#/lib/pwa-install` (pure + unit-tested); this component
 * only owns effects, the captured event, and the visual card.
 */

/** The minimal shape of the `beforeinstallprompt` event we rely on. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

/** Wait this long after mount before considering a show (not on first paint). */
const SHOW_DELAY_MS = 4000

export function InstallPrompt() {
  const [visible, setVisible] = React.useState(false)
  const [platform, setPlatform] = React.useState<InstallPlatform>('unsupported')
  const deferredRef = React.useRef<BeforeInstallPromptEvent | null>(null)
  // One show per session: a module-scope ref via component lifetime is enough,
  // since AppShell mounts InstallPrompt once for the session.
  const shownThisSessionRef = React.useRef(false)

  // Stamp engagement as soon as the shell renders (post-onboarding). Pure write,
  // safe on the server (storage helpers no-op there).
  React.useEffect(() => {
    const state = readInstallPromptState()
    writeInstallPromptState(markEngaged(state, Date.now()))
  }, [])

  // Capture beforeinstallprompt (Chromium) and hide on appinstalled.
  React.useEffect(() => {
    if (typeof window === 'undefined') return

    function onBeforeInstallPrompt(e: Event) {
      // Stop Chrome's default mini-infobar so we control the timing.
      e.preventDefault()
      deferredRef.current = e as BeforeInstallPromptEvent
    }
    function onAppInstalled() {
      deferredRef.current = null
      setVisible(false)
    }

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
    window.addEventListener('appinstalled', onAppInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
      window.removeEventListener('appinstalled', onAppInstalled)
    }
  }, [])

  // After a short beat, decide whether to show. Not on first paint.
  React.useEffect(() => {
    if (typeof window === 'undefined') return

    const timer = window.setTimeout(() => {
      if (isStandalone()) return // installed already; never nag.

      const ua = window.navigator.userAgent
      const resolved = detectPlatform(ua, deferredRef.current !== null)
      const state = readInstallPromptState()

      const ok = shouldShowInstallPrompt({
        platform: resolved,
        state,
        engaged: typeof state.engagedAt === 'number',
        shownThisSession: shownThisSessionRef.current,
        now: Date.now(),
      })

      if (!ok) return

      shownThisSessionRef.current = true
      setPlatform(resolved)
      setVisible(true)
      writeInstallPromptState(recordShown(state, Date.now()))
    }, SHOW_DELAY_MS)

    return () => window.clearTimeout(timer)
  }, [])

  const dismiss = React.useCallback(() => {
    setVisible(false)
    writeInstallPromptState(
      recordDismissed(readInstallPromptState(), Date.now()),
    )
  }, [])

  const onInstall = React.useCallback(async () => {
    const deferred = deferredRef.current
    if (!deferred) return
    deferredRef.current = null
    try {
      await deferred.prompt()
      await deferred.userChoice
    } catch {
      // The browser may reject a stale prompt; just close the card.
    }
    setVisible(false)
  }, [])

  if (!visible) return null

  return (
    <div
      // Sit above the tab bar (its height + safe area), pinned to the same
      // phone-width column as the rest of the chrome.
      className="app-tabbar fixed inset-x-0 z-40 px-4"
      style={{
        bottom: 'calc(var(--tab-bar-height) + var(--safe-bottom) + 0.75rem)',
      }}
    >
      <div
        role="dialog"
        aria-label="Add Souso to your home screen"
        className={cn(
          'bg-card text-card-foreground mx-auto w-full max-w-md',
          'border-hairline rounded-2xl border p-4 shadow-2xl',
          'flex items-start gap-3',
        )}
      >
        <div className="bg-secondary text-primary flex h-10 w-10 shrink-0 items-center justify-center rounded-full">
          {platform === 'android' ? (
            <Download className="h-5 w-5" aria-hidden />
          ) : (
            <Share className="h-5 w-5" aria-hidden />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Add Souso to your home screen</p>
          <PromptBody platform={platform} />

          {platform === 'android' && (
            <div className="mt-3">
              <Button size="sm" onClick={onInstall}>
                Install
              </Button>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="text-muted-foreground hover:text-foreground -mt-1 -mr-1 shrink-0 rounded-full p-1.5 transition active:scale-95"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </div>
  )
}

/** The platform-specific instruction line under the title. */
function PromptBody({ platform }: { platform: InstallPlatform }) {
  if (platform === 'android') {
    return (
      <p className="text-muted-foreground mt-0.5 text-[0.8rem] leading-snug">
        Install Souso for a faster, full-screen app you can open straight from
        your home screen.
      </p>
    )
  }
  if (platform === 'ios-safari') {
    return (
      <p className="text-muted-foreground mt-0.5 text-[0.8rem] leading-snug">
        Tap the Share icon{' '}
        <Share className="inline h-3.5 w-3.5 -translate-y-px" aria-hidden />,
        then choose Add to Home Screen.
      </p>
    )
  }
  // ios-other (Chrome / Firefox on iOS): only Safari can install.
  return (
    <p className="text-muted-foreground mt-0.5 text-[0.8rem] leading-snug">
      Open souso.app in Safari to add it to your home screen.
    </p>
  )
}
