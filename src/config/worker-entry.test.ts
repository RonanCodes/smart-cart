import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * The Worker entry must be THIS repo's `src/server.ts`, not the framework's
 * default entry.
 *
 * The live bug (#server-entry): `wrangler.jsonc` pointed `main` at
 * `@tanstack/react-start/server-entry`, whose package export map resolves
 * unconditionally to `@tanstack/react-start/dist/default-entry/esm/server.js`.
 * That default entry exports ONLY `{ fetch }`, so everything else `src/server.ts`
 * exports was silently dropped from the deployed Worker:
 *
 *   - `scheduled()` never shipped, so every 15-minute cron tick threw
 *     "Handler does not export a scheduled() function" (~100 uncaught
 *     exceptions/day) and the push nudges never fired in production;
 *   - the `createServerEntry` wrapper that reports thrown errors and 500
 *     responses to Sentry never ran, which is why Sentry saw ~1 event in 30 days
 *     while the Worker was throwing hundreds.
 *
 * Neither failure is visible in typecheck, lint, or any unit test that imports
 * `src/server.ts` directly, because the module is perfectly valid — it just is
 * not the thing that gets deployed. This test reads the shipped config instead.
 */

const repoRoot = resolve(import.meta.dirname, '../..')

/** Parse wrangler.jsonc: strip line comments + trailing commas, then JSON.parse. */
function readWranglerConfig(): Record<string, unknown> {
  const raw = readFileSync(resolve(repoRoot, 'wrangler.jsonc'), 'utf8')
  const withoutComments = raw.replace(/^\s*\/\/.*$/gm, '')
  const withoutTrailingCommas = withoutComments.replace(/,(\s*[}\]])/g, '$1')
  return JSON.parse(withoutTrailingCommas) as Record<string, unknown>
}

/** Every `main` in the config: the top-level one plus one per named env. */
function everyMainEntry(): Array<{ env: string; main: unknown }> {
  const config = readWranglerConfig()
  const entries: Array<{ env: string; main: unknown }> = [
    { env: 'top-level', main: config.main },
  ]
  const envs = (config.env ?? {}) as Record<string, { main?: unknown }>
  for (const [name, env] of Object.entries(envs)) {
    // An env that inherits `main` (doesn't set its own) is fine; only assert on
    // the ones that declare it, since those are the ones that can drift.
    if (env.main !== undefined) entries.push({ env: name, main: env.main })
  }
  return entries
}

describe('wrangler worker entry', () => {
  it('points every environment at this repo src/server.ts, not the framework default entry', () => {
    const entries = everyMainEntry()
    // Guard the guard: if the config stops declaring `main` anywhere, this test
    // would vacuously pass.
    expect(entries.length).toBeGreaterThan(1)
    for (const { env, main } of entries) {
      expect(
        main,
        `wrangler env "${env}" must deploy src/server.ts. A package specifier such as ` +
          `"@tanstack/react-start/server-entry" resolves to the framework default entry, ` +
          `which exports only { fetch } and silently drops scheduled() + the Sentry wrapper.`,
      ).toBe('./src/server.ts')
    }
  })

  it('src/server.ts exports the cron scheduled() handler the wrangler triggers rely on', async () => {
    const config = readWranglerConfig()
    const triggers = config.triggers as { crons?: Array<string> } | undefined
    // The cron is what makes a missing scheduled() an error rather than dead code.
    expect(triggers?.crons ?? []).not.toHaveLength(0)

    const entry = (await import('../server')) as { default: unknown }
    const handler = entry.default as Record<string, unknown>
    expect(typeof handler.fetch).toBe('function')
    expect(typeof handler.scheduled).toBe('function')
  })
})
