import { createServerFn } from '@tanstack/react-start'
import type { PlannedWeek } from './planner/types'

export interface GeneratePlanResult {
  /** The stable meal_plan id the week view reads. */
  planId: string
  /** Monday of the planned week, ISO date string. */
  weekStart: string
  /** The generated week, seven dinners one per day. */
  week: PlannedWeek
}

/**
 * Generate (or regenerate) the SIGNED-IN household's week. Thin server-fn wrapper
 * that resolves the user -> their household, then delegates to the shared
 * server-only core in planner-core (dynamically imported so the DB / Worker
 * deps never leak into the client bundle).
 */
export const generatePlan = createServerFn({ method: 'POST' }).handler(
  async (): Promise<GeneratePlanResult> => {
    const { getSessionUser } = await import('./server-auth')
    const user = await getSessionUser()
    if (!user) throw new Error('Not signed in')

    const { getDb } = await import('../db/client')
    const { household } = await import('../db/schema')
    const { generatePlanForHousehold } = await import('./planner-core')
    const { eq } = await import('drizzle-orm')
    const db = await getDb()

    const rows = await db
      .select({ id: household.id })
      .from(household)
      .where(eq(household.ownerId, user.id))
      .limit(1)
    const hh = rows[0]
    if (!hh) throw new Error('No household, onboard first')

    return generatePlanForHousehold(hh.id)
  },
)
