import { createFileRoute } from '@tanstack/react-router'

/**
 * POST /api/demo/clear — admin-gated. Wipes every entrant from the in-memory
 * draw (e.g. between runs, or at the end of the pitch). Returns the new count
 * (always 0).
 */
export const Route = createFileRoute('/api/demo/clear')({
  server: {
    handlers: {
      POST: async () => {
        try {
          const { isDemoAdmin } = await import('#/lib/demo-roulette-server')
          if (!(await isDemoAdmin())) {
            return Response.json({ ok: false }, { status: 403 })
          }
          const { clearEntrants } = await import('#/lib/demo-roulette-server')
          const count = await clearEntrants()
          return Response.json({ ok: true, count })
        } catch (err) {
          const { log } = await import('#/lib/log')
          log.error('demo.clear_failed', err)
          return Response.json(
            { ok: false, error: 'Clear failed.' },
            { status: 500 },
          )
        }
      },
    },
  },
})
