import { createFileRoute } from '@tanstack/react-router'
import { getAuth } from '../../lib/auth'
import { log } from '../../lib/log'

/**
 * Run a Better Auth request through the catch-all handler with structured logging
 * around it. Better Auth answers most failures (e.g. "Invalid origin", a bad OTP,
 * a waitlisted email) with a non-2xx Response rather than by throwing, so we log
 * the request line plus any >=400 response (carrying the Origin header, which is
 * exactly what an "Invalid origin" rejection turns on). A genuinely thrown error
 * is logged and rethrown so it still reaches Sentry via the global handler.
 */
async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const origin = request.headers.get('origin')
  const ctx = { method: request.method, path: url.pathname, origin }
  try {
    const auth = await getAuth()
    const res = await auth.handler(request)
    if (res.status >= 400) {
      // Read a clone so we never consume the body the client needs.
      let body = ''
      try {
        body = (await res.clone().text()).slice(0, 500)
      } catch {
        // body not readable — fine, the status + origin are the useful bits
      }
      log.warn('auth.request_failed', { ...ctx, status: res.status, body })
    } else {
      log.info('auth.request_ok', { ...ctx, status: res.status })
    }
    return res
  } catch (err) {
    log.error('auth.handler_threw', err, ctx)
    throw err
  }
}

/** Better Auth catch-all handler, mounted at /api/auth/*. */
export const Route = createFileRoute('/api/auth/$')({
  server: {
    handlers: {
      GET: ({ request }) => handle(request),
      POST: ({ request }) => handle(request),
    },
  },
})
