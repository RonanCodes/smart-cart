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
 * Pull the start-time session token out of the webhook body. VAPI's path for
 * echoed metadata varies by version, so check `message.call?.metadata?.token`
 * and the top-level `call?.metadata?.token`. Returns undefined if absent.
 */
export function extractCallToken(body: unknown): string | undefined {
  const token = readCallMetadata(body)?.token
  return typeof token === 'string' ? token : undefined
}

/** The meal_plan revision the user had open when the voice call started. */
export function extractCallPlanId(body: unknown): string | undefined {
  const planId = readCallMetadata(body)?.planId
  return typeof planId === 'string' && planId.length > 0 ? planId : undefined
}
