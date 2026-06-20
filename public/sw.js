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

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Focus an already-open Souso tab and navigate it, if we can.
        for (const client of clientList) {
          if ('focus' in client) {
            client.focus()
            if ('navigate' in client) {
              return client.navigate(url)
            }
            return undefined
          }
        }
        // Otherwise open a fresh tab at the deep link.
        if (self.clients.openWindow) {
          return self.clients.openWindow(url)
        }
        return undefined
      }),
  )
})
