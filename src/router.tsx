import { createRouter as createTanStackRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'

export function getRouter() {
  const router = createTanStackRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
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
