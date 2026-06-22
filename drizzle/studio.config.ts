import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { defineConfig } from 'drizzle-kit'

function resolveLocalD1Url(): string {
  if (process.env.D1_LOCAL_DB) return process.env.D1_LOCAL_DB

  const dir = join(
    process.cwd(),
    '.wrangler/state/v3/d1/miniflare-D1DatabaseObject',
  )
  if (!existsSync(dir)) {
    throw new Error(
      'Local D1 database not found. Run `pnpm db:migrate:local` or `pnpm dev` first.',
    )
  }

  const db = readdirSync(dir).find(
    (f) => f.endsWith('.sqlite') && f !== 'metadata.sqlite',
  )
  if (!db) {
    throw new Error('Local D1 SQLite file not found in .wrangler/state')
  }

  return `file:${join(dir, db)}`
}

/** Drizzle Studio against the local Wrangler D1 SQLite file. */
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './drizzle/migrations',
  dbCredentials: {
    url: resolveLocalD1Url(),
  },
})
