import { createServerFn } from '@tanstack/react-start'
import { lineToNewItem, planMerge } from './shopping'
import type { ShoppingItem, ShoppingItemSource } from './shopping'
import type { getDb } from '../db/client'

/** The drizzle db handle, named so the shared re-read avoids an inline import type. */
type Db = Awaited<ReturnType<typeof getDb>>

/**
 * The PERSISTED shopping list: durable, household-scoped, fully editable.
 *
 * Two halves, mirroring the staples / waitlist split:
 *  - Pure glue (merge / dedupe of recipe lines, amount summing) lives in
 *    `./shopping/persist.ts` and is unit-tested without a DB.
 *  - The server fns below wrap a D1 query around that glue. Every server-only
 *    module is dynamically imported INSIDE the handler so none of it leaks into
 *    the client bundle (the staples-server / week-server pattern).
 *
 * All reads and writes are scoped to the signed-in user's household, so a
 * stranger's id is always inert.
 */

/** Resolve the signed-in user's household id, or throw. Server-only. */
async function requireHouseholdId(): Promise<string> {
  const { getSessionUser } = await import('./server-auth')
  const user = await getSessionUser()
  if (!user) throw new Error('Not signed in')

  const { getDb } = await import('../db/client')
  const { household } = await import('../db/schema')
  const { eq } = await import('drizzle-orm')
  const db = await getDb()
  const rows = await db
    .select({ id: household.id })
    .from(household)
    .where(eq(household.ownerId, user.id))
    .limit(1)
  const hh = rows[0]
  if (!hh) throw new Error('No household, onboard first')
  return hh.id
}

/** Map a DB row to the client-facing item shape (timestamp -> epoch ms). */
function rowToItem(row: {
  id: string
  name: string
  amount: string | null
  unit: string | null
  checked: boolean
  source: string
  createdAt: Date
}): ShoppingItem {
  return {
    id: row.id,
    name: row.name,
    amount: row.amount,
    unit: row.unit,
    checked: row.checked,
    source: row.source as ShoppingItemSource,
    createdAt: row.createdAt.getTime(),
  }
}

/** Shared re-read: the household's list, oldest first so order is stable. */
async function reloadItems(
  db: Db,
  householdId: string,
): Promise<{ items: Array<ShoppingItem> }> {
  const { shoppingListItem } = await import('../db/shopping-list-schema')
  const { eq, asc } = await import('drizzle-orm')
  const rows = await db
    .select()
    .from(shoppingListItem)
    .where(eq(shoppingListItem.householdId, householdId))
    .orderBy(asc(shoppingListItem.createdAt))
  return { items: rows.map(rowToItem) }
}

/** Load the household's persisted shopping list. */
export const listShoppingItems = createServerFn({ method: 'GET' }).handler(
  async (): Promise<{ items: Array<ShoppingItem> }> => {
    const householdId = await requireHouseholdId()
    const { getDb } = await import('../db/client')
    const db = await getDb()
    return reloadItems(db, householdId)
  },
)

/**
 * Add the current week's recipe ingredients to the persisted list. Derives the
 * consolidated, portion-scaled list with the SAME logic the Shopping tab shows
 * (loadShoppingList), then merges those lines into whatever the household
 * already has: a line matching an existing row by normalised name folds its
 * amount in (summed where the units line up, else concatenated) rather than
 * adding a duplicate, so pressing the CTA twice does not double the list.
 */
export const addWeekToShoppingList = createServerFn({ method: 'POST' })
  .inputValidator((d?: { planId?: string }) => d ?? {})
  .handler(async ({ data }): Promise<{ items: Array<ShoppingItem> }> => {
    const householdId = await requireHouseholdId()
    const { getDb } = await import('../db/client')
    const db = await getDb()

    // Reuse the exact derivation the Shopping tab renders, so the persisted
    // list matches what the user just saw.
    const { loadShoppingList } = await import('./shopping-server')
    const view = await loadShoppingList({
      data: data.planId ? { planId: data.planId } : {},
    })
    const incoming = view.list.lines.map(lineToNewItem)

    if (incoming.length === 0) return reloadItems(db, householdId)

    const { items: existing } = await reloadItems(db, householdId)
    const plan = planMerge(existing, incoming)

    const { shoppingListItem } = await import('../db/shopping-list-schema')
    const { eq, and } = await import('drizzle-orm')

    if (plan.inserts.length > 0) {
      await db.insert(shoppingListItem).values(
        plan.inserts.map((line) => ({
          id: crypto.randomUUID(),
          householdId,
          name: line.name,
          amount: line.amount,
          unit: line.unit,
          checked: false,
          source: line.source,
        })),
      )
    }

    for (const u of plan.updates) {
      await db
        .update(shoppingListItem)
        .set({ amount: u.amount })
        .where(
          and(
            eq(shoppingListItem.id, u.id),
            eq(shoppingListItem.householdId, householdId),
          ),
        )
    }

    return reloadItems(db, householdId)
  })

/** Add one manual item (name + optional amount). */
export const addShoppingItem = createServerFn({ method: 'POST' })
  .inputValidator((d: { name: unknown; amount?: unknown }) => ({
    name: String(d.name ?? '').trim(),
    amount:
      d.amount === undefined || d.amount === null
        ? null
        : String(d.amount).trim() || null,
  }))
  .handler(async ({ data }): Promise<{ items: Array<ShoppingItem> }> => {
    const householdId = await requireHouseholdId()
    const { getDb } = await import('../db/client')
    const db = await getDb()
    if (!data.name) return reloadItems(db, householdId)

    const { shoppingListItem } = await import('../db/shopping-list-schema')
    await db.insert(shoppingListItem).values({
      id: crypto.randomUUID(),
      householdId,
      name: data.name,
      amount: data.amount,
      unit: null,
      checked: false,
      source: 'manual',
    })
    return reloadItems(db, householdId)
  })

/**
 * Update one item: any of name / amount / checked. Only the provided fields
 * change. Scoped to the household so a stranger's id is inert.
 */
export const updateShoppingItem = createServerFn({ method: 'POST' })
  .inputValidator(
    (d: {
      id: unknown
      name?: unknown
      amount?: unknown
      checked?: unknown
    }) => ({
      id: String(d.id ?? ''),
      name: d.name === undefined ? undefined : String(d.name).trim(),
      amount:
        d.amount === undefined
          ? undefined
          : d.amount === null
            ? null
            : String(d.amount).trim() || null,
      checked: d.checked === undefined ? undefined : Boolean(d.checked),
    }),
  )
  .handler(async ({ data }): Promise<{ items: Array<ShoppingItem> }> => {
    const householdId = await requireHouseholdId()
    const { getDb } = await import('../db/client')
    const db = await getDb()
    if (!data.id) return reloadItems(db, householdId)

    const patch: {
      name?: string
      amount?: string | null
      checked?: boolean
    } = {}
    // An empty name is ignored: never blank out the only label a row has.
    if (data.name !== undefined && data.name !== '') patch.name = data.name
    if (data.amount !== undefined) patch.amount = data.amount
    if (data.checked !== undefined) patch.checked = data.checked

    if (Object.keys(patch).length > 0) {
      const { shoppingListItem } = await import('../db/shopping-list-schema')
      const { eq, and } = await import('drizzle-orm')
      await db
        .update(shoppingListItem)
        .set(patch)
        .where(
          and(
            eq(shoppingListItem.id, data.id),
            eq(shoppingListItem.householdId, householdId),
          ),
        )
    }
    return reloadItems(db, householdId)
  })

/** Remove one item by id (scoped to the household). */
export const removeShoppingItem = createServerFn({ method: 'POST' })
  .inputValidator((d: { id: unknown }) => ({ id: String(d.id ?? '') }))
  .handler(async ({ data }): Promise<{ items: Array<ShoppingItem> }> => {
    const householdId = await requireHouseholdId()
    const { getDb } = await import('../db/client')
    const db = await getDb()
    if (!data.id) return reloadItems(db, householdId)

    const { shoppingListItem } = await import('../db/shopping-list-schema')
    const { eq, and } = await import('drizzle-orm')
    await db
      .delete(shoppingListItem)
      .where(
        and(
          eq(shoppingListItem.id, data.id),
          eq(shoppingListItem.householdId, householdId),
        ),
      )
    return reloadItems(db, householdId)
  })

/**
 * Bulk helpers, cheap to add and high-value on a checklist: tick (or untick)
 * everything, and clear the whole list. Both scoped to the household.
 */
export const setAllChecked = createServerFn({ method: 'POST' })
  .inputValidator((d: { checked: unknown }) => ({
    checked: Boolean(d.checked),
  }))
  .handler(async ({ data }): Promise<{ items: Array<ShoppingItem> }> => {
    const householdId = await requireHouseholdId()
    const { getDb } = await import('../db/client')
    const db = await getDb()
    const { shoppingListItem } = await import('../db/shopping-list-schema')
    const { eq } = await import('drizzle-orm')
    await db
      .update(shoppingListItem)
      .set({ checked: data.checked })
      .where(eq(shoppingListItem.householdId, householdId))
    return reloadItems(db, householdId)
  })

/** Clear the whole list for the household. */
export const clearShoppingList = createServerFn({ method: 'POST' }).handler(
  async (): Promise<{ items: Array<ShoppingItem> }> => {
    const householdId = await requireHouseholdId()
    const { getDb } = await import('../db/client')
    const db = await getDb()
    const { shoppingListItem } = await import('../db/shopping-list-schema')
    const { eq } = await import('drizzle-orm')
    await db
      .delete(shoppingListItem)
      .where(eq(shoppingListItem.householdId, householdId))
    return reloadItems(db, householdId)
  },
)
