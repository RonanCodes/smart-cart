import { defineConfig } from 'drizzle-kit'

/**
 * Drizzle config for Cloudflare D1 (SQLite). Migrations are generated here and
 * applied with `wrangler d1 migrations apply` (NOT drizzle-kit migrate), so the
 * out dir matches wrangler's `migrations_dir` in wrangler.jsonc.
 */
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './drizzle/migrations',
})
