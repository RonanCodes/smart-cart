import { createFileRoute } from '@tanstack/react-router'

/**
 * GET /api/demo/count — admin-gated live counter for the presenter panel.
 *
 * Returns ONLY `{ count }`, an integer. The numbers themselves never leave the
 * Durable Object. Admin-gated so a random can't poll the draw size, though even
 * if they could, a bare count leaks nothing.
 */
export const Route = createFileRoute('/api/demo/count')({
  server: {
    handlers: {
      GET: async () => {
        try {
          const { isDemoAdmin } = await import('#/lib/demo-roulette-server')
          if (!(await isDemoAdmin())) {
            return Response.json({ ok: false }, { status: 403 })
          }
          const { entrantCount } = await import('#/lib/demo-roulette-server')
          const count = await entrantCount()
          return Response.json({ ok: true, count })
        } catch (err) {
          const { log } = await import('#/lib/log')
          log.error('demo.count_failed', err)
          return Response.json({ ok: false, count: 0 }, { status: 500 })
        }
      },
    },
  },
})
