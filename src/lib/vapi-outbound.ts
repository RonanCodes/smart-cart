/**
 * Place a VAPI OUTBOUND phone call. Server-only (reaches `cloudflare:workers`
 * env via the env helper) and reached by `await import()` from the spin route so
 * the VAPI private key never enters the client bundle.
 *
 * Unlike the in-app voice button (which uses the browser-safe PUBLIC key +
 * `vapi.start`), an outbound call hits the VAPI REST API and therefore needs:
 *   - VAPI_PRIVATE_API_KEY  — the secret REST key (Bearer auth). NOT the public
 *                             key, NOT a VITE_ var. A wrangler secret.
 *   - VAPI_PHONE_NUMBER_ID  — the id of a VAPI-provisioned phone number to dial
 *                             FROM. Provision one in the VAPI dashboard
 *                             (Phone Numbers) and copy its id.
 *   - the assistant id      — reused from src/config/vapi.ts (the same Souso
 *                             assistant the in-app button uses), overridable via
 *                             VAPI_OUTBOUND_ASSISTANT_ID.
 *
 * On the voice-tool side: the called person reaches Souso and can update the
 * meal plan by voice through the EXISTING /api/vapi/tool webhook — IF the call
 * carries a signed household token in its metadata. An outbound call has no
 * signed-in browser session, so there is no household to bind to unless one is
 * configured (DEMO_VAPI_HOUSEHOLD_ID + VAPI_TOOL_TOKEN_SECRET): when both are
 * set we mint a token for that demo household and attach it as call metadata, so
 * the recipient's "change my plan" requests mutate that one demo account. With
 * no demo household configured the call still connects and Souso chats, but the
 * plan-mutating tools decline cleanly ("I can't tell which account…") — exactly
 * the existing webhook behaviour for a missing token.
 */
import { readEnv } from './env'
import { VAPI_ASSISTANT_ID } from '../config/vapi'

export type OutboundResult =
  | { ok: true; callId: string }
  | { ok: false; error: string }

const VAPI_CALL_ENDPOINT = 'https://api.vapi.ai/call'

/** Build the optional call metadata that lets the recipient mutate a demo plan
 * by voice. Returns undefined when no demo household is configured. */
async function buildCallMetadata(): Promise<
  Record<string, string> | undefined
> {
  const householdId = await readEnv('DEMO_VAPI_HOUSEHOLD_ID')
  const secret = await readEnv('VAPI_TOOL_TOKEN_SECRET')
  if (!householdId || !secret) return undefined
  const { mintVapiToken } = await import('./vapi-token')
  // A pitch can run longer than the in-app default (5 min); give the demo call
  // a generous 30-minute token so the tool webhook still verifies mid-call.
  const token = await mintVapiToken(householdId, secret, 30 * 60)
  return { token }
}

export async function placeOutboundCall(
  customerNumber: string,
): Promise<OutboundResult> {
  const apiKey = await readEnv('VAPI_PRIVATE_API_KEY')
  const phoneNumberId = await readEnv('VAPI_PHONE_NUMBER_ID')
  const assistantId =
    (await readEnv('VAPI_OUTBOUND_ASSISTANT_ID')) || VAPI_ASSISTANT_ID

  if (!apiKey) return { ok: false, error: 'VAPI_PRIVATE_API_KEY not set' }
  if (!phoneNumberId) {
    return { ok: false, error: 'VAPI_PHONE_NUMBER_ID not set' }
  }

  const metadata = await buildCallMetadata()

  try {
    const res = await fetch(VAPI_CALL_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        phoneNumberId,
        customer: { number: customerNumber },
        assistant: {
          assistantId,
          ...(metadata ? { metadata } : {}),
        },
      }),
    })

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      const { log } = await import('./log')
      // Log the failure WITHOUT the customer number — never log the raw phone.
      log.warn('demo.outbound_call_failed', {
        status: res.status,
        detail: detail.slice(0, 300),
      })
      return { ok: false, error: `VAPI ${res.status}` }
    }

    const body = (await res.json().catch(() => ({}))) as { id?: string }
    return { ok: true, callId: body.id ?? '' }
  } catch (err) {
    const { log } = await import('./log')
    log.error('demo.outbound_call_error', err)
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'call failed',
    }
  }
}
