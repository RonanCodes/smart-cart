/**
 * Signed session tokens that bind an in-app VAPI voice call to a household.
 *
 * The tool webhook is a server-to-server call from VAPI and carries no app
 * session cookie, so identity is bound at call-start instead: the client mints a
 * short-lived HMAC-signed token for the signed-in household and passes it as call
 * metadata; the webhook verifies the signature + expiry and derives `householdId`
 * from it. Tool arguments are model-filled and spoofable, so they are NEVER
 * trusted for identity, only this server-minted token is.
 *
 * Pure crypto over Web Crypto (`crypto.subtle`), Workers-safe and dependency-free
 * so it can be unit-tested without a request context. The signing secret is read
 * by the caller (via `readEnv('VAPI_TOOL_TOKEN_SECRET')`) and passed in.
 */

/** What a verified token resolves to. */
export interface VapiTokenClaims {
  householdId: string
}

/** Default token lifetime: a few minutes is plenty for a voice session. */
export const DEFAULT_TOKEN_TTL_SECONDS = 5 * 60

interface TokenPayload {
  householdId: string
  /** Expiry, unix seconds. */
  exp: number
}

/** base64url-encode bytes (no padding), the JWT-style url-safe alphabet. */
function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Decode a base64url string back to bytes. Throws on malformed input. */
function base64UrlDecode(value: string): Uint8Array {
  const padded = value
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=')
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

const encoder = new TextEncoder()

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

async function hmac(secret: string, message: string): Promise<Uint8Array> {
  const key = await importKey(secret)
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(message))
  return new Uint8Array(sig)
}

/**
 * Mint a signed token for a household. Shape is `<payload>.<signature>`, both
 * base64url. The payload is HMAC-SHA256 signed over its own base64url string.
 */
export async function mintVapiToken(
  householdId: string,
  secret: string,
  ttlSeconds: number = DEFAULT_TOKEN_TTL_SECONDS,
  now: number = Math.floor(Date.now() / 1000),
): Promise<string> {
  const payload: TokenPayload = { householdId, exp: now + ttlSeconds }
  const encodedPayload = base64UrlEncode(
    encoder.encode(JSON.stringify(payload)),
  )
  const sig = await hmac(secret, encodedPayload)
  return `${encodedPayload}.${base64UrlEncode(sig)}`
}

/** Constant-time compare of two byte arrays. */
function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false
  let diff = 0
  for (let i = 0; i < a.byteLength; i++) diff |= a[i]! ^ b[i]!
  return diff === 0
}

/**
 * Verify a token's signature + expiry against the secret. Returns the claims on
 * success, or `null` on ANY failure (malformed, bad signature, expired, missing).
 * Never throws, so the webhook can branch cleanly to a spoken decline.
 */
export async function verifyVapiToken(
  token: string | undefined | null,
  secret: string,
  now: number = Math.floor(Date.now() / 1000),
): Promise<VapiTokenClaims | null> {
  try {
    if (!token || !secret) return null
    const [encodedPayload, encodedSig] = token.split('.')
    if (!encodedPayload || !encodedSig) return null

    const expected = await hmac(secret, encodedPayload)
    const got = base64UrlDecode(encodedSig)
    if (!timingSafeEqualBytes(expected, got)) return null

    const payload = JSON.parse(
      new TextDecoder().decode(base64UrlDecode(encodedPayload)),
    ) as TokenPayload
    if (
      typeof payload.householdId !== 'string' ||
      typeof payload.exp !== 'number'
    ) {
      return null
    }
    if (payload.exp <= now) return null

    return { householdId: payload.householdId }
  } catch {
    return null
  }
}
