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
