/**
 * Which Souso deployment is this code running in?
 *
 * - "production" — the live app at souso.app (prod build, deploy.yml).
 * - "dev"        — the testers' app at dev.souso.app (built with CLOUDFLARE_ENV=dev,
 *                  deploy-dev.yml). Visually badged so a tester never confuses it
 *                  with prod (DEV ribbon + DEV-badged PWA / favicon icon).
 * - "local"      — `pnpm dev` on a developer's machine (the dev SERVER).
 *
 * The answer is BAKED AT BUILD TIME via the `import.meta.env.VITE_SOUSO_ENV` Vite
 * define (see vite.config.ts), so it is a literal in the bundle: prod can never
 * report "dev". Both the server (SSR) and the client read the same baked value.
 *
 * The mapping lives in the pure `resolveAppEnv` so it can be unit-tested without
 * a build. The exported `APP_ENV` constant reads the define ONCE at module load;
 * because the define is a string literal, the comparison helpers below
 * (isDevEnv / showDevBadge) constant-fold at build time, so the prod bundle
 * dead-code-eliminates the dev-only branches (icons, ribbon) entirely.
 */

export type AppEnv = 'production' | 'dev' | 'local'

/**
 * Map the raw build-time value of VITE_SOUSO_ENV to an AppEnv. Pure: takes the
 * raw value in, never touches import.meta, so it is trivially testable.
 *
 * - "dev"         → "dev"
 * - "production"  → "production"
 * - anything else → "local"
 */
export function resolveAppEnv(raw: string | undefined): AppEnv {
  if (raw === 'dev') return 'dev'
  if (raw === 'production') return 'production'
  return 'local'
}

/** The environment this build is running in (baked at build time, read once). */
export const APP_ENV: AppEnv = resolveAppEnv(import.meta.env.VITE_SOUSO_ENV)

/**
 * Build-time-constant booleans. Because the define replaces
 * `import.meta.env.VITE_SOUSO_ENV` with a string literal, these fold to a literal
 * `true`/`false` at build time, so `if (IS_DEV_ENV)` in the prod bundle becomes
 * `if (false)` and esbuild dead-code-eliminates the dev-only branches (dev icons,
 * dev manifest, ribbon). Prefer these over the function calls where stripping
 * matters (the __root icon links and the ribbon mount).
 */
export const IS_DEV_ENV: boolean = import.meta.env.VITE_SOUSO_ENV === 'dev'
export const IS_NOT_PROD_ENV: boolean =
  import.meta.env.VITE_SOUSO_ENV !== 'production'

/** The environment this build is running in. */
export function appEnv(): AppEnv {
  return APP_ENV
}

/**
 * Is this the dev (dev.souso.app) deployment? Drives the DEV-badged PWA / favicon
 * and the DEV ribbon's label. Deliberately NOT true for "local". Written as a
 * direct comparison against the baked literal so it folds to a constant: the prod
 * bundle's `if (isDevEnv())` becomes `if (false)` and the dev arm is stripped.
 */
export function isDevEnv(): boolean {
  return import.meta.env.VITE_SOUSO_ENV === 'dev'
}

/**
 * Should the on-screen DEV indicator render? True for the deployed dev app AND
 * for local `pnpm dev` (both are "not prod"). NEVER true for production, so
 * souso.app stays clean. The `=== 'production'` comparison against the baked
 * literal folds to a constant, so prod strips the ribbon.
 */
export function showDevBadge(env: AppEnv = APP_ENV): boolean {
  return env !== 'production'
}

// ── DEV email markers ──────────────────────────────────────────────────────
// Outbound email from the dev worker must be OBVIOUSLY dev so an admin never
// mistakes a dev test for a real prod signup. The two markers below are pure
// (they take the `isDev` flag in, never touch import.meta), so they are unit
// tested directly; email.ts passes isDevEnv() in. We KEEP the verified
// souso.app domain + noreply@ address (DKIM/SPF unchanged) and only change the
// display name; actually sending FROM @dev.souso.app would need that subdomain
// verified as its own Resend sending domain (a separate follow-up).

/**
 * The From display name + address for outbound email. In dev the display name
 * becomes "Souso (DEV)" so the sender reads as dev at a glance; the address
 * stays noreply@souso.app so deliverability / DKIM is unchanged. Prod is the
 * plain "Souso <noreply@souso.app>".
 */
export function emailFromAddress(isDev: boolean): string {
  return isDev ? 'Souso (DEV) <noreply@souso.app>' : 'Souso <noreply@souso.app>'
}

/**
 * An amber DEV strip prepended to the body of every dev email, so even a glance
 * at the message (not just the sender) says "this is dev, not production". Empty
 * string in prod, so prod email bodies are byte-for-byte unchanged.
 */
export function emailDevBanner(isDev: boolean): string {
  if (!isDev) return ''
  return `<div style="background:#FFF3CD;color:#7A5A00;border:1px solid #F0D88A;border-radius:8px;padding:10px 14px;margin:0 0 16px;font-size:13px;font-weight:700;text-align:center;font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif;">DEV: this is a test from dev.souso.app, not production</div>`
}

/**
 * The plain-text DEV marker, prepended to the text body of emails that have NO
 * HTML shell (the admin text-only pings: waitlist signup + new-user notice), so
 * their body reads as dev too. Empty string in prod. Includes a trailing blank
 * line so it sits as its own paragraph above the real body.
 */
export function emailDevTextBanner(isDev: boolean): string {
  if (!isDev) return ''
  return 'DEV: this is a test from dev.souso.app, not production.\n\n'
}
