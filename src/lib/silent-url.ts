/**
 * Rewrite the browser address bar WITHOUT telling TanStack Router.
 *
 * The in-place swap flow (#236) updates the week in optimistic local state and
 * then only wants the URL to reflect the new plan id (for shareability + the
 * back button). It must NOT re-run the route loader, because that fires the
 * route's full-page WeekSkeleton pendingComponent and jumps scroll to the top.
 *
 * The catch (#week-swap-skeleton): TanStack Router's browser history
 * monkey-patches `window.history.pushState` / `window.history.replaceState` on
 * the `window.history` INSTANCE so it can observe out-of-band URL changes. So a
 * plain `window.history.replaceState(...)` no longer slips past the router — the
 * patched method notifies the router's history subscribers, the router re-reads
 * the now-changed `?plan=` search param, sees `loaderDeps.plan` changed, and
 * re-runs the loader → the full-page skeleton flashes on every swap.
 *
 * The fix is to call the ORIGINAL, unpatched `replaceState`. The router patches
 * the method as an OWN property on the `window.history` object, which shadows
 * the native `History.prototype.replaceState`; the prototype method is still the
 * pristine browser one. Calling it (bound to `window.history`) updates the
 * address bar with zero router involvement, which is exactly the #236 intent.
 */
export function replaceUrlSilently(url: string): void {
  if (typeof window === 'undefined') return
  const proto = Object.getPrototypeOf(window.history) as History
  // The prototype method is the native, unpatched replaceState. Fall back to the
  // instance method only if the prototype somehow lacks it (non-browser shim).
  const native =
    typeof proto.replaceState === 'function'
      ? proto.replaceState
      : window.history.replaceState
  native.call(window.history, window.history.state, '', url)
}
