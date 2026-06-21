import { createFileRoute } from '@tanstack/react-router'
import type { PersonaOverrides } from '../../../lib/vapi-persona'

/**
 * POST /api/vapi/token, mint a short-lived signed token that binds an in-app
 * voice call to the signed-in household, AND build Souso's per-call assistant
 * overrides (persona system prompt + first message + week variables). The browser
 * fetches this before `vapi.start`, passes the token as call metadata (the tool
 * webhook verifies it and derives `householdId`) and the overrides as the second
 * `vapi.start` argument. Identity is always server-minted, never read from
 * (spoofable) tool arguments.
 *
 * The persona is grounded in the OPEN week's dinners so the call defaults to
 * editing this week ("make Tuesday veggie") without the user naming the week. The
 * `planId` the browser had open is sent in the request body so we ground on the
 * exact revision; we fall back to the household's newest plan if it's missing.
 *
 * A server route (not a createServerFn imported by the client) so none of the
 * server-only modules, nor the `cloudflare:workers` env binding, leak into the
 * client bundle.
 */
export const Route = createFileRoute('/api/vapi/token')({
  server: {
    handlers: {
      POST: async ({ request }) => {
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

          // Read the planId the browser had open (best-effort; the body may be
          // empty). We ground the persona on that exact revision, falling back to
          // the household's newest plan inside loadVoiceReplanContext.
          const body = (await request.json().catch(() => ({}))) as {
            planId?: unknown
          }
          const planId =
            typeof body.planId === 'string' && body.planId.length > 0
              ? body.planId
              : undefined

          // Build Souso's per-call overrides grounded in the open week. Failing
          // to load the week must NEVER block a call: with no overrides VAPI just
          // uses the dashboard assistant as-is.
          let assistantOverrides: PersonaOverrides | undefined
          try {
            const { loadVoiceReplanContext } =
              await import('../../../lib/agent/replan-context-server')
            const ctx = await loadVoiceReplanContext(hh.id, planId)
            if (ctx) {
              const { weekLabel } = await import('../../../lib/week-offset')
              const { offsetForWeekStart } =
                await import('../../../lib/week-offset')
              const { buildPersonaOverrides } =
                await import('../../../lib/vapi-persona')
              assistantOverrides = buildPersonaOverrides({
                weekLabel: weekLabel(offsetForWeekStart(ctx.weekStart)),
                days: ctx.week.days.map((d) => ({
                  day: d.day,
                  meal: d.meal,
                })),
              })
            }
          } catch {
            assistantOverrides = undefined
          }

          return Response.json({ ok: true, token, assistantOverrides })
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          return Response.json({ ok: false, error: message }, { status: 400 })
        }
      },
    },
  },
})
