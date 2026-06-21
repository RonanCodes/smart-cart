/**
 * Pure Mollie payment-mode helpers + types. NO DB, NO env, NO server imports, so
 * this is import-safe from the client bundle (the admin PaymentsPanel) AND the
 * server. The DB/env-touching resolver lives in payment-mode-resolve.ts and the
 * admin createServerFns in payment-mode-server.ts.
 *
 * Mode precedence (implemented in the resolver): a household's override row ??
 * the global default row ?? 'test'. 'test' is the never-charge-real-money
 * fallback; every write is strictly validated to 'test' | 'live'.
 */

/** The two valid Mollie modes. 'test' is the safe default everywhere. */
export type PaymentMode = 'test' | 'live'

/** The scope key for the app-wide default row. */
export const GLOBAL_SCOPE = 'global'

/** Narrow an arbitrary value to a PaymentMode, or null if it is neither. */
export function asPaymentMode(value: unknown): PaymentMode | null {
  return value === 'test' || value === 'live' ? value : null
}

/** Strictly parse a mode for a write, throwing on anything but 'test'|'live'. */
export function requirePaymentMode(value: unknown): PaymentMode {
  const m = asPaymentMode(value)
  if (!m) throw new Error(`Invalid payment mode "${String(value)}"`)
  return m
}

/**
 * Decide what a per-household write does, purely from the requested mode. A null
 * mode means "inherit" -> delete the override row; a valid mode -> upsert it.
 * Extracted so the delete-vs-upsert decision is unit-testable without auth/DB.
 */
export function householdWriteOp(
  mode: PaymentMode | null,
): { op: 'delete' } | { op: 'upsert'; mode: PaymentMode } {
  return mode === null ? { op: 'delete' } : { op: 'upsert', mode }
}
