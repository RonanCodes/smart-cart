/**
 * Isomorphic structured logger for Souso.
 *
 * - **Server (Cloudflare Worker):** emits one JSON line per event to the console,
 *   which Cloudflare Workers Logs captures (`observability.enabled` in
 *   wrangler.jsonc). Query them in the CF dashboard or `wrangler tail`.
 * - **Client (browser):** logs to the console, fans `warn`/`error` to Sentry and
 *   every event to PostHog (via the lazy sinks below), AND ships `warn`/`error`
 *   to `/api/log` so real-user failures also land in Workers Logs. Every client
 *   line carries the per-session `traceId`. Uses `sendBeacon` so it survives a
 *   navigation.
 *
 * Pluggable: add a Sentry/PostHog sink in `emit()` when those are wired (see the
 * SINKS note). Keep call sites using `log.*` and the backend can change underneath.
 *
 * Conventions (diagnose canon): `event` is a dotted, greppable name
 * ("push.enable_failed"), context carries load-bearing ids (userId, householdId,
 * traceId) so a single grep reconstructs a flow.
 */
import { getClientTraceId } from './trace'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'
export type LogContext = Record<string, unknown>

const isServer = typeof window === 'undefined'

/**
 * Server-side request user context (#284). Set from `getSessionUser()` when a
 * request resolves a signed-in user, so every server log line for that request
 * carries `{ userId, email }` and you can see WHO hit an error. Cleared (or just
 * left empty) for signed-out / public requests, so it never crashes when there
 * is no session. Per-call context still wins on key collision.
 */
let serverUserContext: LogContext = {}

/** Attach (or clear with `null`) the signed-in user to every server log line. */
export function setServerLogUser(
  user: { id?: string; email?: string } | null | undefined,
): void {
  if (!isServer) return
  if (!user || (!user.id && !user.email)) {
    serverUserContext = {}
    return
  }
  serverUserContext = {
    ...(user.id ? { userId: user.id } : {}),
    ...(user.email ? { email: user.email } : {}),
  }
}

function serialiseError(err: unknown): LogContext {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack }
  }
  if (err && typeof err === 'object') return { message: JSON.stringify(err) }
  return { message: String(err) }
}

interface LogEntry extends LogContext {
  level: LogLevel
  event: string
  ts: string
  origin: 'server' | 'client'
}

/**
 * The per-session client trace id (diagnose canon), attached to every client log
 * line so the line, its `/api/log` server re-emit, the Sentry event, and the
 * PostHog event for the same flow all carry the same `traceId`. Guarded: a
 * missing/blocked sessionStorage just yields no traceId. Server-side the trace id
 * arrives ON the shipped client body (`/api/log` re-emits `...body`), so we only
 * mint one client-side. `trace.ts` is pure (no `cloudflare:workers` import) so it
 * is safe in the client bundle.
 */
function withClientTrace(): { traceId?: string } {
  try {
    return { traceId: getClientTraceId() }
  } catch {
    return {}
  }
}

function emit(level: LogLevel, event: string, context?: LogContext): void {
  const entry: LogEntry = {
    level,
    event,
    ts: new Date().toISOString(),
    origin: isServer ? 'server' : 'client',
    // Server request user (#284): merged BEFORE per-call context so an explicit
    // userId/email passed at the call site still wins.
    ...(isServer ? serverUserContext : {}),
    // Per-session client trace id (diagnose canon): only when not already set by
    // the caller, so an explicit traceId still wins.
    ...(!isServer && context?.traceId === undefined ? withClientTrace() : {}),
    ...context,
  }
  const line = JSON.stringify(entry)

  // Console -> Workers Logs (server) / devtools (client).
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)

  // SINKS (client only): Sentry for errors, PostHog for events. Lazy-imported so
  // the browser-only SDKs never enter the SSR/Worker bundle.
  if (!isServer) forwardToSinks(level, event, entry)

  // Client warn/error -> server, so real-user issues reach Workers Logs.
  if (!isServer && (level === 'error' || level === 'warn')) ship(line)
}

function forwardToSinks(level: LogLevel, event: string, entry: LogEntry): void {
  void import('./observability-client')
    .then(({ captureError, captureEvent }) => {
      if (level === 'error')
        captureError(entry.error ?? new Error(event), entry)
      // Every event also flows to PostHog (namespaced) for product analytics.
      captureEvent(event, entry)
    })
    .catch(() => {
      // Sinks are best-effort; never let telemetry break the app.
    })
}

function ship(line: string): void {
  try {
    if (typeof navigator.sendBeacon === 'function') {
      navigator.sendBeacon(
        '/api/log',
        new Blob([line], { type: 'application/json' }),
      )
      return
    }
    void fetch('/api/log', {
      method: 'POST',
      body: line,
      keepalive: true,
      headers: { 'content-type': 'application/json' },
    }).catch(() => {
      // ignore — best-effort; also avoids an unhandled rejection in tests/SSR
    })
  } catch {
    // Logging must never throw into the app (diagnose canon).
  }
}

export const log = {
  debug: (event: string, context?: LogContext) => emit('debug', event, context),
  info: (event: string, context?: LogContext) => emit('info', event, context),
  warn: (event: string, context?: LogContext) => emit('warn', event, context),
  /** `log.error('x.failed', err, { userId })` — error is any thrown value. */
  error: (event: string, error?: unknown, context?: LogContext) =>
    emit('error', event, {
      ...(error !== undefined ? { error: serialiseError(error) } : {}),
      ...context,
    }),
}
