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
import { ErrorBoundary } from '../components/ErrorBoundary'
import { log } from '../lib/log'
import { useSession } from '../lib/auth-client'

const SITE_URL = 'https://smartcart.ronanconnolly.dev'
const SITE_TITLE = 'Souso: your sous chef for recipes and the weekly shop'
const SITE_DESCRIPTION =
  'Souso finds you recipes you will love, learns how your household eats, and fills a ready-to-order basket at Albert Heijn or Jumbo in under a minute. You just check out.'

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
      // #FBF7EF is the warm off-white the app canvas uses (the --background token,
      // oklch(0.99 0.006 120)); matching it here means the notch reads as part of
      // the app chrome instead of a white bar. One meta only: the app defaults to
      // light, and TanStack's HeadContent dedupes metas by `name`, so a second
      // media-scoped theme-color is unreliable. Installed/dark PWAs still get the
      // warm tone from the manifest theme_color.
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
      { title: SITE_TITLE },
      { name: 'description', content: SITE_DESCRIPTION },
      { property: 'og:title', content: SITE_TITLE },
      { property: 'og:description', content: SITE_DESCRIPTION },
      { property: 'og:type', content: 'website' },
      { property: 'og:url', content: SITE_URL },
      { name: 'twitter:card', content: 'summary_large_image' },
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
      { rel: 'icon', href: '/favicon.ico', sizes: 'any' },
      {
        rel: 'icon',
        type: 'image/png',
        sizes: '32x32',
        href: '/favicon-32x32.png',
      },
      {
        rel: 'icon',
        type: 'image/png',
        sizes: '16x16',
        href: '/favicon-16x16.png',
      },
      {
        rel: 'apple-touch-icon',
        sizes: '180x180',
        href: '/apple-touch-icon.png',
      },
      { rel: 'manifest', href: '/site.webmanifest' },
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
  }, [session?.user.id, session?.user.email])

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
    const onError = (e: ErrorEvent) =>
      log.error('window.error', e.error ?? e.message, {
        filename: e.filename,
        lineno: e.lineno,
      })
    const onRejection = (e: PromiseRejectionEvent) =>
      log.error('window.unhandledrejection', e.reason)
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      swContainer?.removeEventListener('message', onSwMessage)
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [])

  return (
    <RootDocument>
      <ErrorBoundary>
        <QueryClientProvider>
          <Outlet />
        </QueryClientProvider>
      </ErrorBoundary>
    </RootDocument>
  )
}
