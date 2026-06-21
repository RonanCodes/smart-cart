import { createServerFn } from '@tanstack/react-start'
import { consolidate, sharedAcrossMeals, summariseWaste } from './shopping'
import { splitQtyAndUnit } from './shopping/parse'
import type {
  HouseholdPortions,
  ShoppingLine,
  ShoppingList,
  ShoppingRecipe,
  WasteSummary,
  ShoppingItem,
} from './shopping'
import type { StapleLine, FrequentStaple } from './staples-server'
import type { StoreSlug } from './store-pref-server'
import { pickTitle, pickIngredients } from './recipe-locale'

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
  /** The food-waste reduction summary derived from the list (slice #80). */
  waste: WasteSummary
  /**
   * True when any contributing recipe's amounts are LLM-estimated (#313), so the
   * list amounts and the waste figures should be labelled "approx" in the UI.
   */
  amountsEstimated: boolean
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
  /** True when this recipe's amounts are LLM-estimated, not from the source (#313). */
  quantitiesEstimated?: boolean | null
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
): {
  list: ShoppingList
  shared: Array<ShoppingLine>
  waste: WasteSummary
  amountsEstimated: boolean
} {
  // A recipe used on N days contributes N times. We keep one ShoppingRecipe per
  // day-occurrence so portion scaling reflects cooking it more than once.
  const recipes: Array<ShoppingRecipe> = []
  // Any contributing recipe with estimated amounts taints the whole list as
  // approx, since the consolidated totals mix its estimates in.
  let amountsEstimated = false
  for (const d of days) {
    if (!d.recipeRef) continue
    const r = recipesById.get(d.recipeRef)
    if (!r) continue
    if (r.quantitiesEstimated) amountsEstimated = true
    recipes.push({
      id: r.id,
      title: r.title,
      servings: r.servings ?? null,
      ingredients: r.ingredients.map((i) => {
        // Scraped / seeded recipes pack the amount and the unit into a single
        // `qty` field ("350 g", "2 el") with no separate `unit`. Split them so
        // the engine can parse the number AND normalise the unit, instead of
        // treating "350 g" as an unparsable note and dropping the amount (#238).
        // When the source already gave a separate unit we trust it untouched.
        if (i.unit && i.unit.trim() !== '') {
          return { name: i.name, qty: i.qty, unit: i.unit }
        }
        const split = splitQtyAndUnit(i.qty)
        return { name: i.name, qty: split.qty, unit: split.unit }
      }),
    })
  }

  if (recipes.length === 0) {
    const empty = emptyList()
    return {
      list: empty,
      shared: [],
      waste: summariseWaste(empty),
      amountsEstimated: false,
    }
  }

  const list = consolidate(recipes, portions)
  return {
    list,
    shared: sharedAcrossMeals(list),
    waste: summariseWaste(list),
    amountsEstimated,
  }
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
      const empty = emptyList()
      return {
        planId: null,
        weekStart: null,
        portions,
        list: empty,
        shared: [],
        waste: summariseWaste(empty),
        amountsEstimated: false,
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
            titleEn: recipe.titleEn,
            servings: recipe.servings,
            ingredients: recipe.ingredients,
            ingredientsEn: recipe.ingredientsEn,
            quantitiesEstimated: recipe.quantitiesEstimated,
          })
          .from(recipe)
          .where(inArray(recipe.id, ids))
      : []

    // Default the shopping ingredient names to English (Dutch fallback) so the
    // demo list reads in English; quantities are language-agnostic (#295).
    const recipesById = new Map<string, PlanRecipe>(
      recipeRows.map((r) => [
        r.id,
        {
          id: r.id,
          title: pickTitle(r.title, r.titleEn),
          servings: r.servings,
          ingredients: pickIngredients(r.ingredients, r.ingredientsEn),
          quantitiesEstimated: r.quantitiesEstimated,
        },
      ]),
    )

    const { list, shared, waste, amountsEstimated } = deriveShoppingView(
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
      waste,
      amountsEstimated,
    }
  })

/** Everything the /shopping route's loader needs, in one round-trip (#251). */
export interface ShoppingBootstrap {
  view: ShoppingListView
  staples: Array<StapleLine>
  frequentlyBought: Array<FrequentStaple>
  items: Array<ShoppingItem>
  preferredStore: StoreSlug
}

/**
 * The /shopping loader, batched into ONE round-trip (#251). The route used to fan
 * out five GET server fns per visit (loadShoppingList + loadStaples +
 * frequentlyBoughtStaples + listShoppingItems + getStore) plus a conditional
 * auto-seed write. This composes the same reads INSIDE one server handler.
 *
 * Auto-seed intent is now DURABLE (#311): a plan auto-seeds exactly once, keyed
 * on the household's `lastSeededPlanId`, so an explicit "Clear all" stays cleared
 * across navigations (same plan id, already seeded -> no re-seed) and only a NEW
 * plan re-seeds. The old `cleared` search-param was ephemeral and lost on a
 * fresh visit, which let the loader re-fill a just-cleared list.
 */
export const loadShoppingBootstrap = createServerFn({ method: 'GET' })
  .inputValidator((d?: { planId?: string }) => d ?? {})
  .handler(async ({ data }): Promise<ShoppingBootstrap> => {
    const { loadStaples, frequentlyBoughtStaples } =
      await import('./staples-server')
    const {
      listShoppingItems,
      addWeekToShoppingList,
      backfillShoppingAmounts,
      getLastSeededPlanId,
      markPlanSeeded,
    } = await import('./shopping-list-server')
    const { getStore } = await import('./store-pref-server')
    const { shouldAutoSeed } = await import('./shopping')

    const planArg = data.planId ? { planId: data.planId } : {}
    const [view, staplesRes, frequentRes, itemsRes, preferredStore, seedState] =
      await Promise.all([
        loadShoppingList({ data: planArg }),
        loadStaples(),
        frequentlyBoughtStaples(),
        listShoppingItems(),
        getStore(),
        getLastSeededPlanId(),
      ])

    let items = itemsRes.items
    if (
      shouldAutoSeed({
        planId: view.planId,
        lastSeededPlanId: seedState.lastSeededPlanId,
      })
    ) {
      const seeded = await addWeekToShoppingList({ data: planArg })
      items = seeded.items
      if (view.planId) await markPlanSeeded({ data: { planId: view.planId } })
    } else {
      // Existing list: top up any stale recipe rows whose amount was dropped
      // before the Dutch-qty split shipped (#243), matched against the current
      // week, without clobbering user-typed amounts (#292). A no-op when nothing
      // is stale, so the common case stays a single extra cheap read.
      const filled = await backfillShoppingAmounts({ data: planArg })
      items = filled.items
    }

    return {
      view,
      staples: staplesRes.staples,
      frequentlyBought: frequentRes.items,
      items,
      preferredStore,
    }
  })
