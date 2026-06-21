import { Component } from 'react'
import type { ReactNode, ErrorInfo } from 'react'
import * as Sentry from '@sentry/react'
import { UtensilsCrossed } from 'lucide-react'
import { log } from '#/lib/log'

interface Props {
  children: ReactNode
}
interface State {
  hasError: boolean
}

/** sessionStorage guard so a stale-chunk reload happens at most once per episode
 * (a genuinely missing chunk must not infinite-loop). Cleared after a clean run
 * in __root, so a LATER deploy's stale chunk can recover again. */
export const CHUNK_RELOAD_KEY = 'souso:chunk-reload'

/**
 * A stale code-split chunk after a deploy: the open tab references a JS chunk
 * hash the new build no longer serves, so a dynamic import() fails. iOS Safari
 * says "Importing a module script failed"; Chrome "Failed to fetch dynamically
 * imported module"; webpack "ChunkLoadError". Deliberately NOT matching the bare
 * "Load failed" (that is also any network fetch) to avoid spurious reloads.
 */
export function isChunkLoadError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error ?? '')
  return /Importing a module script failed|Failed to fetch dynamically imported module|error loading dynamically imported module|module script failed|ChunkLoadError/i.test(
    msg,
  )
}

/**
 * On a stale-chunk error, hard-reload ONCE so the tab picks up the new build.
 * Returns true if it triggered a reload (caller should stop). Guarded by
 * CHUNK_RELOAD_KEY so a chunk that is genuinely gone can't loop forever.
 */
export function reloadOnceForChunkError(error: unknown): boolean {
  if (typeof window === 'undefined' || !isChunkLoadError(error)) return false
  try {
    if (sessionStorage.getItem(CHUNK_RELOAD_KEY)) return false
    sessionStorage.setItem(CHUNK_RELOAD_KEY, '1')
  } catch {
    // sessionStorage unavailable (private mode): don't reload unguarded.
    return false
  }
  window.location.reload()
  return true
}

/**
 * App-wide React error boundary. Catches render/lifecycle errors anywhere below
 * it, logs them (-> Workers Logs via the client ship), and shows a recoverable
 * fallback instead of a blank white screen. Mounted at the root around <Outlet/>.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Stale code-split chunk after a deploy (the open tab references an old chunk
    // hash the new build dropped): hard-reload once to the new build instead of
    // looping on the boundary (#chunk-reload, the iOS-Safari "flashing" crash).
    if (reloadOnceForChunkError(error)) return
    // Ships to /api/log -> Workers Logs AND (now) server-side Sentry forward.
    // This is the path that ALWAYS reaches Sentry, even when the browser SDK is
    // blocked by an ad-blocker, because the beacon is same-origin. UA + url make
    // an anonymous (signed-out, pre-login) crash diagnosable without an account.
    log.error('react.error_boundary', error, {
      componentStack: info.componentStack,
      userAgent:
        typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
      url: typeof window !== 'undefined' ? window.location.href : undefined,
    })
    // Best-effort direct client capture too (free; may be ad-blocker-blocked).
    try {
      Sentry.captureException(error, {
        extra: { componentStack: info.componentStack },
      })
    } catch {
      // never let telemetry break the fallback render (diagnose canon)
    }
  }

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
        <div
          className="bg-secondary text-primary flex h-16 w-16 items-center justify-center rounded-full"
          aria-hidden
        >
          <UtensilsCrossed className="h-7 w-7" />
        </div>
        <p className="text-sm font-medium">Something went wrong.</p>
        <p className="text-muted-foreground text-xs">
          We&apos;ve logged it. Try reloading.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="bg-primary text-primary-foreground rounded-full px-4 py-2 text-sm font-medium active:scale-95"
        >
          Reload
        </button>
      </div>
    )
  }
}
