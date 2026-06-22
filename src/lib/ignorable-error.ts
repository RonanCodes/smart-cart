/**
 * Benign network/abort errors that should NOT reach Sentry as exceptions.
 *
 * SOUSO-A/Y/X (#417): a TanStack `createServerFn` round trip's underlying
 * `fetch` rejects when the user navigates away mid-flight, backgrounds the tab,
 * or loses connectivity. The browser surfaces this as `TypeError: Load failed`
 * (iOS Safari), `TypeError: Failed to fetch` (Chromium), or
 * `NetworkError when attempting to fetch resource.` (Firefox); an explicitly
 * aborted fetch surfaces as a `DOMException`/`Error` named `AbortError`.
 *
 * These are expected blips, not actionable crashes, and they were burying the
 * real signal. The client `beforeSend` and the server forward both drop them
 * via this pure predicate.
 *
 * PRECISION MATTERS: only the exact known-benign signatures match. A real app
 * error (`Cannot read properties of undefined`, `week is not iterable`, or a
 * message that merely mentions "load" elsewhere) must still report. The pure +
 * exported shape keeps this unit-testable without booting Sentry.
 */

/** Whole-string messages a benign network failure produces, lower-cased. */
const BENIGN_MESSAGES = new Set([
  'load failed',
  'failed to fetch',
  'networkerror when attempting to fetch resource.',
  'networkerror when attempting to fetch resource',
])

/** Error `name`s that mark an aborted request. */
const BENIGN_NAMES = new Set(['aborterror'])

/**
 * Pull `{ name, message }` out of whatever was thrown: a real `Error`, the
 * serialised `{ name, message, stack }` shape `log.ts` ships, or a bare string.
 * Anything else yields empty strings (and is therefore treated as real).
 */
function nameAndMessage(err: unknown): { name: string; message: string } {
  if (typeof err === 'string') return { name: '', message: err }
  if (err && typeof err === 'object') {
    const o = err as { name?: unknown; message?: unknown }
    return {
      name: typeof o.name === 'string' ? o.name : '',
      message: typeof o.message === 'string' ? o.message : '',
    }
  }
  return { name: '', message: '' }
}

/**
 * True if `err` is a known-benign client network / navigation-abort failure
 * that should be dropped from Sentry rather than reported as an exception.
 * Never throws; unrecognised input is treated as a real error (returns false).
 */
export function isIgnorableNetworkError(err: unknown): boolean {
  try {
    const { name, message } = nameAndMessage(err)
    if (BENIGN_NAMES.has(name.trim().toLowerCase())) return true
    return BENIGN_MESSAGES.has(message.trim().toLowerCase())
  } catch {
    // Observability must never crash a request (diagnose canon).
    return false
  }
}

/**
 * The slice of a Sentry event we read in `beforeSend`: the exception values
 * carry `{ type, value }` (Sentry's name/message). Typed loosely so we don't
 * couple to the SDK's full event type.
 */
interface SentryEventLike {
  exception?: { values?: Array<{ type?: unknown; value?: unknown }> }
}

/**
 * `beforeSend` predicate: true when a Sentry event is a known-benign
 * network/abort blip and should be dropped (returned as `null`). Maps the
 * exception's `{ type, value }` onto `isIgnorableNetworkError`'s `{ name,
 * message }`. Never throws; an unreadable event is kept (returns false).
 */
export function shouldDropSentryEvent(
  event: SentryEventLike | undefined,
): boolean {
  try {
    const values = event?.exception?.values
    if (!values || values.length === 0) return false
    // Drop only if EVERY captured exception is benign, so a real error chained
    // alongside a network blip still reports.
    return values.every((v) =>
      isIgnorableNetworkError({ name: v.type, message: v.value }),
    )
  } catch {
    // Observability must never crash a request (diagnose canon).
    return false
  }
}
