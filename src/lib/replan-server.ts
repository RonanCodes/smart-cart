import { createServerFn } from '@tanstack/react-start'
import type { PlannedWeek } from './planner/types'

/**
 * Structured, model-free week edits for the one-tap UI actions (the DayCard swap
 * button, an eating-out toggle). These are already-structured intents from a
 * button press, so they go straight to the planner-grounded `WeekSession` with NO
 * language model: instant, deterministic, and working with no API key.
 *
 * Free-text and voice replans go through the streaming agent instead
 * (`/api/replan` and the VAPI tool), which needs the key. Splitting the two keeps
 * a button press from ever burning a model call or pretending to be prose.
 */
export interface ReplanRequest {
  /** The plan id to edit (the current week). */
  planId: string
  /** The structured action a button triggered. */
  action: 'swap' | 'skip'
  /** The day labels the action targets. */
  days: Array<string>
}

export interface ReplanResponse {
  /** The new meal_plan revision id (a fresh row; the old one is kept). */
  planId: string
  /** Monday of the week, ISO date string. */
  weekStart: string
  /** The new week. */
  week: PlannedWeek
  /** Whether the week actually changed. */
  changed: boolean
  /** A short message for the user. */
  message: string
}

/**
 * Apply a structured edit to the signed-in household's week and persist a new
 * revision. Server-only: every server-only module is dynamically imported inside
 * the handler so none of it leaks into the client bundle.
 */
export const replanWeek = createServerFn({ method: 'POST' })
  .validator((data: ReplanRequest) => data)
  .handler(async ({ data }): Promise<ReplanResponse> => {
    const { getSessionUser } = await import('./server-auth')
    const user = await getSessionUser()
    if (!user) throw new Error('Not signed in')

    const { loadReplanContextForUser, persistRevision } =
      await import('./agent/replan-context-server')
    const ctx = await loadReplanContextForUser(user.id, data.planId)
    if (!ctx) throw new Error('Plan not found')

    const { WeekSession } = await import('./agent/week-session')
    const session = new WeekSession({
      week: ctx.week,
      recipes: ctx.recipes,
      profile: ctx.profile,
      swipes: ctx.swipes,
      penalties: ctx.penalties,
    })

    const edit =
      data.action === 'skip'
        ? session.skipDays(data.days)
        : session.swapDays(data.days)
    const week = session.getWeek()

    let planId = ctx.planId
    if (edit.changed) {
      planId = await persistRevision(ctx.householdId, ctx.weekStart, week)
    }

    return {
      planId,
      weekStart: ctx.weekStart,
      week,
      changed: edit.changed,
      message: edit.summary,
    }
  })
