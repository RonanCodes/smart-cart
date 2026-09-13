import { createFileRoute } from '@tanstack/react-router'

/**
 * POST /api/demo/spin — admin-gated. Picks ONE uniformly-random entrant, places
 * the outbound Souso voice call to them, and returns a MASKED label (e.g.
 * `•••• ••89`) for the on-stage animation plus whether the call dispatched. The
 * raw number is read inside the server module and handed straight to VAPI — it
 * is never returned to the browser.
 */
export const Route = createFileRoute('/api/demo/spin')({
  server: {
    handlers: {
      POST: async () => {
        try {
          const { isDemoAdmin } = await import('#/lib/demo-roulette-server')
          if (!(await isDemoAdmin())) {
            return Response.json({ ok: false }, { status: 403 })
          }
          const { spinAndCall } = await import('#/lib/demo-roulette-server')
          const result = await spinAndCall()
          if (!result.ok) {
            return Response.json(
              { ok: false, error: 'No one has joined the draw yet.' },
              { status: 400 },
            )
          }
          return Response.json({
            ok: true,
            masked: result.masked,
            total: result.total,
            called: result.called,
            callError: result.callError ?? null,
          })
        } catch (err) {
          const { log } = await import('#/lib/log')
          log.error('demo.spin_failed', err)
          return Response.json(
            { ok: false, error: 'Spin failed.' },
            { status: 500 },
          )
        }
      },
    },
  },
})
