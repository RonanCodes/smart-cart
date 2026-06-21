import type { getDb } from '../db/client'
import { asPaymentMode, GLOBAL_SCOPE } from './payment-mode'
import type { PaymentMode } from './payment-mode'

/** The drizzle db handle, named so the helpers avoid an inline import type. */
type Db = Awaited<ReturnType<typeof getDb>>

/**
 * Server-only Mollie payment-mode resolution. SPLIT OUT from payment-mode-server
 * deliberately: these touch the DB + `cloudflare:workers` env binding (via
 * ./env), so they must never enter the client bundle. The admin PaymentsPanel
 * imports the createServerFns from payment-mode-server (whose handlers are
 * stripped client-side) and the pure helpers from payment-mode; it never imports
 * THIS module, so `cloudflare:workers` stays out of the browser graph. The tip
 * flow + the webhook + the setHouseholdPaymentMode handler import here.
 */

/**
 * The effective Mollie mode for a household: its override row, else the global
 * default row, else 'test'. Pure D1 read (no auth, no network), so the tip flow
 * + the admin settings read share one source of truth. Bad/legacy stored values
 * fall through to the next level rather than charging live by mistake.
 */
export async function resolvePaymentMode(
  db: Db,
  householdId: string,
): Promise<PaymentMode> {
  const { paymentMode } = await import('../db/payment-mode-schema')
  const { inArray } = await import('drizzle-orm')
  const rows = await db
    .select({ scope: paymentMode.scope, mode: paymentMode.mode })
    .from(paymentMode)
    .where(inArray(paymentMode.scope, [householdId, GLOBAL_SCOPE]))

  const override = rows.find((r) => r.scope === householdId)
  const overrideMode = override ? asPaymentMode(override.mode) : null
  if (overrideMode) return overrideMode

  const global = rows.find((r) => r.scope === GLOBAL_SCOPE)
  const globalMode = global ? asPaymentMode(global.mode) : null
  if (globalMode) return globalMode

  return 'test'
}

/**
 * The Mollie API key for a mode: MOLLIE_API_KEY_LIVE for 'live', MOLLIE_API_KEY
 * for 'test'. Both are Worker secrets. Throws a clear error if the needed key is
 * unset, so a misconfigured live switch fails loudly instead of silently using
 * the test key (which would mark a real basket "paid" on a test profile).
 */
export async function mollieKeyForMode(mode: PaymentMode): Promise<string> {
  const { readEnv } = await import('./env')
  const envKey = mode === 'live' ? 'MOLLIE_API_KEY_LIVE' : 'MOLLIE_API_KEY'
  const key = await readEnv(envKey)
  if (!key) throw new Error(`${envKey} not configured`)
  return key
}
