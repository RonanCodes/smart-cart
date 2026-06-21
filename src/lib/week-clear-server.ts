import { createServerFn } from '@tanstack/react-start'

export interface ClearDayRequest {
  /** The plan id to edit (the current week). */
  planId: string
  /** The day to clear / skip, e.g. "Tuesday". */
  day: string
}

export interface ClearDayResponse {
  /** The new meal_plan revision id (a fresh row; the old one is kept). */
  planId: string
}

/**
 * Remove / skip a dinner on a day the household will not cook (#255).
 *
 * The user opened a day on the week view and chose "Remove this dinner". This
 * clears that day: the recipe reference and the denormalised meal label are
 * emptied and the day is marked `type: 'out'` (the existing eating-out concept the
 * planner already understands). The day keeps its slot in the week, so the card
 * flips to the empty "No dinner, Add one" state (DayCard renders that for any day
 * with no recipeRef) and the "Add a meal" flow can refill it later.
 *
 * Crucially this makes the day drop out of the shopping list AND the cart with no
 * extra wiring: every list derivation already ignores a day with no recipeRef
 * (shopping-server.deriveShoppingView skips `!d.recipeRef`; addWeekToShoppingList
 * + countMissingFromWeek + the cart links all derive from that same view). So a
 * skipped day's ingredients can never reach the list or the cart.
 *
 * The plan is validated against the signed-in household, so a stranger's plan id
 * is rejected. The edit is written as a NEW meal_plan revision (we never overwrite
 * the old week, mirroring swap-server / replan-server), so removing a day is
 * reversible from history.
 *
 * Server-only: every server-only module is dynamically imported INSIDE the handler
 * so none of it leaks into the client bundle (the week-server / swap-server
 * pattern).
 */
export const clearDayInPlan = createServerFn({ method: 'POST' })
  .validator((data: ClearDayRequest) => data)
  .handler(async ({ data }): Promise<ClearDayResponse> => {
    if (!data.day) throw new Error('day required')

    const { getSessionUser } = await import('./server-auth')
    const user = await getSessionUser()
    if (!user) throw new Error('Not signed in')

    const { getDb } = await import('../db/client')
    const { household, mealPlan } = await import('../db/schema')
    const { eq, and } = await import('drizzle-orm')
    const { clearDay, planHasDay } = await import('./swap/clear-day')
    const db = await getDb()

    const householdRows = await db
      .select({ id: household.id })
      .from(household)
      .where(eq(household.ownerId, user.id))
      .limit(1)
    const hh = householdRows[0]
    if (!hh) throw new Error('No household, onboard first')

    const planRows = await db
      .select({
        id: mealPlan.id,
        weekStart: mealPlan.weekStart,
        plan: mealPlan.plan,
      })
      .from(mealPlan)
      .where(and(eq(mealPlan.id, data.planId), eq(mealPlan.householdId, hh.id)))
      .limit(1)
    const current = planRows[0]
    if (!current) throw new Error('Plan not found')

    if (!planHasDay(current.plan.days, data.day)) {
      throw new Error('Day not in plan')
    }

    const nextDays = clearDay(current.plan.days, data.day)

    // Persist a new revision. We keep the old row so a removed day is reversible,
    // exactly as swap-server / replan-server do.
    const newId = crypto.randomUUID()
    await db.insert(mealPlan).values({
      id: newId,
      householdId: hh.id,
      weekStart: current.weekStart,
      plan: {
        days: nextDays,
        shoppingList: current.plan.shoppingList,
      },
      status: 'draft',
    })

    return { planId: newId }
  })
