import { createFileRoute } from '@tanstack/react-router'

/**
 * POST /api/plan, generate (or regenerate) the signed-in household's week and
 * persist it as a meal_plan row. Returns the stable plan id the week view reads.
 * The real work lives in the server-only planner-server module (dynamically
 * imported so none of it leaks into the client bundle).
 */
export const Route = createFileRoute('/api/plan')({
  server: {
    handlers: {
      POST: async () => {
        try {
          const { generatePlan } = await import('../../lib/planner-server')
          const result = await generatePlan()
          return Response.json({ ok: true, ...result })
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          const status = message === 'Not signed in' ? 401 : 400
          return Response.json({ ok: false, error: message }, { status })
        }
      },
    },
  },
})
