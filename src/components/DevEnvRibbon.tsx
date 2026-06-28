import { APP_ENV, IS_NOT_PROD_ENV } from '#/lib/app-env'

/**
 * A small, fixed "DEV" pill shown on the dev.souso.app deployment (and on local
 * `pnpm dev`) so a tester can never mistake it for the live souso.app. It uses
 * the warm amber accent (NOT the prod forest green), so it reads as "not prod"
 * at a glance.
 *
 * It NEVER renders on production: gated on IS_NOT_PROD_ENV, a build-time-constant
 * boolean, so the prod bundle dead-code-eliminates this to a `null` return.
 *
 * Placement: top-right corner, below the safe-area inset, with a low height so it
 * never covers the bottom tab bar or primary controls. Non-interactive
 * (pointer-events: none) and aria-labelled so it is announced but never traps a
 * tap meant for the UI underneath.
 */
export function DevEnvRibbon() {
  if (!IS_NOT_PROD_ENV) return null

  const env = APP_ENV
  const label = env === 'local' ? 'LOCAL' : 'DEV'

  return (
    <div
      role="status"
      aria-label={`You are on the ${env} environment, not production`}
      className="pointer-events-none fixed top-[calc(env(safe-area-inset-top)+0.5rem)] right-2 z-[60] rounded-full border border-amber-500 bg-amber-400 px-2.5 py-1 text-[11px] leading-none font-bold tracking-wide text-amber-950 uppercase shadow-md select-none"
    >
      {label}
    </div>
  )
}
