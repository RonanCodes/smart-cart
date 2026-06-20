import { createFileRoute } from '@tanstack/react-router'

/**
 * POST /api/log, ingest a client-side log event and re-emit it server-side so
 * real-user browser errors land in Cloudflare Workers Logs (we have no Sentry /
 * PostHog wired yet). The browser ships `warn`/`error` here via `log.ts`'s
 * sendBeacon. Best-effort: never errors, always 204, so a logging failure can't
 * cascade into the app (diagnose canon).
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
          }
        } catch {
          // swallow — logging must never throw into the request path
        }
        return new Response(null, { status: 204 })
      },
    },
  },
})
