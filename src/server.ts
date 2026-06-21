import '#/lib/braintrust-ai'
import {
  createStartHandler,
  defaultStreamHandler,
} from '@tanstack/react-start/server'
import type { Register } from '@tanstack/react-router'
import type { RequestHandler } from '@tanstack/react-start/server'

const fetch = createStartHandler(defaultStreamHandler)

export type ServerEntry = { fetch: RequestHandler<Register> }

export function createServerEntry(entry: ServerEntry): ServerEntry {
  return {
    async fetch(...args) {
      return await entry.fetch(...args)
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
