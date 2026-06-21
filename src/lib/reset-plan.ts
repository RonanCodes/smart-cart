/**
 * The reset-to-fresh plan: which rows get wiped when an admin resets a user (or
 * all users) to a clean state so they re-onboard.
 *
 * D1 does NOT enforce foreign-key cascade, so deleting the `household` row alone
 * leaves every dependent row (swipes, feedback, plans, shopping items, staples,
 * push subscriptions) orphaned in the database. The reset must therefore delete
 * each household-scoped table EXPLICITLY, in child-before-parent order, then the
 * household row itself.
 *
 * What we never touch:
 *  - the auth `user` / `session` rows: the person stays signed in, just data-wiped.
 *  - `access_grant` / `admin_notification_pref`: admin config keyed by email/role,
 *    not household data.
 *
 * This module is a PURE description of the plan (a list of table keys, in delete
 * order). The DB-bound execution lives in admin-server.ts and dynamically imports
 * the real schema + client so nothing server-only leaks into the client bundle.
 * Keeping the plan pure means a unit test can assert "the right tables, in the
 * right order, then the household" against a mock db with no Cloudflare runtime.
 */

/**
 * Household-scoped child tables to clear, keyed by `household_id`, in the order
 * they must be deleted (children first). The `household` row is deleted last, by
 * its own id, and is NOT in this list because it is keyed differently (by `id`,
 * the household's own primary key) than the children (by `household_id`).
 */
export const HOUSEHOLD_SCOPED_TABLES = [
  'recipe_swipe',
  'meal_feedback',
  'household_memory',
  'meal_plan',
  'shopping_list_item',
  'staple',
  'push_subscription',
] as const

export type HouseholdScopedTable = (typeof HOUSEHOLD_SCOPED_TABLES)[number]

/**
 * Tables the reset must NEVER delete from. Listed so the test can assert the plan
 * leaves auth + admin-config untouched, and so the intent is documented in code.
 */
export const PRESERVED_TABLES = [
  'user',
  'session',
  'account',
  'verification',
  'access_grant',
  'admin_notification_pref',
] as const

export type PreservedTable = (typeof PRESERVED_TABLES)[number]

/** One step of a reset: clear a child table, or drop the household row itself. */
export type ResetStep =
  | { kind: 'clear-child'; table: HouseholdScopedTable }
  | { kind: 'delete-household' }

/**
 * The ordered list of delete steps for resetting ONE household: every
 * household-scoped child table (children first), then the household row. This is
 * the single source of truth the per-user and reset-all executors both walk, so
 * "what a reset wipes" lives in exactly one place.
 */
export function resetPlan(): Array<ResetStep> {
  return [
    ...HOUSEHOLD_SCOPED_TABLES.map(
      (table): ResetStep => ({ kind: 'clear-child', table }),
    ),
    { kind: 'delete-household' },
  ]
}

/**
 * Minimal delete surface the executor needs: clear a household-scoped child
 * table by household id, and delete the household row by its own id. The real
 * implementation (admin-server.ts) wires these to Drizzle deletes; the test
 * wires them to a spy. Keeping the executor abstract over this interface is what
 * makes "deletes the right tables, in the right order, and nothing else"
 * unit-testable with a mock instead of a Cloudflare runtime.
 */
export interface ResetExecutor {
  clearChild: (
    table: HouseholdScopedTable,
    householdId: string,
  ) => Promise<void>
  deleteHousehold: (householdId: string) => Promise<void>
}

/**
 * Walk the reset plan for ONE household against the given executor, in plan
 * order (every child table first, then the household row). Pure control flow:
 * all DB specifics live in the executor the caller passes.
 */
export async function executeReset(
  exec: ResetExecutor,
  householdId: string,
): Promise<void> {
  for (const step of resetPlan()) {
    if (step.kind === 'clear-child') {
      await exec.clearChild(step.table, householdId)
    } else {
      await exec.deleteHousehold(householdId)
    }
  }
}
