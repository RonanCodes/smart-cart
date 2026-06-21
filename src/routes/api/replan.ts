import { createFileRoute } from '@tanstack/react-router'
import type { ReplanUIMessage } from '../../lib/agent/replan-ui-message'

/**
 * POST /api/replan — chat replan agent (AI SDK UI message stream).
 *
 * Uses `createUIMessageStream` + `createUIMessageStreamResponse` so the client can
 * consume the stream with `readUIMessageStream` (see replan-client.ts). Data parts:
 *  - `data-week`  the working week after each tool step (id `working-week`)
 *  - `data-done`  final summary + persisted plan id when the loop finishes
 *
 * Pure-agent: free text needs the OpenAI key. With no key we stream an honest text
 * reply plus a `data-done` (the structured UI buttons keep working via `replanWeek`).
 *
 * Server-only: every collaborator is dynamically imported inside the handler.
 */
export const Route = createFileRoute('/api/replan')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { getSessionUser } = await import('../../lib/server-auth')
        const user = await getSessionUser()
        if (!user) return new Response('unauthorized', { status: 401 })

        const body: unknown = await request.json().catch(() => ({}))
        const planId =
          typeof (body as { planId?: unknown }).planId === 'string'
            ? (body as { planId: string }).planId
            : ''
        const instruction =
          typeof (body as { instruction?: unknown }).instruction === 'string'
            ? (body as { instruction: string }).instruction.trim()
            : ''
        if (!planId || !instruction) {
          return Response.json({ error: 'bad-request' }, { status: 400 })
        }

        const ctxMod = await import('../../lib/agent/replan-context-server')
        const ctx = await ctxMod.loadReplanContextForUser(user.id, planId)
        if (!ctx)
          return Response.json({ error: 'plan-not-found' }, { status: 404 })

        const { createUIMessageStream, createUIMessageStreamResponse } =
          await import('ai')

        const { model, aiAvailable } = await ctxMod.buildReplanModel()
        const offlineMessage =
          "AI adjustments are off (no API key set), so I can't read free-form requests. The buttons (swap a day, eating-out) still work."

        if (!aiAvailable || !model) {
          const stream = createUIMessageStream<ReplanUIMessage>({
            execute: ({ writer }) => {
              writer.write({
                type: 'data-done',
                id: 'done',
                data: {
                  message: offlineMessage,
                  changed: false,
                  planId: ctx.planId,
                },
              })
            },
          })
          return createUIMessageStreamResponse({ stream })
        }

        const buildMatcher = await ctxMod.buildMatcherFactory()
        const { WeekSession } = await import('../../lib/agent/week-session')
        const session = new WeekSession({
          week: ctx.week,
          recipes: ctx.recipes,
          profile: ctx.profile,
          swipes: ctx.swipes,
          buildMatcher,
        })

        const { streamText, flush } = await import('../../lib/braintrust-ai')
        const { replanAgentArgs } = await import('../../lib/agent/runner')
        const { log } = await import('../../lib/log')

        const stream = createUIMessageStream<ReplanUIMessage>({
          execute: ({ writer }) => {
            const result = streamText({
              ...replanAgentArgs({
                session,
                profile: ctx.profile,
                recipes: ctx.recipes,
                instruction,
                model,
              }),
              onStepFinish: () => {
                writer.write({
                  type: 'data-week',
                  id: 'working-week',
                  data: { week: session.getWeek() },
                })
              },
              onFinish: async ({ text }) => {
                try {
                  const changed = session.hasChanged()
                  const newPlanId = changed
                    ? await ctxMod.persistRevision(
                        ctx.householdId,
                        ctx.weekStart,
                        session.getWeek(),
                      )
                    : ctx.planId
                  writer.write({
                    type: 'data-done',
                    id: 'done',
                    data: {
                      message: text.trim() || "Done. I've updated your week.",
                      changed,
                      planId: newPlanId,
                    },
                  })
                } catch (err) {
                  log.error('replan.persist_failed', err)
                  writer.write({
                    type: 'data-done',
                    id: 'done',
                    data: {
                      message: 'Could not save the updated week.',
                      changed: false,
                      planId: ctx.planId,
                    },
                  })
                } finally {
                  try {
                    await flush()
                  } catch {
                    // tracing flush is best-effort
                  }
                }
              },
            })
            writer.merge(result.toUIMessageStream())
          },
          onError: (err) => {
            log.error('replan.stream_failed', err)
            return 'Could not adjust the week.'
          },
        })

        return createUIMessageStreamResponse({ stream })
      },
    },
  },
})
