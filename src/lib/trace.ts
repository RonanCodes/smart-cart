/**
 * Request-scoped trace id (diagnose canon).
 *
 * One id that follows a user action FE -> BE -> logs -> Sentry -> PostHog, so a
 * single value reconstructs a whole flow across every backend. The client mints
 * a trace id ONCE per page session and keeps it in `sessionStorage`, so every
 * `log.*` line, every PostHog event, and every Sentry event in that session
 * carries the same `traceId`. The `/api/log` Worker re-emits whatever `traceId`
 * the client shipped, so a client error and its server re-emit share the id, and
 * the server-side Sentry forward keeps it too.
 *
 * Pure + framework-free so it is trivially unit-testable and safe to import from
 * both the browser and a Worker. NEVER throws (observability must not crash a
 * request): a blocked / absent `sessionStorage` falls back to an in-memory id.
 */

/** The 32-char hex shape Sentry uses for `trace_id`, matching the server forward. */
const TRACE_RE = /^[0-9a-f]{32}$/

/** sessionStorage key for the per-session client trace id. */
export const TRACE_STORAGE_KEY = 'souso_trace_id'

/** Mint a fresh 32-char hex trace id (UUID without the dashes). */
export function newTraceId(): string {
  const c = globalThis.crypto as Crypto | undefined
  if (c && typeof c.randomUUID === 'function') {
    return c.randomUUID().replace(/-/g, '')
  }
  // Fallback for runtimes without crypto.randomUUID: 32 hex chars from Math.random.
  let out = ''
  while (out.length < 32) {
    out += Math.floor(Math.random() * 16).toString(16)
  }
  return out.slice(0, 32)
}

/** True when `value` is a well-formed 32-char hex trace id. */
export function isTraceId(value: unknown): value is string {
  return typeof value === 'string' && TRACE_RE.test(value)
}

/** In-memory fallback when sessionStorage is unavailable (private mode, SSR). */
let memoryTraceId: string | null = null

/**
 * The trace id for THIS page session: minted once, reused on every call, mirrored
 * to sessionStorage so a same-session reload keeps the same id. A malformed or
 * blocked store is recovered with a fresh valid id. Always returns a valid id.
 */
export function getClientTraceId(): string {
  try {
    const stored = window.sessionStorage.getItem(TRACE_STORAGE_KEY)
    if (isTraceId(stored)) return stored
    const fresh = newTraceId()
    window.sessionStorage.setItem(TRACE_STORAGE_KEY, fresh)
    return fresh
  } catch {
    // sessionStorage blocked / unavailable: keep a stable in-memory id instead.
    memoryTraceId ??= newTraceId()
    return memoryTraceId
  }
}
