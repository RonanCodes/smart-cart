/**
 * Pure, testable helpers for the Resend inbound-email webhook.
 *
 * Resend signs webhooks Svix-style (the same scheme Svix/Clerk/Resend share):
 * - headers `svix-id`, `svix-timestamp`, `svix-signature`
 * - the signed content is `${id}.${timestamp}.${rawBody}`
 * - the secret is `whsec_<base64>`; the bytes after `whsec_` are base64-decoded
 *   to the HMAC key
 * - the signature is HMAC-SHA256(signedContent, key), base64-encoded
 * - `svix-signature` is a space-separated list of `v1,<base64sig>` entries (a
 *   secret can have multiple active keys); the request is valid if ANY entry
 *   matches, compared timing-safe.
 *
 * Kept dependency-free + side-effect-free so the route handler stays thin and
 * this is unit-testable. The Web-Crypto timing-safe compare is reused from
 * vapi-webhook.
 */
import { timingSafeEqual } from './vapi-webhook'

/** The Svix-style headers Resend sends on every signed webhook. */
export interface ResendWebhookHeaders {
  svixId: string | null
  svixTimestamp: string | null
  svixSignature: string | null
}

/** Why a webhook was (not) verified — named so a 401 is never silent. */
export type ResendVerifyReason =
  | 'ok'
  | 'no_secret'
  | 'missing_headers'
  | 'bad_secret'
  | 'mismatch'

export interface ResendVerifyResult {
  verified: boolean
  reason: ResendVerifyReason
}

/**
 * Decode a base64 string to bytes, Workers-safe (atob is global on Workers).
 * Backed by an explicit ArrayBuffer so the result satisfies BufferSource for
 * Web-Crypto (a plain Uint8Array can be backed by SharedArrayBuffer in TS's
 * lib types, which crypto.subtle rejects).
 */
function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64)
  const buf = new ArrayBuffer(bin.length)
  const bytes = new Uint8Array(buf)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

/** Encode bytes to a base64 string. */
function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.byteLength; i++)
    bin += String.fromCharCode(bytes[i]!)
  return btoa(bin)
}

/**
 * Compute the expected Svix signature: base64(HMAC-SHA256(`${id}.${ts}.${body}`,
 * decoded-secret)). The secret arrives as `whsec_<base64>`; we strip the prefix
 * and base64-decode the rest to the raw HMAC key. Pure besides the Web-Crypto call.
 */
export async function computeResendSignature(
  secret: string,
  svixId: string,
  svixTimestamp: string,
  rawBody: string,
): Promise<string> {
  const keyMaterial = secret.startsWith('whsec_') ? secret.slice(6) : secret
  const keyBytes = base64ToBytes(keyMaterial)
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signedContent = `${svixId}.${svixTimestamp}.${rawBody}`
  const sig = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(signedContent),
  )
  return bytesToBase64(new Uint8Array(sig))
}

/**
 * Verify a Resend inbound webhook signature.
 *
 * Contract:
 * - No secret configured -> `no_secret`, verified TRUE. This lets the webhook
 *   work BEFORE RESEND_WEBHOOK_SECRET is wired; the route logs a warn so the gap
 *   is visible. Once the secret is set, verification is enforced (fail closed).
 * - Secret set but headers missing -> `missing_headers`, FALSE (401).
 * - Secret malformed (not decodable) -> `bad_secret`, FALSE (401).
 * - Signature present but no `v1,<sig>` entry matches -> `mismatch`, FALSE (401).
 * - A matching entry -> `ok`, TRUE.
 */
export async function verifyResendSignature(
  secret: string,
  headers: ResendWebhookHeaders,
  rawBody: string,
): Promise<ResendVerifyResult> {
  if (!secret) return { verified: true, reason: 'no_secret' }

  const { svixId, svixTimestamp, svixSignature } = headers
  if (!svixId || !svixTimestamp || !svixSignature) {
    return { verified: false, reason: 'missing_headers' }
  }

  let expected: string
  try {
    expected = await computeResendSignature(
      secret,
      svixId,
      svixTimestamp,
      rawBody,
    )
  } catch {
    return { verified: false, reason: 'bad_secret' }
  }

  // svix-signature is a space-separated list of `v1,<base64sig>` entries. Any
  // match (timing-safe) verifies the request.
  for (const entry of svixSignature.split(' ')) {
    const comma = entry.indexOf(',')
    if (comma === -1) continue
    const candidate = entry.slice(comma + 1)
    if (timingSafeEqual(candidate, expected)) {
      return { verified: true, reason: 'ok' }
    }
  }
  return { verified: false, reason: 'mismatch' }
}

/** A parsed inbound email, normalised from the Resend webhook payload. */
export interface ParsedInboundEmail {
  from: string
  to: Array<string>
  subject: string
  text: string
  html: string
}

/** Read a string property off an unknown value, '' if absent/non-string. */
function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

/** Normalise a to/recipient field that may be a string or an array of strings. */
function toList(v: unknown): Array<string> {
  if (typeof v === 'string') return v ? [v] : []
  if (Array.isArray(v))
    return v.filter((x): x is string => typeof x === 'string')
  return []
}

/**
 * Pull the inbound-email fields out of a Resend webhook body, defensively.
 *
 * Resend wraps the payload as `{ type, data: { from, to, subject, text, html } }`.
 * The inbound event type is one of `email.received` / `inbound.email` /
 * `email.inbound` depending on Resend's naming; we accept any event whose type
 * looks inbound AND whose data carries a `from`. Returns null for anything that
 * is not a parseable inbound email (so the route can 200 + skip non-inbound
 * events without forwarding noise).
 */
export function parseInboundEmail(body: unknown): ParsedInboundEmail | null {
  if (!body || typeof body !== 'object') return null
  const b = body as { type?: unknown; data?: unknown }
  const type = str(b.type).toLowerCase()
  // Accept the known inbound event names + anything containing "inbound".
  const looksInbound =
    type === 'email.received' ||
    type === 'inbound.email' ||
    type === 'email.inbound' ||
    type.includes('inbound')
  if (!looksInbound) return null

  const data =
    b.data && typeof b.data === 'object'
      ? (b.data as Record<string, unknown>)
      : undefined
  if (!data) return null

  const from = str(data.from)
  if (!from) return null

  return {
    from,
    to: toList(data.to),
    subject: str(data.subject),
    text: str(data.text),
    html: str(data.html),
  }
}
