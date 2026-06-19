import { createFileRoute } from '@tanstack/react-router'
import type { SimilarSort } from '../../lib/vectors/similar'

/**
 * POST /api/similar, nearest-neighbour swaps for a recipe via Vectorize.
 *
 * Body: { recipeId: string, sort?: 'similarity' | 'faster' | 'lighter', limit?: number }
 * Returns: { ok: true, recipeId, neighbours: [...] } scoped to the signed-in
 * household so its allergy/diet hard filters apply. The real work lives in the
 * server-only similar-server module (dynamically imported so none of it, nor the
 * Vectorize binding it pulls in, leaks into the client bundle).
 */
export const Route = createFileRoute('/api/similar')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = (await request.json().catch(() => ({}))) as {
            recipeId?: unknown
            sort?: unknown
            limit?: unknown
          }
          const recipeId =
            typeof body.recipeId === 'string' ? body.recipeId : ''
          if (!recipeId) {
            return Response.json(
              { ok: false, error: 'recipeId required' },
              { status: 400 },
            )
          }
          const sort: SimilarSort | undefined =
            body.sort === 'faster' ||
            body.sort === 'lighter' ||
            body.sort === 'similarity'
              ? body.sort
              : undefined
          const limit =
            typeof body.limit === 'number' && body.limit > 0
              ? Math.floor(body.limit)
              : undefined

          const { getSimilarRecipes } = await import('../../lib/similar-server')
          const result = await getSimilarRecipes({
            data: { recipeId, sort, limit },
          })
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
