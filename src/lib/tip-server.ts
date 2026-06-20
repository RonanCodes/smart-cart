import { createServerFn } from '@tanstack/react-start'
import type { getDb } from '../db/client'

/** The drizzle db handle, named so the shared glue avoids an inline import type. */
type Db = Awaited<ReturnType<typeof getDb>>

/**
 * Tip-on-add-to-cart server logic (slices 1 + 3). Two halves, mirroring the
 * staples/waitlist split:
 *  - Pure glue (the free-tier limit, the current period string, the fee-floor
 *    amount math). Unit-tested without a DB or a network.
 *  - createServerFns that wrap D1 + Mollie around the glue.
 *
 * Hard rule #1 is intact: this charges an optional tip for the planning, never
 * the groceries (AH/Jumbo take that). Decisions #15-#18.
 */

/** Free add-to-cart actions per period before the tip prompt appears (#16). */
export const FREE_ADDS_PER_PERIOD = 3

/** Minimum effective charge in euro, so small baskets don't cost us on Mollie's
 * per-transaction fee (the fee floor, #18). */
export const TIP_FEE_FLOOR_EUR = 0.5

/** The calendar-month bucket for a date, e.g. "2026-06". Per decision #16 the
 * reset is monthly (rolling-30 is still open; month is the chosen default). */
export function currentPeriod(now: Date = new Date()): string {
  const y = now.getUTCFullYear()
  const m = String(now.getUTCMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

/**
 * The amount to charge for a tip, as the 2-decimal STRING Mollie wants. Applies
 * the fee floor: `max(percent/100 * basketTotal, €0.50)`. percent 0 returns null
 * (no tip = no charge, never an error). Negative/NaN inputs clamp to the floor
 * for any positive percent, and to null for no-tip.
 */
export function computeTipAmount(
  percent: number,
  basketTotal: number,
): string | null {
  if (!Number.isFinite(percent) || percent <= 0) return null
  const total =
    Number.isFinite(basketTotal) && basketTotal > 0 ? basketTotal : 0
  const raw = (percent / 100) * total
  const charged = Math.max(raw, TIP_FEE_FLOOR_EUR)
  return charged.toFixed(2)
}

/** Minimal shape of the Mollie client the webhook needs, for injection in tests. */
export interface MollieGetter {
  getPayment: (apiKey: string, id: string) => Promise<{ status: string }>
}

/** Minimal shape of the db update chain the webhook needs, for injection in tests. */
export interface TipPaymentUpdater {
  updateStatus: (molliePaymentId: string, status: string) => Promise<unknown>
}

/**
 * The webhook's core: re-fetch the payment status from Mollie (the security
 * boundary, the body carries only the id) and write it to the matching
 * tip_payment row. Idempotent by construction: a repeat call with the same id
 * just rewrites the same status (a no-op at the data level). Extracted from the
 * route so it is unit-testable without a Worker runtime.
 */
export async function applyMolliePaymentUpdate(
  apiKey: string,
  mollie: MollieGetter,
  updater: TipPaymentUpdater,
  id: string,
): Promise<{ status: string }> {
  const payment = await mollie.getPayment(apiKey, id)
  await updater.updateStatus(id, payment.status)
  return { status: payment.status }
}

// --- Server fns ------------------------------------------------------------

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

export interface FreeCheck {
  /** Whether THIS add-to-cart is still within the free tier (no prompt). */
  free: boolean
  /** How many free adds the household has used this period. */
  used: number
  /** How many free adds remain this period (0 once the prompt should show). */
  remaining: number
}

/**
 * Is the signed-in household's next add-to-cart free this month? Read-only: it
 * does NOT increment the counter (incrementing happens when an add is actually
 * recorded). Below the free limit -> no tip prompt (#16).
 */
export const isAddToCartFree = createServerFn({ method: 'GET' }).handler(
  async (): Promise<FreeCheck> => {
    const householdId = await requireHouseholdId()
    const period = currentPeriod()

    const { getDb } = await import('../db/client')
    const { tipUsage } = await import('../db/tip-schema')
    const { and, eq } = await import('drizzle-orm')
    const db = await getDb()

    const rows = await db
      .select({ used: tipUsage.freeCountUsed })
      .from(tipUsage)
      .where(
        and(eq(tipUsage.householdId, householdId), eq(tipUsage.period, period)),
      )
      .limit(1)

    const used = rows[0]?.used ?? 0
    const remaining = Math.max(FREE_ADDS_PER_PERIOD - used, 0)
    return { free: remaining > 0, used, remaining }
  },
)

export interface StartTipInput {
  /** Whole percent the user chose (0 = no tip). */
  percent: number
  /** The basket total in euro, for the percent math. */
  basketTotal: number
  /** Optional basket / meal_plan id this tip belongs to. */
  basketId?: string
  /** Store to open after payment ('ah'|'jumbo'); passed back via the return URL. */
  store?: string
}

export interface StartTipResult {
  /** The Mollie hosted-checkout URL to redirect to, or null for a no-tip add. */
  checkoutUrl: string | null
  /** The tip_payment row id we recorded. */
  tipPaymentId: string
  /** The charged amount string ("0.50"), or null for a no-tip add. */
  amount: string | null
}

/**
 * Start a tip. Computes the fee-floored amount, creates a single Mollie payment
 * (the demo path; the mandate one-tap repeat is a later slice), records a
 * tip_payment row, and returns the checkout URL to redirect to.
 *
 * A percent of 0 ("no tip") is NOT an error: we record a no-tip row, increment
 * the free counter, and return no checkout URL. The reward-not-guilt rule (#17)
 * means a declined tip is a normal, unpunished outcome.
 */
export const startTip = createServerFn({ method: 'POST' })
  .inputValidator(
    (d: StartTipInput): StartTipInput => ({
      percent: Number(d.percent),
      basketTotal: Number(d.basketTotal),
      basketId: d.basketId ? String(d.basketId) : undefined,
      store: d.store === 'ah' || d.store === 'jumbo' ? d.store : undefined,
    }),
  )
  .handler(async ({ data }): Promise<StartTipResult> => {
    const householdId = await requireHouseholdId()
    const period = currentPeriod()

    const { getDb } = await import('../db/client')
    const { tipPayment } = await import('../db/tip-schema')
    const db = await getDb()

    const amount = computeTipAmount(data.percent, data.basketTotal)
    const tipPaymentId = crypto.randomUUID()

    // No-tip path: record the free-count usage, no Mollie charge, never error.
    if (amount === null) {
      await recordFreeAdd(db, householdId, period)
      await db.insert(tipPayment).values({
        id: tipPaymentId,
        householdId,
        basketId: data.basketId ?? null,
        percent: 0,
        amount: '',
        molliePaymentId: null,
        status: 'none',
      })
      return { checkoutUrl: null, tipPaymentId, amount: null }
    }

    const { readEnv } = await import('./env')
    const apiKey = await readEnv('MOLLIE_API_KEY')
    if (!apiKey) throw new Error('MOLLIE_API_KEY not configured')
    const appUrl = (await readEnv('APP_URL')) ?? ''

    const storeQuery = data.store ? `?store=${data.store}` : ''
    const { createPayment } = await import('./mollie')
    const payment = await createPayment(apiKey, {
      amount,
      description: 'Souso tip',
      redirectUrl: `${appUrl}/tip/${tipPaymentId}/return${storeQuery}`,
      webhookUrl: `${appUrl}/api/mollie/webhook`,
    })

    await db.insert(tipPayment).values({
      id: tipPaymentId,
      householdId,
      basketId: data.basketId ?? null,
      percent: data.percent,
      amount,
      molliePaymentId: payment.id,
      status: payment.status,
    })

    return {
      checkoutUrl: payment._links.checkout?.href ?? null,
      tipPaymentId,
      amount,
    }
  })

/**
 * Increment the household's free-add counter for the period, idempotent on
 * (household, period): the first add this period inserts a row at 1, later adds
 * bump it. Pure D1 glue, shared by the no-tip path.
 */
async function recordFreeAdd(
  db: Db,
  householdId: string,
  period: string,
): Promise<void> {
  const { tipUsage } = await import('../db/tip-schema')
  const { sql } = await import('drizzle-orm')
  await db
    .insert(tipUsage)
    .values({
      id: crypto.randomUUID(),
      householdId,
      period,
      freeCountUsed: 1,
    })
    .onConflictDoUpdate({
      target: [tipUsage.householdId, tipUsage.period],
      set: {
        freeCountUsed: sql`${tipUsage.freeCountUsed} + 1`,
        updatedAt: new Date(),
      },
    })
}
