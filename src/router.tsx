import { createRouter as createTanStackRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'

export function getRouter() {
  const router = createTanStackRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: 'intent',
    // Keep a preloaded route match fresh for 30s so it is REUSED on the actual
    // navigation instead of re-fetched (#302). With this at 0, every preload was
    // discarded the instant it landed, so `defaultPreload: 'intent'` + the
    // tab-bar's viewport preloads did nothing , each tab tap still blocked on the
    // _authed auth round-trip + the destination loader. Matching the routes'
    // own `staleTime: 30_000` makes the preloaded match (beforeLoad context +
    // batched bootstrap loader) reusable, so a warm tab tap is instant.
    defaultPreloadStaleTime: 30_000,
    // Show a route's pendingComponent quickly on a slow load (#226). The default
    // 1000ms delay means a skeleton almost never appears; 150ms shows it as soon
    // as a navigation is visibly waiting, and the 300ms floor stops it flashing
    // when the loader resolves fast.
    defaultPendingMs: 150,
    defaultPendingMinMs: 300,
  })

  return router
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
