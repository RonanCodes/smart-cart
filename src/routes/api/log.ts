import { createFileRoute } from '@tanstack/react-router'
import { forwardErrorToSentry } from '#/lib/sentry-server-forward'

/**
 * POST /api/log, ingest a client-side log event and re-emit it server-side so
 * real-user browser errors land in Cloudflare Workers Logs. The browser ships
 * `warn`/`error` here via `log.ts`'s sendBeacon.
 *
 * `error`-level entries are ALSO forwarded to Sentry server-side (a direct
 * envelope POST to the Sentry ingest URL). This is the unblockable path: the
 * browser Sentry transport is blocked by ad-blockers (Brave shields, uBlock),
 * but a same-origin beacon to `/api/log` is not, and the Worker -> Sentry hop
 * runs server-side where no ad-blocker can touch it. So an error boundary firing
 * ALWAYS reaches Sentry, even when the client SDK is blocked.
 *
 * Best-effort: never errors, always 204, so a logging failure can't cascade into
 * the app (diagnose canon).
 */
export const Route = createFileRoute('/api/log')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = (await request.json().catch(() => null)) as Record<
            string,
            unknown
          > | null
          if (body) {
            const level = body.level === 'error' ? 'error' : 'warn'
            // Tag as client-origin and emit one JSON line -> Workers Logs.
            const line = JSON.stringify({ source: 'client-ship', ...body })
            if (level === 'error') console.error(line)
            else console.warn(line)

            // Errors ALSO go to Sentry server-side (unblockable by ad-blockers).
            // Fire-and-forget: the route handler has no easy access to the CF
            // execution context for `waitUntil`, so we don't await it — the
            // forward is fully guarded and never throws, and the 204 returns
            // immediately. `keepalive`-style behaviour isn't needed because the
            // Worker outlives this synchronous handler frame.
            if (level === 'error') void forwardErrorToSentry(body)
          }
        } catch {
          // swallow — logging must never throw into the request path
        }
        return new Response(null, { status: 204 })
      },
    },
  },
})
