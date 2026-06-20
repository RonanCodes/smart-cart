import { createServerFn } from '@tanstack/react-start'
import { verifyVapiToken as verifyToken } from './vapi-token'
import type { VapiTokenClaims } from './vapi-token'

/**
 * Server-side VAPI glue: mint a short-lived signed token that binds an in-app
 * voice call to the signed-in household, and re-export the verifier the tool
 * webhook uses.
 *
 * The in-app call talks to VAPI over WebRTC; VAPI then calls our tool webhook
 * server-to-server with no app cookie. So the browser mints this token before
 * `vapi.start` and passes it as call metadata; the webhook verifies it and
 * derives `householdId`. Identity is therefore always server-minted, never read
 * from (spoofable) tool arguments.
 *
 * Server-only modules are dynamically imported inside the handler so none of
 * them (nor the D1 binding) leaks into the client bundle (the planner-server
 * pattern). The signing secret is read via the shared `readEnv` accessor.
 */

export interface MintVapiTokenResult {
  /** The signed token to hand to `vapi.start(..., { metadata: { token } })`. */
  token: string
}

export const mintVapiSessionToken = createServerFn({ method: 'POST' }).handler(
  async (): Promise<MintVapiTokenResult> => {
    const { getSessionUser } = await import('./server-auth')
    const user = await getSessionUser()
    if (!user) throw new Error('Not signed in')

    const { readEnv } = await import('./env')
    const secret = await readEnv('VAPI_TOOL_TOKEN_SECRET')
    if (!secret) throw new Error('VAPI_TOOL_TOKEN_SECRET not set')

    const { getDb } = await import('../db/client')
    const { household } = await import('../db/schema')
    const { eq } = await import('drizzle-orm')
    const db = await getDb()

    const rows = await db
      .select({ id: household.id })
      .from(household)
      .where(eq(household.ownerId, user.id))
      .limit(1)
    const hh = rows[0]
    if (!hh) throw new Error('No household, onboard first')

    const { mintVapiToken } = await import('./vapi-token')
    const token = await mintVapiToken(hh.id, secret)
    return { token }
  },
)

/**
 * Verify a VAPI session token against the server secret. Returns the claims, or
 * `null` on any failure (missing/bad/expired token, or no secret configured).
 * Never throws, so the webhook can branch to a clean spoken decline.
 */
export async function verifyVapiToken(
  token: string | undefined | null,
): Promise<VapiTokenClaims | null> {
  const { readEnv } = await import('./env')
  const secret = await readEnv('VAPI_TOOL_TOKEN_SECRET')
  if (!secret) return null
  return verifyToken(token, secret)
}
