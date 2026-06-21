/**
 * Pure, CLIENT-SAFE amount helpers for the recipe view. Kept OUT of
 * recipe-detail-core.ts on purpose: that module is server-only (it dynamic-imports
 * db/client, which pulls `cloudflare:workers`), so a client component importing
 * from it leaks the worker binding into the client bundle and the build fails.
 * This file has no server deps, so the recipe card can import it directly.
 */

/**
 * Rescale the leading quantity in an amount string by a factor, for the serves
 * stepper. "500 g" at factor 2 becomes "1000 g"; "3 cloves" at 0.5 becomes
 * "1.5 cloves". Only the leading number is touched: anything that does not start
 * with a number ("snufje", "to taste") is returned unchanged, so a non-numeric
 * amount is never mangled. The result drops a trailing ".0" so whole numbers stay
 * clean ("4"), and rounds to at most two decimals. Pure, so it is unit-testable.
 */
export function scaleAmount(
  amount: string | null,
  factor: number,
): string | null {
  if (amount === null) return amount
  if (!Number.isFinite(factor) || factor <= 0) return amount
  const match = /^(\d+(?:[.,]\d+)?)(.*)$/.exec(amount.trim())
  const numText = match?.[1]
  if (!numText) return amount
  const base = Number(numText.replace(',', '.'))
  if (!Number.isFinite(base)) return amount
  const scaled = base * factor
  // Round to 2dp, then strip trailing zeros so "1000.00" -> "1000", "1.50" -> "1.5".
  const text = scaled.toFixed(2).replace(/\.?0+$/, '')
  return `${text}${match[2] ?? ''}`
}
