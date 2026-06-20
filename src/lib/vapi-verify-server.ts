import type { VapiTokenClaims } from './vapi-token'

/**
 * Verify a VAPI session token against the server secret. Returns the claims, or
 * `null` on any failure (missing/bad/expired token, or no secret configured).
 * Never throws, so the webhook can branch to a clean spoken decline.
 *
 * Server-only: kept out of `vapi-server.ts` (which the client-side VoiceButton
 * imports for `mintVapiSessionToken`) so the `readEnv` -> `cloudflare:workers`
 * chain never leaks into the client bundle. Only the tool webhook imports this.
 */
export async function verifyVapiToken(
  token: string | undefined | null,
): Promise<VapiTokenClaims | null> {
  const { verifyVapiToken: verifyToken } = await import('./vapi-token')
  const { readEnv } = await import('./env')
  const secret = await readEnv('VAPI_TOOL_TOKEN_SECRET')
  if (!secret) return null
  return verifyToken(token, secret)
}
