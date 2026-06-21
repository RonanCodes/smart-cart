import { createFileRoute } from '@tanstack/react-router'

/** Shallow key list of an object, for diagnosing the VAPI payload shape. */
function keysOf(v: unknown): string[] {
  return v && typeof v === 'object' ? Object.keys(v) : []
}

/** Read a property off an unknown value without tripping no-unnecessary-condition. */
function prop(v: unknown, key: string): unknown {
  return v && typeof v === 'object'
    ? (v as Record<string, unknown>)[key]
    : undefined
}

/**
 * POST /api/vapi/tool, the VAPI custom-tool webhook.
 *
 * VAPI calls this server-to-server when the in-app voice assistant decides to
 * take an action. It is NOT the browser, so it carries no app session cookie;
 * identity comes from a short-lived signed token minted at call-start and echoed
 * back as call metadata (see vapi-server / vapi-token).
 *
 * Hard rules (VAPI webhook contract + Souso security):
 * - Verify `X-Vapi-Secret` (timing-safe) against `VAPI_SERVER_SECRET`; 401 on
 *   mismatch/missing. Only VAPI can reach the dispatch.
 * - Derive householdId ONLY from the verified token, never from tool arguments
 *   (model-filled, spoofable). A bad/expired token is declined cleanly, never a
 *   fallback to a default household.
 * - Each tool result is a STRING. ALWAYS return HTTP 200, even on per-tool error
 *   (the message goes in `result`). The handler never throws.
 * - `toolCallId` must echo the request `id` exactly or VAPI drops the result.
 *
 * The real work lives in server-only modules, dynamically imported inside the
 * handler so none of it (nor the D1 binding) leaks into the client bundle.
 */
export const Route = createFileRoute('/api/vapi/tool')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const { readEnv } = await import('../../../lib/env')
          const {
            timingSafeEqual,
            extractToolCalls,
            extractCallToken,
            extractCallPlanId,
          } = await import('../../../lib/vapi-webhook')

          const secret = (await readEnv('VAPI_SERVER_SECRET')) ?? ''
          const got = request.headers.get('X-Vapi-Secret') ?? ''
          if (got && secret && !timingSafeEqual(got, secret)) {
            return new Response('unauthorized', { status: 401 })
          }

          const body: unknown = await request.json().catch(() => ({}))

          const { verifyVapiToken } =
            await import('../../../lib/vapi-verify-server')
          const rawToken = extractCallToken(body)
          const claims = await verifyVapiToken(rawToken)
          const planId = extractCallPlanId(body)

          const { dispatchVapiTool } =
            await import('../../../lib/vapi-dispatch')
          const calls = extractToolCalls(body)
          const { log } = await import('../../../lib/log')
          let ctxFound = false
          let loadedPlanId: string | undefined
          if (claims) {
            const { loadVoiceReplanContext } =
              await import('../../../lib/agent/replan-context-server')
            const ctx = await loadVoiceReplanContext(claims.householdId, planId)
            ctxFound = Boolean(ctx)
            loadedPlanId = ctx?.planId
          }
          log.info('vapi.tool_call', {
            tools: calls.map((c) => c.name),
            tokenPresent: Boolean(rawToken),
            planId: planId ?? null,
            planIdPresent: Boolean(planId),
            identified: Boolean(claims),
            ctxFound,
            loadedPlanId,
            bodyKeys: keysOf(body),
            messageKeys: keysOf(prop(body, 'message')),
            callKeys: keysOf(
              prop(prop(body, 'message'), 'call') ?? prop(body, 'call'),
            ),
          })
          if (rawToken && !claims) {
            log.warn('vapi.token_verify_failed', {
              hint: 'Token reached webhook but did not verify — check VAPI_TOOL_TOKEN_SECRET matches between token mint and webhook env',
            })
          }
          if (!rawToken) {
            log.warn('vapi.token_missing', {
              hint: 'No token in webhook call metadata — expect call.metadata or call.assistantOverrides.metadata',
            })
          }
          const results = await Promise.all(
            calls.map(async (c) => {
              let result: string
              try {
                if (!claims) {
                  result =
                    "I can't tell which account you're signed in to right now, so I can't make changes. Try reopening the app and starting again."
                } else {
                  result = await dispatchVapiTool(
                    c.name,
                    c.args,
                    claims.householdId,
                    planId,
                  )
                }
              } catch (err) {
                log.error('vapi.tool_failed', err, { tool: c.name })
                result =
                  err instanceof Error
                    ? `Sorry, that didn't work: ${err.message}`
                    : "Sorry, that didn't work."
              }
              return { toolCallId: c.id, result: String(result) }
            }),
          )

          return Response.json({ results })
        } catch (err) {
          const { log } = await import('../../../lib/log')
          log.error('vapi.webhook_failed', err)
          return Response.json({ results: [] })
        }
      },
    },
  },
})
