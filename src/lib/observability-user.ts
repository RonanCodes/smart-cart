/**
 * Pure mapping from an app session/user to the observability user context that
 * Sentry (client) and the structured logger (server) attach to events.
 *
 * Keeping this pure (no Sentry / logger imports) means it is trivially unit
 * testable and shared by both the browser (`observability-client.ts`) and the
 * server (`log.ts` context, fed from `getSessionUser()`), so a Sentry event and
 * a server log line carry the same `{ userId, email }` for the same person.
 *
 * Returns `null` for a signed-out request so callers can `Sentry.setUser(null)`
 * / clear the logger context rather than attaching a half-empty user.
 */

/** The shape Sentry's `setUser` wants and the logger merges into its context. */
export interface ObservabilityUser {
  /** Stable user id (Better Auth user.id, or the dev synthetic id). */
  id: string
  /** User email. PII, but this is a single-tenant operator app, by design. */
  email: string
}

/** A minimal session/user shape: just the fields we map. */
export interface SessionLike {
  id?: string | null
  email?: string | null
}

/**
 * Map a session/user (or absence of one) to the observability user context.
 *
 * - Signed out (`null` / `undefined`) -> `null`.
 * - A user with no usable id AND no usable email -> `null` (nothing to attach).
 * - Otherwise `{ id, email }`, with empty-string fallbacks so the shape is
 *   always complete for `Sentry.setUser`.
 */
export function toObservabilityUser(
  session: SessionLike | null | undefined,
): ObservabilityUser | null {
  if (!session) return null
  const id = session.id?.trim() ?? ''
  const email = session.email?.trim() ?? ''
  if (!id && !email) return null
  return { id, email }
}
