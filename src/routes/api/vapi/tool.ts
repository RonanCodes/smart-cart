import { createFileRoute } from '@tanstack/react-router'

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
          const { timingSafeEqual, extractToolCalls, extractCallToken } =
            await import('../../../lib/vapi-webhook')

          // 1. Verify the shared secret IF present (defense-in-depth). The
          //    assistant's server.secret can only be set in the VAPI dashboard,
          //    not via the API, so VAPI may send no X-Vapi-Secret header. When a
          //    header IS sent it must match; when it isn't, we fall through to
          //    the real security boundary: the signed call token (step 2), which
          //    cannot be forged and is what scopes the call to a household.
          const secret = (await readEnv('VAPI_SERVER_SECRET')) ?? ''
          const got = request.headers.get('X-Vapi-Secret') ?? ''
          if (got && secret && !timingSafeEqual(got, secret)) {
            return new Response('unauthorized', { status: 401 })
          }

          const body: unknown = await request.json().catch(() => ({}))

          // 2. Derive identity from the verified token only.
          const { verifyVapiToken } =
            await import('../../../lib/vapi-verify-server')
          const claims = await verifyVapiToken(extractCallToken(body))

          // 3. Dispatch each tool call. One try/catch per call so a single
          //    failure can never throw the whole webhook (always 200).
          const { dispatchVapiTool } =
            await import('../../../lib/vapi-dispatch')
          const calls = extractToolCalls(body)
          const results = await Promise.all(
            calls.map(async (c) => {
              let result: string
              try {
                if (!claims) {
                  // No trustworthy household: decline cleanly, take no action.
                  result =
                    "I can't tell which account you're signed in to right now, so I can't make changes. Try reopening the app and starting again."
                } else {
                  result = await dispatchVapiTool(
                    c.name,
                    c.args,
                    claims.householdId,
                  )
                }
              } catch (err) {
                result =
                  err instanceof Error
                    ? `Sorry, that didn't work: ${err.message}`
                    : "Sorry, that didn't work."
              }
              return { toolCallId: c.id, result: String(result) }
            }),
          )

          return Response.json({ results })
        } catch {
          // Last-resort guard: never let the handler throw. VAPI ignores non-200,
          // so even on an unexpected failure we answer 200 with an empty result set.
          return Response.json({ results: [] })
        }
      },
    },
  },
})
