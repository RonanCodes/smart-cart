import { useEffect } from 'react'
import type { ReactNode } from 'react'
import {
  Outlet,
  createRootRoute,
  HeadContent,
  Scripts,
} from '@tanstack/react-router'
import appCss from '../styles.css?url'
import { DevBanner } from '../components/DevBanner'
import { registerServiceWorker } from '../lib/push-client'

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
        <DevBanner />
        <Scripts />
      </body>
    </html>
  )
}

function RootComponent() {
  // Register the PWA service worker once on the client (guarded; no-op in SSR or
  // browsers without service workers). It powers Web Push rating reminders (#149)
  // and makes the manifest-declared app installable.
  useEffect(() => {
    void registerServiceWorker()
  }, [])

  return (
    <RootDocument>
      <Outlet />
    </RootDocument>
  )
}
