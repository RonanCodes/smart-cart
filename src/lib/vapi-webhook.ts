/**
 * Pure helpers for the VAPI tool webhook: timing-safe secret compare, defensive
 * tool-call extraction (VAPI's payload field naming differs across versions),
 * and call-metadata token extraction. Kept dependency-free and side-effect-free
 * so the route handler stays thin and these are unit-testable.
 */

/** One normalised tool call pulled out of a VAPI webhook payload. */
export interface ParsedToolCall {
  id: string
  name: string
  args: Record<string, unknown>
}

const encoder = new TextEncoder()

/**
 * Constant-time string compare over Web Crypto. Returns false fast on a length
 * mismatch (length is not secret here). Workers-safe.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const x = encoder.encode(a)
  const y = encoder.encode(b)
  if (x.byteLength !== y.byteLength) return false
  let diff = 0
  for (let i = 0; i < x.byteLength; i++) diff |= x[i]! ^ y[i]!
  return diff === 0
}

/** Coerce a possibly-stringified arguments field into an object. */
function coerceArgs(raw: unknown): Record<string, unknown> {
  if (!raw) return {}
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      return parsed && typeof parsed === 'object'
        ? (parsed as Record<string, unknown>)
        : {}
    } catch {
      return {}
    }
  }
  if (typeof raw === 'object') return raw as Record<string, unknown>
  return {}
}

/**
 * Pull the tool calls out of a webhook body, defensively. Supports both
 * `message.toolCallList` and `message.toolCalls`, name at `c.name ?? c.function?.name`,
 * and args at `c.arguments ?? c.function?.arguments`. Skips entries with no id or
 * no name. Returns [] for anything malformed.
 */
export function extractToolCalls(body: unknown): Array<ParsedToolCall> {
  const message = (body as { message?: unknown } | null)?.message as
    | { toolCallList?: unknown; toolCalls?: unknown }
    | undefined
  const list = message?.toolCallList ?? message?.toolCalls
  if (!Array.isArray(list)) return []

  const out: Array<ParsedToolCall> = []
  for (const raw of list) {
    const c = raw as {
      id?: unknown
      name?: unknown
      arguments?: unknown
      function?: { name?: unknown; arguments?: unknown }
    }
    const id = typeof c.id === 'string' ? c.id : ''
    const name =
      typeof c.name === 'string'
        ? c.name
        : typeof c.function?.name === 'string'
          ? c.function.name
          : ''
    if (!id || !name) continue
    const args = coerceArgs(c.arguments ?? c.function?.arguments)
    out.push({ id, name, args })
  }
  return out
}

type CallMetadataCarrier = {
  metadata?: unknown
  assistantOverrides?: { metadata?: unknown }
}

function isMetadataRecord(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === 'object' && !Array.isArray(v)
}

/** `message.call` or top-level `call` — VAPI uses both shapes. */
function readCallFromBody(body: unknown): CallMetadataCarrier | undefined {
  const b = body as {
    message?: { call?: CallMetadataCarrier }
    call?: CallMetadataCarrier
  } | null
  return b?.message?.call ?? b?.call
}

/**
 * Pull echoed call metadata out of the webhook body. VAPI's path varies by version:
 * - `call.metadata` on some events
 * - `call.assistantOverrides.metadata` when the client passed metadata via
 *   `vapi.start(id, { metadata })` (AssistantOverrides — what @vapi-ai/web sends)
 * Merge both; top-level `call.metadata` wins on key conflicts.
 */
function readCallMetadata(body: unknown): Record<string, unknown> | undefined {
  const call = readCallFromBody(body)
  if (!call) return undefined

  const fromOverrides = isMetadataRecord(call.assistantOverrides?.metadata)
    ? call.assistantOverrides.metadata
    : {}
  const fromCall = isMetadataRecord(call.metadata) ? call.metadata : {}
  const merged = { ...fromOverrides, ...fromCall }
  return Object.keys(merged).length > 0 ? merged : undefined
}

/**
 * Pull the signed session token VAPI echoes back from call-start.
 *
 * The browser calls `vapi.start(assistantId, { metadata: { token } })`. That
 * second argument is the assistant OVERRIDES, so VAPI delivers the metadata at
 * `call.assistantOverrides.metadata` — NOT `call.metadata`, which is where our
 * first version (wrongly) looked, so every tool call was declined ("can't tell
 * which account..."). We now check every known path AND deep-scan for a
 * `metadata.token` anywhere in the payload, because VAPI's exact shape varies by
 * version (PRD §4 caveat). The webhook logs the raw payload separately to confirm.
 */
export function extractCallToken(body: unknown): string | undefined {
  const fromMeta = readCallMetadata(body)?.token
  if (typeof fromMeta === 'string' && fromMeta.length > 0) return fromMeta

  const known = [
    ['message', 'call', 'assistantOverrides', 'metadata', 'token'],
    ['call', 'assistantOverrides', 'metadata', 'token'],
    ['message', 'call', 'metadata', 'token'],
    ['call', 'metadata', 'token'],
    ['message', 'assistantOverrides', 'metadata', 'token'],
    ['message', 'metadata', 'token'],
  ]
  for (const path of known) {
    const v = path.reduce<unknown>(
      (acc, k) =>
        acc && typeof acc === 'object'
          ? (acc as Record<string, unknown>)[k]
          : undefined,
      body,
    )
    if (typeof v === 'string' && v.length > 0) return v
  }
  return deepFindToken(body)
}

function deepFindToken(node: unknown, depth = 0): string | undefined {
  if (depth > 6 || !node || typeof node !== 'object') return undefined
  const obj = node as Record<string, unknown>
  const meta = obj.metadata as { token?: unknown } | undefined
  if (meta && typeof meta.token === 'string' && meta.token.length > 0) {
    return meta.token
  }
  for (const value of Object.values(obj)) {
    const found = deepFindToken(value, depth + 1)
    if (found) return found
  }
  return undefined
}

/** The meal_plan revision the user had open when the voice call started. */
export function extractCallPlanId(body: unknown): string | undefined {
  const planId = readCallMetadata(body)?.planId
  return typeof planId === 'string' && planId.length > 0 ? planId : undefined
}
