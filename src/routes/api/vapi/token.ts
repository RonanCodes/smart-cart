import { createFileRoute } from '@tanstack/react-router'

/**
 * POST /api/vapi/token, mint a short-lived signed token that binds an in-app
 * voice call to the signed-in household. The browser fetches this before
 * `vapi.start` and passes it as call metadata; the tool webhook verifies it and
 * derives `householdId`. Identity is always server-minted, never read from
 * (spoofable) tool arguments.
 *
 * A server route (not a createServerFn imported by the client) so none of the
 * server-only modules, nor the `cloudflare:workers` env binding, leak into the
 * client bundle.
 */
export const Route = createFileRoute('/api/vapi/token')({
  server: {
    handlers: {
      POST: async () => {
        try {
          const { getSessionUser } = await import('../../../lib/server-auth')
          const user = await getSessionUser()
          if (!user) {
            return Response.json(
              { ok: false, error: 'Not signed in' },
              { status: 401 },
            )
          }

          const { readEnv } = await import('../../../lib/env')
          const secret = await readEnv('VAPI_TOOL_TOKEN_SECRET')
          if (!secret) {
            return Response.json(
              { ok: false, error: 'VAPI_TOOL_TOKEN_SECRET not set' },
              { status: 500 },
            )
          }

          const { getDb } = await import('../../../db/client')
          const { household } = await import('../../../db/schema')
          const { eq } = await import('drizzle-orm')
          const db = await getDb()
          const rows = await db
            .select({ id: household.id })
            .from(household)
            .where(eq(household.ownerId, user.id))
            .limit(1)
          const hh = rows[0]
          if (!hh) {
            return Response.json(
              { ok: false, error: 'No household, onboard first' },
              { status: 400 },
            )
          }

          const { mintVapiToken } = await import('../../../lib/vapi-token')
          const token = await mintVapiToken(hh.id, secret)
          return Response.json({ ok: true, token })
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          return Response.json({ ok: false, error: message }, { status: 400 })
        }
      },
    },
  },
})
