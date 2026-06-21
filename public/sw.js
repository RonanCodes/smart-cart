/* Souso service worker — PWA Web Push (#149).
 *
 * Two jobs:
 *   1. `push`            : the push service wakes the worker with our JSON
 *                          payload ({ title, body, url }); show a notification.
 *   2. `notificationclick`: when the user taps it, focus an open Souso tab (or
 *                          open a new one) at the payload's url so they land on
 *                          the week view ready to rate the meal.
 *
 * Deliberately tiny and dependency-free: it is served verbatim from /sw.js and
 * registered client-side from the app. No build step, no precache (the app is
 * SSR + small), just push handling.
 */

self.addEventListener('install', () => {
  // Activate immediately so a freshly-registered worker can receive pushes
  // without waiting for all tabs to close.
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', (event) => {
  let payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch (_e) {
    payload = {}
  }
  const title = payload.title || 'Souso'
  const body = payload.body || 'You have a new notification.'
  const url = payload.url || '/'

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      // Stash the deep-link url so the click handler knows where to go.
      data: { url },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/'
  const target = new URL(url, self.location.origin).href

  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      })
      // App already open: focus it and ASK IT to route. `client.navigate()` is
      // unreliable on iOS Safari PWAs (the deep link silently no-ops), so we
      // postMessage and let the app do client-side routing. A native navigate is
      // attempted too as a best-effort fallback for browsers that honour it.
      for (const client of clientList) {
        await client.focus()
        client.postMessage({ type: 'souso-navigate', url })
        if ('navigate' in client) {
          try {
            await client.navigate(target)
          } catch (_e) {
            /* iOS: ignore, the postMessage above handles routing */
          }
        }
        return
      }
      // App closed: open it at the deep link (works on installed iOS PWAs).
      if (self.clients.openWindow) {
        await self.clients.openWindow(target)
      }
    })(),
  )
})
