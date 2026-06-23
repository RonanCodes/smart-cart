import { Component, useState } from 'react'
import type { ReactNode, ErrorInfo } from 'react'
import * as Sentry from '@sentry/react'
import { MessageCircle, UtensilsCrossed } from 'lucide-react'
import { log } from '#/lib/log'
import { Sheet } from '#/components/ui/sheet'
import { FeedbackForm } from '#/components/feedback/FeedbackForm'

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
 * The same-class sibling of a stale chunk, seen as Sentry SOUSO-T on /week (#416):
 * a TanStack Router lazy-route MATCH resolved before its route entry's options
 * chunk was ready, so the router's Match render read `route.options.component`
 * with `route.options` momentarily undefined and threw
 * `Cannot read properties of undefined (reading 'component')` (Chrome) /
 * `route.options is undefined` (Firefox) / `undefined is not an object (evaluating
 * 'route.options.component')` (Safari). It clusters with the SOUSO-D/M/P
 * "Importing a module script failed" deploy-churn misses from the same window: a
 * deploy re-hashes chunks, an open tab navigates to /week, and the match lands a
 * tick before its component chunk. A one-time hard reload picks up the consistent
 * new build and the route resolves cleanly, exactly like the chunk-miss self-heal.
 *
 * Matched narrowly (the read must be of `component`/`options`, optionally on
 * `route`/`match`) so a genuine app bug reading some OTHER undefined property
 * still surfaces the boundary rather than silently reload-looping.
 */
export function isRouteResolveRaceError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error ?? '')
  return /reading '(?:component|options)'|(?:route|match)\.options(?:\.component)? is undefined|evaluating '(?:route|match)\.options(?:\.component)?'/i.test(
    msg,
  )
}

/**
 * Both transient build/route-resolution faults that a one-time reload recovers:
 * the stale code-split chunk (#369) and the lazy-route match-resolve race (#416).
 * A genuine app error matches neither and stays on the boundary.
 */
export function isRecoverableLoadError(error: unknown): boolean {
  return isChunkLoadError(error) || isRouteResolveRaceError(error)
}

/**
 * On a transient stale-chunk OR route-resolve-race error, hard-reload ONCE so the
 * tab picks up a consistent new build. Returns true if it triggered a reload
 * (caller should stop). Guarded by CHUNK_RELOAD_KEY so a genuinely-gone chunk (or
 * a race that doesn't clear on reload) can't loop forever.
 */
export function reloadOnceForChunkError(error: unknown): boolean {
  if (typeof window === 'undefined' || !isRecoverableLoadError(error))
    return false
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
    // Transient build/route-resolution fault: a stale code-split chunk after a
    // deploy (#chunk-reload, the iOS-Safari "flashing" crash) OR a lazy-route
    // match-resolve race where the router read `route.options.component` off an
    // undefined options chunk (#416 SOUSO-T on /week). Both recover by hard-
    // reloading ONCE to a consistent new build instead of looping on the boundary.
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
      // Tag the pathname so a minified, frame-less crash (e.g. the /week
      // RangeError #382, whose stack didn't survive minification) is still
      // attributable to a route in Sentry without an app stack frame.
      const pathname =
        typeof window !== 'undefined' ? window.location.pathname : undefined
      Sentry.captureException(error, {
        tags: pathname ? { route: pathname } : undefined,
        extra: { componentStack: info.componentStack },
      })
    } catch {
      // never let telemetry break the fallback render (diagnose canon)
    }
  }

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children
    return <ErrorFallback />
  }
}

/**
 * The crash-screen fallback. Beyond "reload", it offers the feedback pull-up so a
 * user who hits the boundary can tell us what they were doing, the most useful
 * signal on a screen that, by definition, has no other context. Reuses the shared
 * `FeedbackForm` (the same form behind the tab-bar FAB) in a bottom Sheet, tagged
 * `source: 'error-boundary'` so these reports are triageable as crash reports.
 *
 * A function component (so it can own the sheet's open state with a hook) rendered
 * by the class boundary's `render`.
 */
function ErrorFallback() {
  const [feedbackOpen, setFeedbackOpen] = useState(false)
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
      <button
        type="button"
        onClick={() => setFeedbackOpen(true)}
        className="text-muted-foreground inline-flex items-center gap-1.5 text-xs font-medium underline-offset-2 hover:underline"
      >
        <MessageCircle className="h-3.5 w-3.5" aria-hidden />
        Something is not right? Tell us
      </button>

      <Sheet
        open={feedbackOpen}
        onOpenChange={setFeedbackOpen}
        title="Tell us what happened"
      >
        <FeedbackForm
          source="error-boundary"
          onDone={() => setFeedbackOpen(false)}
        />
      </Sheet>
    </div>
  )
}
