import '#/lib/braintrust-ai'
import {
  createStartHandler,
  defaultStreamHandler,
} from '@tanstack/react-start/server'
import type { Register } from '@tanstack/react-router'
import type { RequestHandler } from '@tanstack/react-start/server'

const fetch = createStartHandler(defaultStreamHandler)

/**
 * Re-export the live-count Durable Object so it surfaces as a NAMED export of
 * the deployed Worker module (wrangler resolves the COUNTER_DO binding's
 * `class_name` against the module's exports). Verified with
 * `wrangler deploy --dry-run`: re-exporting from this entry is enough, no
 * separate custom entry was needed.
 */
export { CounterDO } from '#/lib/live-count/counter-do'

export type ServerEntry = { fetch: RequestHandler<Register> }

/** The path the landing opens its live-count WebSocket against. */
const LIVE_COUNT_PATH = '/api/live-count'

/** The single global counter instance every client and the signup hook share. */
const LIVE_COUNT_DO_NAME = 'global'

/**
 * The slice of the Worker env this entry touches: just the CounterDO binding
 * (wired in wrangler.jsonc). Typed minimally so we don't take a dependency on a
 * generated full-env type here.
 */
interface CounterEnv {
  COUNTER_DO?: DurableObjectNamespace
}

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
 * Server-side Sentry capture for unhandled server errors (server-hardening). The
 * real 500s on gated `/_serverFn/*` calls were never reaching Sentry — only
 * client errors were. This is the most central safe point: every request flows
 * through this one fetch wrapper.
 *
 * Behaviour is UNCHANGED — we only additionally report:
 *  - a THROWN error is captured, then rethrown as-is;
 *  - a 500 response is captured, then returned as-is.
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

      // Live counter: route /api/live-count (WS upgrade or POST) to the global
      // CounterDO BEFORE the Start handler sees it. Everything else (SSR,
      // server-fns, the cron path) passes through untouched. Guarded so a
      // missing binding (e.g. an old dev env) degrades to the normal handler
      // rather than throwing.
      if (url) {
        const env = args[1] as CounterEnv | undefined
        const ns = env?.COUNTER_DO
        if (ns && new URL(url).pathname === LIVE_COUNT_PATH) {
          const id = ns.idFromName(LIVE_COUNT_DO_NAME)
          return ns.get(id).fetch(req as Request)
        }
      }

      try {
        const res = await entry.fetch(...args)
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
