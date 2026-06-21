/**
 * Server-side Sentry forwarding for client-shipped errors.
 *
 * Why this exists: Sentry is client-only (`@sentry/react`), so a browser
 * ad-blocker (Brave shields, uBlock) blocks the Sentry browser transport the
 * same way it blocks PostHog ingest (`ERR_BLOCKED_BY_CLIENT`). When that
 * happens, an error caught by the React error boundary reaches Workers Logs (via
 * the same-origin `/api/log` beacon) but never reaches Sentry.
 *
 * The fix: the `/api/log` Worker handler forwards `error`-level entries to Sentry
 * by POSTing a Sentry *envelope* directly to the ingest URL derived from the DSN.
 * This runs server-side (same Worker), so it is NOT subject to the browser's
 * ad-blocker — the error always lands in Sentry.
 *
 * No SDK needed: an envelope is just newline-delimited JSON over HTTP.
 *
 * Observability must never crash a request (diagnose canon): every path here is
 * wrapped so a failure is swallowed; the caller still returns 204.
 */
import { SENTRY_DSN as SENTRY_DSN_CLIENT } from '#/config/observability'
import { readEnv } from './env'

interface ParsedDsn {
  /** Sentry ingest origin, e.g. `o123.ingest.de.sentry.io`. */
  host: string
  /** The public key (the `sentry_key` query param). */
  publicKey: string
  /** The numeric project id at the end of the DSN path. */
  projectId: string
}

/**
 * Parse a Sentry DSN of the form
 * `https://<publicKey>@<host>/<projectId>` into its parts. Returns null if it
 * doesn't look like a DSN, so the caller no-ops rather than throwing.
 */
export function parseDsn(dsn: string | undefined): ParsedDsn | null {
  if (!dsn) return null
  try {
    const url = new URL(dsn)
    const publicKey = url.username
    // Path is `/<projectId>` (sometimes `/<path>/<projectId>`); take the last
    // non-empty segment as the project id.
    const segments = url.pathname.split('/').filter(Boolean)
    const projectId = segments[segments.length - 1]
    if (!publicKey || !projectId) return null
    return { host: url.host, publicKey, projectId }
  } catch {
    return null
  }
}

/**
 * Build the Sentry envelope ingest URL from a parsed DSN:
 * `https://<host>/api/<projectId>/envelope/?sentry_key=<publicKey>&sentry_version=7`.
 */
export function ingestUrl(dsn: ParsedDsn): string {
  return `https://${dsn.host}/api/${dsn.projectId}/envelope/?sentry_key=${dsn.publicKey}&sentry_version=7`
}

/** A 32-char hex event id (crypto.randomUUID without the dashes). */
function eventId(): string {
  return crypto.randomUUID().replace(/-/g, '')
}

interface SerialisedError {
  name?: unknown
  message?: unknown
  stack?: unknown
}

/**
 * Reconstruct a readable Sentry exception value from the `{ name, message,
 * stack }` shape `log.ts` serialises a thrown value into (mirrors
 * `materialiseError` in observability-client.ts). Parses the stack into frames
 * so Sentry shows a real stacktrace instead of an opaque blob.
 */
function buildException(err: SerialisedError) {
  const type = typeof err.name === 'string' && err.name ? err.name : 'Error'
  const value =
    typeof err.message === 'string' && err.message ? err.message : 'Error'
  const stack = typeof err.stack === 'string' ? err.stack : undefined
  const frames = stack ? parseStackFrames(stack) : undefined
  return {
    type,
    value,
    ...(frames && frames.length
      ? { stacktrace: { frames } }
      : stack
        ? { stacktrace: { frames: [{ function: stack }] } }
        : {}),
  }
}

/**
 * Best-effort parse of a V8-style stack string into Sentry frames. Sentry wants
 * frames in caller-first order (innermost last), so we reverse the lines.
 */
function parseStackFrames(stack: string) {
  const lines = stack.split('\n').slice(1) // drop the "Name: message" header
  const frames = lines
    .map((line) => line.trim())
    .filter((line) => line.startsWith('at '))
    .map((line) => {
      // `at fnName (file:line:col)` or `at file:line:col`
      const m = line.match(/^at\s+(?:(.*?)\s+\()?(.*?):(\d+):(\d+)\)?$/)
      if (!m) return { function: line.replace(/^at\s+/, '') }
      const [, fn, file, lineNo, colNo] = m
      return {
        ...(fn ? { function: fn } : {}),
        filename: file,
        lineno: Number(lineNo),
        colno: Number(colNo),
      }
    })
  return frames.reverse()
}

/**
 * Resolve the Sentry DSN server-side: prefer a Worker env / `.dev.vars`
 * `SENTRY_DSN` override, else fall back to the committed client default (the DSN
 * is publishable — it only allows sending events).
 */
async function resolveDsn(): Promise<string | undefined> {
  const fromEnv = await readEnv('SENTRY_DSN')
  return fromEnv ?? SENTRY_DSN_CLIENT
}

/** The shape `/api/log` receives from the client ship (`log.ts` emit()). */
export interface ClientLogBody {
  level?: unknown
  event?: unknown
  ts?: unknown
  error?: SerialisedError
  [key: string]: unknown
}

/**
 * POST a built Sentry event payload as an envelope to the ingest URL. Fully
 * guarded: resolves the DSN, builds the 3-line envelope, fires the fetch, and
 * swallows every failure. Shared by the client-forward and server-capture paths
 * so the envelope wire-format lives in one place. Never throws.
 */
async function sendEvent(
  eventPayload: Record<string, unknown> & { event_id: string },
): Promise<void> {
  const dsn = parseDsn(await resolveDsn())
  if (!dsn) return

  const envelope =
    JSON.stringify({
      event_id: eventPayload.event_id,
      sent_at: new Date().toISOString(),
    }) +
    '\n' +
    JSON.stringify({ type: 'event' }) +
    '\n' +
    JSON.stringify(eventPayload)

  await fetch(ingestUrl(dsn), {
    method: 'POST',
    headers: { 'content-type': 'application/x-sentry-envelope' },
    body: envelope,
  }).catch(() => {
    // ingest failure is best-effort; never propagate into the request path.
  })
}

/**
 * Forward an `error`-level client log entry to Sentry by POSTing an envelope to
 * the ingest URL. Fire-and-forget and fully guarded: never throws, so the
 * caller's 204 is unaffected. Returns the fetch promise so a caller with access
 * to a Cloudflare execution context could pass it to `ctx.waitUntil`; callers
 * without one can simply `void` it.
 */
export async function forwardErrorToSentry(body: ClientLogBody): Promise<void> {
  try {
    const id = eventId()
    const error = body.error ?? {}

    // Everything that isn't a recognised top-level field becomes `extra`.
    const { level: _l, event, ts: _ts, error: _e, ...rest } = body
    void _l
    void _ts
    void _e

    await sendEvent({
      event_id: id,
      timestamp: Date.now() / 1000,
      platform: 'javascript',
      level: 'error',
      logger: 'client-ship',
      environment: 'production',
      exception: { values: [buildException(error)] },
      tags: {
        ...(typeof event === 'string' ? { log_event: event } : {}),
        origin: 'client-via-server',
      },
      extra: rest,
    })
  } catch {
    // Observability must never crash a request (diagnose canon).
  }
}

/**
 * Capture an UNHANDLED SERVER error to Sentry by POSTing an envelope server-side.
 * This is the missing half of observability: server-side throws (the real 500s on
 * gated `/_serverFn/*` calls) never reached Sentry, only client errors did.
 *
 * Tagged `origin: 'server'` so it's distinguishable from the client-via-server
 * forward. Fully guarded and fire-and-forget: it NEVER throws, so wiring it into
 * the request path can't crash a request (diagnose canon). The caller reports the
 * error here and then rethrows / returns the response unchanged — this only
 * ADDITIONALLY reports, it never swallows.
 */
export async function captureServerError(
  err: SerialisedError,
  context?: { url?: string; status?: number; [key: string]: unknown },
): Promise<void> {
  try {
    await sendEvent({
      event_id: eventId(),
      timestamp: Date.now() / 1000,
      platform: 'javascript',
      level: 'error',
      logger: 'server',
      environment: 'production',
      exception: { values: [buildException(err)] },
      tags: { origin: 'server' },
      ...(context ? { extra: context } : {}),
    })
  } catch {
    // Observability must never crash a request (diagnose canon).
  }
}
