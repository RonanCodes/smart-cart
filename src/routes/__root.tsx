import { useEffect } from 'react'
import type { ReactNode } from 'react'
import {
  Outlet,
  createRootRoute,
  HeadContent,
  Scripts,
} from '@tanstack/react-router'
import appCss from '../styles.css?url'
import { registerServiceWorker } from '../lib/push-client'
import { QueryClientProvider } from '../lib/query-client'
import {
  ErrorBoundary,
  reloadOnceForChunkError,
  CHUNK_RELOAD_KEY,
} from '../components/ErrorBoundary'
import { log } from '../lib/log'
import { useSession } from '../lib/auth-client'
import { IS_DEV_ENV } from '../lib/app-env'
import { DevEnvRibbon } from '../components/DevEnvRibbon'

const SITE_URL = 'https://smartcart.ronanconnolly.dev'
const SITE_TITLE = 'Souso: your sous chef for recipes and the weekly shop'
const SITE_DESCRIPTION =
  'Souso finds you recipes you will love, learns how your household eats, and fills a ready-to-order basket at Albert Heijn or Jumbo in under a minute. You just check out.'

/**
 * Favicon + apple-touch + manifest <link>s. On the dev deployment we serve the
 * DEV-badged icon variants (`*-dev.png`) and a dev manifest (`site.dev.webmanifest`)
 * so the browser favicon and an installed dev PWA are obviously not prod. Prod
 * keeps the exact links it has always shipped. The branch is on IS_DEV_ENV, a
 * build-time-constant boolean, so the prod bundle dead-code-eliminates the dev
 * arm entirely (no dev icon URLs ship to prod).
 */
function devOrProdIconLinks() {
  if (IS_DEV_ENV) {
    return [
      { rel: 'icon', href: '/favicon-dev.svg?v=6', sizes: 'any' },
      { rel: 'icon', type: 'image/svg+xml', href: '/favicon-dev.svg?v=6' },
      {
        rel: 'icon',
        type: 'image/png',
        sizes: '32x32',
        href: '/favicon-32x32-dev.png?v=6',
      },
      {
        rel: 'icon',
        type: 'image/png',
        sizes: '16x16',
        href: '/favicon-16x16-dev.png?v=6',
      },
      {
        rel: 'apple-touch-icon',
        sizes: '180x180',
        href: '/apple-touch-icon-dev.png?v=6',
      },
      { rel: 'manifest', href: '/site.dev.webmanifest' },
    ]
  }
  return [
    { rel: 'icon', href: '/favicon.ico?v=6', sizes: 'any' },
    { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg?v=6' },
    {
      rel: 'icon',
      type: 'image/png',
      sizes: '32x32',
      href: '/favicon-32x32.png?v=6',
    },
    {
      rel: 'icon',
      type: 'image/png',
      sizes: '16x16',
      href: '/favicon-16x16.png?v=6',
    },
    {
      rel: 'apple-touch-icon',
      sizes: '180x180',
      href: '/apple-touch-icon.png?v=6',
    },
    { rel: 'manifest', href: '/site.webmanifest' },
  ]
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      {
        name: 'viewport',
        content:
          'width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=1',
      },
      // Status-bar / notch theming. iOS Safari (the browser PWA tab, before an
      // app is installed) paints the top safe-area from <meta name="theme-color">,
      // NOT the manifest theme_color. Without this the notch rendered pure white.
      // #F5F1E7 is the Souso cream ground (the --background token); matching it
      // here means the notch reads as part of the app chrome instead of a white
      // bar. One meta only: the app defaults to light, and TanStack's HeadContent
      // dedupes metas by `name`, so a second media-scoped theme-color is
      // unreliable. Installed/dark PWAs still get the cream from the manifest
      // theme_color.
      {
        name: 'theme-color',
        content: '#F5F1E7',
      },
      // Translucent status bar on an installed iOS PWA so the safe-area inset
      // background (set in SafeArea) shows through under the notch.
      {
        name: 'apple-mobile-web-app-capable',
        content: 'yes',
      },
      {
        name: 'apple-mobile-web-app-status-bar-style',
        content: 'default',
      },
      // The installed-PWA home-screen name on iOS (falls back to <title>, which
      // is the long marketing string). Keep it the short brand name; on the dev
      // deployment append DEV so the home-screen label is distinct too. Baked at
      // build time via IS_DEV_ENV, so prod always reads plain "Souso".
      {
        name: 'apple-mobile-web-app-title',
        content: IS_DEV_ENV ? 'Souso DEV' : 'Souso',
      },
      { title: SITE_TITLE },
      { name: 'description', content: SITE_DESCRIPTION },
      { property: 'og:title', content: SITE_TITLE },
      { property: 'og:description', content: SITE_DESCRIPTION },
      { property: 'og:type', content: 'website' },
      { property: 'og:url', content: SITE_URL },
      { property: 'og:site_name', content: 'Souso' },
      // Share-card image (link previews on iMessage/Slack/WhatsApp/X). Absolute
      // URL, the Souso brand card (toque mark + wordmark on cream).
      // summary_large_image renders it wide.
      { property: 'og:image', content: `${SITE_URL}/og-card.png?v=4` },
      { property: 'og:image:width', content: '1200' },
      { property: 'og:image:height', content: '630' },
      {
        property: 'og:image:alt',
        content: 'Souso, your sous chef for recipes and the weekly shop',
      },
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:image', content: `${SITE_URL}/og-card.png?v=4` },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      {
        rel: 'preload',
        as: 'font',
        type: 'font/woff2',
        href: '/fonts/outfit.woff2',
        crossOrigin: 'anonymous',
      },
      {
        rel: 'preload',
        as: 'font',
        type: 'font/woff2',
        href: '/fonts/schoolbell.woff2',
        crossOrigin: 'anonymous',
      },
      // Icons + manifest. On the dev deployment (dev.souso.app) we point at the
      // DEV-badged variants and a dev manifest so an installed dev PWA and the
      // browser favicon are visibly distinct from prod. IS_DEV_ENV is baked at
      // build time, so prod ALWAYS gets the unchanged prod icons below.
      ...devOrProdIconLinks(),
    ],
  }),
  component: RootComponent,
})

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}

function RootComponent() {
  // Attach the signed-in user (id + email) to Sentry so every client event shows
  // WHO hit it; clear to anonymous when signed out. The setter is a no-op until
  // initObservability() has run and a no-op in dev where Sentry is off (#284).
  const { data: session } = useSession()
  useEffect(() => {
    void import('../lib/observability-client').then(
      ({ setObservabilityUser }) => setObservabilityUser(session?.user ?? null),
    )
    // Depend on the user object itself (not user.id/.email): prod telemetry
    // showed session can be truthy while session.user is undefined, and reading
    // `.user.id` in the deps array then crashed the whole app (#root-crash).
  }, [session?.user])

  // Register the PWA service worker once on the client (guarded; no-op in SSR or
  // browsers without service workers). It powers Web Push rating reminders (#149)
  // and makes the manifest-declared app installable.
  useEffect(() => {
    // Sentry + PostHog (prod only); linked so an error pivots to a session replay.
    void import('../lib/observability-client').then(({ initObservability }) =>
      initObservability(),
    )
    void registerServiceWorker()
    // The service worker asks us to deep-link when a push notification is tapped
    // (client.navigate is unreliable on iOS PWAs, so the SW postMessages instead).
    // Hard-navigate so the gated /rate route loads with the session — bulletproof
    // across browsers vs. a client-side router push from a cold tap.
    const onSwMessage = (e: MessageEvent) => {
      const data = e.data as { type?: string; url?: string } | null
      if (data?.type === 'souso-navigate' && typeof data.url === 'string') {
        window.location.assign(data.url)
      }
    }
    const swContainer =
      'serviceWorker' in navigator ? navigator.serviceWorker : null
    swContainer?.addEventListener('message', onSwMessage)
    // Global client error catchers -> logger -> /api/log -> Workers Logs.
    // Both first try the one-time self-heal reload (#369 + #416): the /week
    // lazy-route match-resolve race surfaces in an `async Promise.all` frame
    // (Sentry SOUSO-T), so it can escape the React boundary as a window error /
    // unhandled rejection. reloadOnceForChunkError is guarded + a no-op for any
    // non-recoverable error, so a genuine bug still falls through to the log.
    const onError = (e: ErrorEvent) => {
      if (reloadOnceForChunkError(e.error ?? e.message)) return
      log.error('window.error', e.error ?? e.message, {
        filename: e.filename,
        lineno: e.lineno,
      })
    }
    const onRejection = (e: PromiseRejectionEvent) => {
      if (reloadOnceForChunkError(e.reason)) return
      log.error('window.unhandledrejection', e.reason)
    }
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    // Vite fires this when a code-split chunk preload fails (the stale-chunk case
    // after a deploy). Catch it BEFORE React renders the error boundary, so the
    // tab reloads to the new build with no "flashing" loop (#chunk-reload).
    const onPreloadError = (e: Event) => {
      e.preventDefault()
      reloadOnceForChunkError(
        new Error('Failed to fetch dynamically imported module'),
      )
    }
    window.addEventListener('vite:preloadError', onPreloadError)
    // A clean run means the new build loaded fine; clear the once-per-episode
    // guard so a LATER deploy's stale chunk can recover too.
    const clearGuard = window.setTimeout(() => {
      try {
        sessionStorage.removeItem(CHUNK_RELOAD_KEY)
      } catch {
        // sessionStorage unavailable; nothing to clear.
      }
    }, 10_000)
    return () => {
      swContainer?.removeEventListener('message', onSwMessage)
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
      window.removeEventListener('vite:preloadError', onPreloadError)
      window.clearTimeout(clearGuard)
    }
  }, [])

  return (
    <RootDocument>
      {/* App-wide DEV / LOCAL indicator. Renders nothing on prod (gated on
          appEnv(), baked at build time), so souso.app is never badged. */}
      <DevEnvRibbon />
      <ErrorBoundary>
        <QueryClientProvider>
          <Outlet />
        </QueryClientProvider>
      </ErrorBoundary>
    </RootDocument>
  )
}
