import '#/lib/braintrust-ai'
import {
  createStartHandler,
  defaultStreamHandler,
} from '@tanstack/react-start/server'
import type { Register } from '@tanstack/react-router'
import type { RequestHandler } from '@tanstack/react-start/server'

const fetch = createStartHandler(defaultStreamHandler)

export type ServerEntry = { fetch: RequestHandler<Register> }

/**
 * Try to pull a Cloudflare `ExecutionContext` out of the fetch args so a
 * best-effort Sentry POST can run in `ctx.waitUntil` (survives the response
 * returning) instead of blocking. The handler args are `(request, env, ctx)` in a
 * Worker; in other adapters the ctx may be absent, so this is fully defensive.
 */
function execCtxFrom(args: Array<unknown>): ExecutionContext | undefined {
  const ctx = args.find(
    (a): a is ExecutionContext =>
      !!a &&
      typeof a === 'object' &&
      typeof (a as { waitUntil?: unknown }).waitUntil === 'function',
  )
  return ctx
}

/**
 * TanStack Start's `createStartHandler` hardcodes this exact body + 500 status
 * when a request's `Accept` header doesn't include `text/html` or a wildcard
 * (see `executeRouter` in `@tanstack/start-server-core`). That's a content-
 * negotiation mismatch — e.g. a scanner/SSE client probing any route with
 * `Accept: text/event-stream` — not a server failure, so it must not be
 * reported as one (the `/sse` worker-log finding: every such probe was logged
 * and Sentry-reported as a server error).
 */
const UNSUPPORTED_ACCEPT_MESSAGE = 'Only HTML requests are supported here'

/**
 * Detect the framework's unsupported-Accept 500 by its exact body, and if
 * found, reclassify it as the 406 Not Acceptable it actually is instead of a
 * server error. Reads a clone so the original response body is untouched for
 * every other case. Never throws: a body-read failure just means "not this".
 */
async function asContentNegotiationMismatch(
  res: Response,
): Promise<Response | undefined> {
  if (res.status !== 500) return undefined
  try {
    const body: { error?: unknown } = await res.clone().json()
    if (body.error !== UNSUPPORTED_ACCEPT_MESSAGE) return undefined
  } catch {
    return undefined
  }
  return Response.json({ error: UNSUPPORTED_ACCEPT_MESSAGE }, { status: 406 })
}

/**
 * Server-side Sentry capture for unhandled server errors (server-hardening). The
 * real 500s on gated `/_serverFn/*` calls were never reaching Sentry — only
 * client errors were. This is the most central safe point: every request flows
 * through this one fetch wrapper.
 *
 * Behaviour is UNCHANGED — we only additionally report:
 *  - a THROWN error is captured, then rethrown as-is;
 *  - a 500 response is captured, then returned as-is.
 * The one exception is the framework's content-negotiation 500 (above), which
 * is reclassified to 406 and never reported — it isn't a server error.
 * Capture is fire-and-forget and `captureServerError` never throws (diagnose
 * canon: observability must never crash a request), so this can't break the path.
 */
export function createServerEntry(entry: ServerEntry): ServerEntry {
  return {
    async fetch(...args) {
      const report = (
        err: { name?: unknown; message?: unknown; stack?: unknown },
        context: { url?: string; status?: number },
      ) => {
        void (async () => {
          const { captureServerError } =
            await import('#/lib/sentry-server-forward')
          const p = captureServerError(err, context)
          const ctx = execCtxFrom(args)
          if (ctx) ctx.waitUntil(p)
          else await p
        })().catch(() => {
          // never let observability crash the request path
        })
      }

      const req: unknown = args[0]
      const url =
        req && typeof req === 'object' && 'url' in req
          ? String(req.url)
          : undefined

      try {
        const res = await entry.fetch(...args)
        const mismatch = await asContentNegotiationMismatch(res)
        if (mismatch) return mismatch
        // A 500 (the gated-page failure mode) is reported but returned untouched.
        if (res.status >= 500) {
          report(
            { name: 'ServerErrorResponse', message: `HTTP ${res.status}` },
            { url, status: res.status },
          )
        }
        return res
      } catch (err) {
        report(
          err instanceof Error
            ? { name: err.name, message: err.message, stack: err.stack }
            : { message: String(err) },
          { url },
        )
        throw err
      }
    },
  }
}

/**
 * The Worker default export: the TanStack fetch handler PLUS a Cloudflare cron
 * `scheduled()` handler (Part C). Cloudflare invokes `scheduled(controller, env,
 * ctx)` on each cron tick (every 15 min, see wrangler.jsonc `triggers.crons`);
 * we run the nudge orchestration inside `ctx.waitUntil` so the Worker stays alive
 * until the async sends finish.
 *
 * `runScheduledNudges` lives in a server-only module reached via a dynamic import
 * so its DB / WebCrypto / `cloudflare:workers` deps never enter the static client
 * graph (the build trap: a static import of a Worker-only module from anything in
 * the client bundle breaks the build). The handler reads env the Worker way (DB +
 * VAPID come from the `cloudflare:workers` env binding inside the import chain).
 */
export default {
  ...createServerEntry({ fetch }),
  async scheduled(
    _controller: ScheduledController,
    _env: unknown,
    ctx: ExecutionContext,
  ): Promise<void> {
    ctx.waitUntil(
      (async () => {
        const { runScheduledNudges } = await import('#/lib/scheduled-nudges')
        await runScheduledNudges()
      })(),
    )
  },
}
