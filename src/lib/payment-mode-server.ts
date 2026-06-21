import { createServerFn } from '@tanstack/react-start'
import { GLOBAL_SCOPE, asPaymentMode, requirePaymentMode } from './payment-mode'
import type { PaymentMode } from './payment-mode'

/**
 * Admin-gated Mollie payment-mode createServerFns (read + write the payment_mode
 * table from the /admin Payments panel). The pure validators/types live in
 * payment-mode.ts (client-safe) and the DB/env resolver in
 * payment-mode-resolve.ts (server-only). The PaymentsPanel imports the server
 * fns from here (handlers stripped client-side) + the pure helpers/types from
 * payment-mode, so nothing server-only reaches the browser bundle.
 */

// Re-export the pure helpers/types so callers can import the whole payment-mode
// surface from one place (the panel imports types from here).
export {
  GLOBAL_SCOPE,
  asPaymentMode,
  requirePaymentMode,
  householdWriteOp,
} from './payment-mode'
export type { PaymentMode } from './payment-mode'

/** Gate: the signed-in viewer must be an admin, or this throws 'forbidden'. */
async function requireAdmin(): Promise<void> {
  const { isAdmin } = await import('./admin-server')
  if (!(await isAdmin())) throw new Error('forbidden')
}

/** One per-household override in the admin Payments view. */
export interface PaymentModeOverride {
  householdId: string
  /** The override owner's email, or '(unknown)' if the household has no owner row. */
  email: string
  mode: PaymentMode
}

export interface PaymentModeSettings {
  /** The app-wide default mode (the global row, or 'test' when unset). */
  global: PaymentMode
  /** Per-household overrides, joined to the owner's email, newest write first. */
  overrides: Array<PaymentModeOverride>
}

/**
 * The current payment-mode settings for the admin panel: the global default plus
 * every per-household override joined to its owner email. Admin-gated. Bad stored
 * modes are coerced to 'test' for display (the same safe fallback the resolver
 * uses), so the UI never shows an invalid value.
 */
export const getPaymentModeSettings = createServerFn({ method: 'GET' }).handler(
  async (): Promise<PaymentModeSettings> => {
    await requireAdmin()
    const { getDb } = await import('../db/client')
    const { paymentMode } = await import('../db/payment-mode-schema')
    const { household, user } = await import('../db/schema')
    const { eq, ne, desc } = await import('drizzle-orm')
    const db = await getDb()

    const globalRow = (
      await db
        .select({ mode: paymentMode.mode })
        .from(paymentMode)
        .where(eq(paymentMode.scope, GLOBAL_SCOPE))
        .limit(1)
    )[0]

    // Every override is a row whose scope is a householdId (anything but 'global').
    const overrideRows = await db
      .select({
        householdId: paymentMode.scope,
        mode: paymentMode.mode,
        email: user.email,
      })
      .from(paymentMode)
      .leftJoin(household, eq(household.id, paymentMode.scope))
      .leftJoin(user, eq(user.id, household.ownerId))
      .where(ne(paymentMode.scope, GLOBAL_SCOPE))
      .orderBy(desc(paymentMode.updatedAt))

    return {
      global: asPaymentMode(globalRow?.mode) ?? 'test',
      overrides: overrideRows.map((r) => ({
        householdId: r.householdId,
        email: r.email ?? '(unknown)',
        mode: asPaymentMode(r.mode) ?? 'test',
      })),
    }
  },
)

/**
 * Set the GLOBAL default mode. Admin-gated, strictly validated. Upserts the
 * single scope='global' row (idempotent), so flipping the default is one write.
 */
export const setGlobalPaymentMode = createServerFn({ method: 'POST' })
  .inputValidator((d: { mode: PaymentMode }) => ({
    mode: requirePaymentMode(d.mode),
  }))
  .handler(async ({ data }): Promise<{ global: PaymentMode }> => {
    await requireAdmin()
    const { getDb } = await import('../db/client')
    const { paymentMode } = await import('../db/payment-mode-schema')
    const db = await getDb()
    const now = new Date()
    await db
      .insert(paymentMode)
      .values({ scope: GLOBAL_SCOPE, mode: data.mode, updatedAt: now })
      .onConflictDoUpdate({
        target: paymentMode.scope,
        set: { mode: data.mode, updatedAt: now },
      })
    return { global: data.mode }
  })

/**
 * Set (or clear) a per-household override. Admin-gated. A mode of 'test'|'live'
 * upserts the override row; a mode of null DELETES it, so the household falls
 * back to inheriting the global default. Returns the resulting effective mode
 * for the household so the UI can reflect inheritance after a clear.
 */
export const setHouseholdPaymentMode = createServerFn({ method: 'POST' })
  .inputValidator((d: { householdId: string; mode: PaymentMode | null }) => ({
    householdId: String(d.householdId),
    // null = inherit (clear the override). Anything else must be a valid mode.
    mode: d.mode === null ? null : requirePaymentMode(d.mode),
  }))
  .handler(
    async ({
      data,
    }): Promise<{
      householdId: string
      override: PaymentMode | null
      effective: PaymentMode
    }> => {
      await requireAdmin()
      if (!data.householdId) throw new Error('householdId required')
      const { getDb } = await import('../db/client')
      const { paymentMode } = await import('../db/payment-mode-schema')
      const { householdWriteOp } = await import('./payment-mode')
      const { resolvePaymentMode } = await import('./payment-mode-resolve')
      const { eq } = await import('drizzle-orm')
      const db = await getDb()

      const write = householdWriteOp(data.mode)
      if (write.op === 'delete') {
        // Inherit: drop the override row entirely.
        await db
          .delete(paymentMode)
          .where(eq(paymentMode.scope, data.householdId))
      } else {
        const now = new Date()
        await db
          .insert(paymentMode)
          .values({
            scope: data.householdId,
            mode: write.mode,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: paymentMode.scope,
            set: { mode: write.mode, updatedAt: now },
          })
      }

      const effective = await resolvePaymentMode(db, data.householdId)
      return { householdId: data.householdId, override: data.mode, effective }
    },
  )
