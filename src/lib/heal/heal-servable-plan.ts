/**
 * Heal a stored meal plan's days against the servable dinner catalogue and
 * persist a new revision when something changed. Shared by the week view and the
 * shopping list so existing plans/carts that still reference removed non-dinner
 * recipes (crackers, smoothies, bijgerechten, …) are repaired on load.
 */

import type { getDb } from '../../db/client'
import { mealPlan } from '../../db/schema'
import type {
  PlannerProfile,
  PlannerRecipe,
  PlannerSwipe,
  SoftPenalties,
} from '../planner/types'
import { topNForDay } from '../planner/planner'
import { healWeekPlan } from './heal-week-plan'
import type { HealPlanDay } from './heal-week-plan'

type AppDb = Awaited<ReturnType<typeof getDb>>

export interface StoredMealPlan {
  id: string
  weekStart: string
  plan: {
    days: Array<HealPlanDay>
    shoppingList: Array<{ item: string; qty: string }>
  }
}

export interface HealPlanDaysOptions {
  days: ReadonlyArray<HealPlanDay>
  servableIds: ReadonlySet<string>
  catalogue: Array<PlannerRecipe>
  profile: PlannerProfile
  swipes: Array<PlannerSwipe>
  penalties: SoftPenalties
}

export function healPlanDays({
  days,
  servableIds,
  catalogue,
  profile,
  swipes,
  penalties,
}: HealPlanDaysOptions): { days: Array<HealPlanDay>; changed: boolean } {
  return healWeekPlan(days, servableIds, (day, excludeIds) => {
    const pick = topNForDay(catalogue, profile, swipes, {
      excludeRecipeId: day.recipeRef || null,
      weekRecipeIds: Array.from(excludeIds),
      dayType: day.type ?? 'home',
      n: 1,
      penalties,
    })[0]
    return pick ? { id: pick.id, title: pick.title } : null
  })
}

export async function persistHealedPlanIfChanged(
  db: AppDb,
  householdId: string,
  current: StoredMealPlan,
  healedDays: Array<HealPlanDay>,
  changed: boolean,
): Promise<string> {
  if (!changed) return current.id
  const newId = crypto.randomUUID()
  await db.insert(mealPlan).values({
    id: newId,
    householdId,
    weekStart: current.weekStart,
    plan: {
      days: healedDays,
      shoppingList: current.plan.shoppingList,
    },
    status: 'draft',
  })
  return newId
}
