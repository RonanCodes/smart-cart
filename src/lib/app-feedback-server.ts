import { createServerFn } from '@tanstack/react-start'
import { normaliseFeedback } from './app-feedback'
import type { FeedbackInput } from './app-feedback'

export interface SubmitFeedbackResponse {
  ok: boolean
}

/**
 * Persist a piece of general in-app feedback (#404) to the `app_feedback` table —
 * the inbox the admin reads on /admin/feedback. Free-text only; the recipe-scoped
 * taste signal stays in `meal_feedback`.
 *
 * Validation runs through the pure `normaliseFeedback` (unit-tested in
 * app-feedback.test.ts): an empty / whitespace-only message is rejected, a
 * malformed email is rejected, an over-long message is clamped. We attach the
 * signed-in user's id + email when there is a session, but a signed-out visitor
 * can still send feedback (userId null), so the affordance works app-wide.
 *
 * Server-only: every server-only module (auth, db client, schema) is dynamically
 * imported inside the handler so none of it leaks into the client bundle (the
 * week-server / meal-feedback-server pattern — the `cloudflare:workers` chain in
 * db/client.ts must never be statically reachable from a client route).
 */
export const submitFeedback = createServerFn({ method: 'POST' })
  .validator((data: FeedbackInput) => data)
  .handler(async ({ data }): Promise<SubmitFeedbackResponse> => {
    const result = normaliseFeedback(data)
    if (!result.ok) throw new Error(result.error)
    const clean = result.value

    // Best-effort identity: attach the session user when there is one, but never
    // block a guest's feedback on the auth lookup.
    let userId: string | null = null
    let sessionEmail: string | null = null
    try {
      const { getSessionUser } = await import('./server-auth')
      const user = await getSessionUser()
      if (user) {
        userId = user.id
        sessionEmail = user.email
      }
    } catch {
      // Signed-out or a transient session error: still store the feedback.
    }

    const { getDb } = await import('../db/client')
    const { appFeedback } = await import('../db/app-feedback-schema')
    const db = await getDb()

    await db.insert(appFeedback).values({
      id: crypto.randomUUID(),
      userId,
      // Prefer the email the sender typed; fall back to their session email.
      email: clean.email ?? sessionEmail,
      message: clean.message,
      source: clean.source,
      path: clean.path,
      createdAt: new Date(),
    })

    return { ok: true }
  })

export interface AppFeedbackItem {
  id: string
  userId: string | null
  email: string | null
  message: string
  source: string
  path: string | null
  createdAtMs: number
}

/**
 * List the most recent general feedback messages, newest first, for the admin
 * inbox on /admin/feedback. Admin-gated by the admin route's beforeLoad guard;
 * this read returns nothing sensitive beyond the message + optional contact.
 */
export const listAppFeedback = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Array<AppFeedbackItem>> => {
    const { getDb } = await import('../db/client')
    const { appFeedback } = await import('../db/app-feedback-schema')
    const { desc } = await import('drizzle-orm')
    const db = await getDb()

    const rows = await db
      .select()
      .from(appFeedback)
      .orderBy(desc(appFeedback.createdAt))
      .limit(200)

    return rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      email: r.email,
      message: r.message,
      source: r.source,
      path: r.path,
      createdAtMs: r.createdAt.getTime(),
    }))
  },
)
