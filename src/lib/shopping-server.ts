import { createServerFn } from '@tanstack/react-start'
import { consolidate, sharedAcrossMeals } from './shopping'
import type {
  HouseholdPortions,
  ShoppingLine,
  ShoppingList,
  ShoppingRecipe,
} from './shopping'

/**
 * The shopping-list view's payload: the consolidated list, the subset of lines
 * shared across more than one meal (surfaced prominently in the UI), and the
 * plan id the list was derived from. `plan` is null when the household has no
 * week planned yet, which the route renders as an empty state.
 */
export interface ShoppingListView {
  /** The plan id the list was built from (null = no plan yet). */
  planId: string | null
  /** Monday of the planned week, ISO date string (null = no plan). */
  weekStart: string | null
  /** The household portions the quantities were scaled to. */
  portions: HouseholdPortions
  /** The full consolidated list. */
  list: ShoppingList
  /** Lines used in more than one meal, in list order (the interlink view). */
  shared: Array<ShoppingLine>
}

/**
 * The minimal DB shapes the pure derivation needs. Kept here (not imported from
 * the schema) so `deriveShoppingView` stays unit-testable without a DB.
 */
export interface PlanDayRef {
  recipeRef?: string
}
export interface PlanRecipe {
  id: string
  title: string
  servings?: number | null
  ingredients: Array<{ name: string; qty?: string; unit?: string }>
}

/** An empty list, used when there is no plan or no usable recipes. */
function emptyList(): ShoppingList {
  return {
    lines: [],
    targetServings: 0,
    estimatedItems: 0,
  }
}

/**
 * Pure glue: turn a plan's day refs + the looked-up recipes + the household
 * portions into the consolidated shopping view. No DB, no I/O. This is the seam
 * the unit test exercises; the server handler below is just the DB wiring around
 * it.
 *
 * Only days that actually reference a recipe contribute. A recipe referenced by
 * the plan but missing from the catalogue is skipped rather than throwing, so a
 * stale plan still produces a list for the meals that resolve.
 */
export function deriveShoppingView(
  days: Array<PlanDayRef>,
  recipesById: Map<string, PlanRecipe>,
  portions: HouseholdPortions,
): { list: ShoppingList; shared: Array<ShoppingLine> } {
  // A recipe used on N days contributes N times. We keep one ShoppingRecipe per
  // day-occurrence so portion scaling reflects cooking it more than once.
  const recipes: Array<ShoppingRecipe> = []
  for (const d of days) {
    if (!d.recipeRef) continue
    const r = recipesById.get(d.recipeRef)
    if (!r) continue
    recipes.push({
      id: r.id,
      title: r.title,
      servings: r.servings ?? null,
      ingredients: r.ingredients.map((i) => ({
        name: i.name,
        qty: i.qty,
        unit: i.unit,
      })),
    })
  }

  if (recipes.length === 0) {
    return { list: emptyList(), shared: [] }
  }

  const list = consolidate(recipes, portions)
  return { list, shared: sharedAcrossMeals(list) }
}

/**
 * Load the signed-in household's current week plan and build its consolidated
 * shopping list. When `planId` is given the list is built from that exact plan
 * (the entry point from the week view); otherwise the household's most recent
 * plan is used (the Shopping tab's own entry point).
 *
 * Server-only: every server-only module is dynamically imported inside the
 * handler so none of it leaks into the client bundle (the week-server pattern).
 */
export const loadShoppingList = createServerFn({ method: 'GET' })
  .inputValidator((data?: { planId?: string }) => data ?? {})
  .handler(async ({ data }): Promise<ShoppingListView> => {
    const { getSessionUser } = await import('./server-auth')
    const user = await getSessionUser()
    if (!user) throw new Error('Not signed in')

    const { getDb } = await import('../db/client')
    const { household, recipe, mealPlan } = await import('../db/schema')
    const { eq, and, inArray, desc } = await import('drizzle-orm')
    const db = await getDb()

    const householdRows = await db
      .select({
        id: household.id,
        adults: household.adults,
        children: household.children,
      })
      .from(household)
      .where(eq(household.ownerId, user.id))
      .limit(1)
    const hh = householdRows[0]
    if (!hh) throw new Error('No household, onboard first')

    const portions: HouseholdPortions = {
      adults: hh.adults,
      children: hh.children,
    }

    // Resolve the plan: the requested one (scoped to this household so a
    // stranger's plan id can never be read), else the most recent.
    const planRows = data.planId
      ? await db
          .select({
            id: mealPlan.id,
            weekStart: mealPlan.weekStart,
            plan: mealPlan.plan,
          })
          .from(mealPlan)
          .where(
            and(eq(mealPlan.id, data.planId), eq(mealPlan.householdId, hh.id)),
          )
          .limit(1)
      : await db
          .select({
            id: mealPlan.id,
            weekStart: mealPlan.weekStart,
            plan: mealPlan.plan,
          })
          .from(mealPlan)
          .where(eq(mealPlan.householdId, hh.id))
          .orderBy(desc(mealPlan.createdAt))
          .limit(1)

    const current = planRows[0]
    if (!current) {
      return {
        planId: null,
        weekStart: null,
        portions,
        list: emptyList(),
        shared: [],
      }
    }

    const ids = current.plan.days
      .map((d) => d.recipeRef)
      .filter((r): r is string => !!r)

    const recipeRows = ids.length
      ? await db
          .select({
            id: recipe.id,
            title: recipe.title,
            servings: recipe.servings,
            ingredients: recipe.ingredients,
          })
          .from(recipe)
          .where(inArray(recipe.id, ids))
      : []

    const recipesById = new Map<string, PlanRecipe>(
      recipeRows.map((r) => [
        r.id,
        {
          id: r.id,
          title: r.title,
          servings: r.servings,
          ingredients: r.ingredients,
        },
      ]),
    )

    const { list, shared } = deriveShoppingView(
      current.plan.days,
      recipesById,
      portions,
    )

    return {
      planId: current.id,
      weekStart: current.weekStart,
      portions,
      list,
      shared,
    }
  })
