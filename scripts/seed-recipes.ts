/**
 * Load scraped recipes from data/recipes/*.json into the Neon `recipe` table.
 *
 * Each JSON file is either an array of recipe objects or a single object. Shape is
 * flexible; the full object is kept in `raw`. Known fields are mapped to columns.
 *
 *   pnpm seed:recipes
 *
 * Reads NEON_DATABASE_URL from the environment or .dev.vars. Idempotent: rows are
 * upserted on id (provide a stable `id` per recipe, e.g. "ah-12345", to re-run safely).
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import { sql } from 'drizzle-orm'
import { recipe } from '../src/db/schema'

function loadEnv(): string {
  if (process.env.NEON_DATABASE_URL) return process.env.NEON_DATABASE_URL
  const devVars = join(process.cwd(), '.dev.vars')
  if (existsSync(devVars)) {
    for (const line of readFileSync(devVars, 'utf8').split('\n')) {
      const m = line.match(/^\s*NEON_DATABASE_URL\s*=\s*"?([^"]+)"?\s*$/)
      if (m?.[1]) return m[1]
    }
  }
  throw new Error('NEON_DATABASE_URL not set (env or .dev.vars).')
}

type RawRecipe = Record<string, unknown> & { id?: string; title?: string }

const str = (v: unknown): string | undefined =>
  typeof v === 'string' ? v : undefined
const num = (v: unknown): number | undefined =>
  typeof v === 'number' ? v : undefined
const arr = <T>(v: unknown): Array<T> | undefined =>
  Array.isArray(v) ? (v as Array<T>) : undefined

function toRow(r: RawRecipe, source: string) {
  return {
    id: r.id ?? `${source}-${randomUUID()}`,
    source: str(r.source) ?? source,
    sourceUrl: str(r.sourceUrl) ?? str(r.url) ?? null,
    title: r.title ?? 'Untitled',
    servings: num(r.servings) ?? null,
    prepMinutes: num(r.prepMinutes) ?? num(r.prep_minutes) ?? null,
    calories: num(r.calories) ?? null,
    category: str(r.category) ?? null,
    dietaryTags: arr<string>(r.dietaryTags) ?? arr<string>(r.tags) ?? [],
    ingredients: arr<{ name: string }>(r.ingredients) ?? [],
    instructions: arr<string>(r.instructions) ?? [],
    raw: r,
  }
}

async function main() {
  const db = drizzle(neon(loadEnv()), { schema: { recipe } })
  const dir = join(process.cwd(), 'data', 'recipes')
  if (!existsSync(dir)) {
    console.log(
      'No data/recipes/ directory yet. Drop *.json files there first.',
    )
    return
  }
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'))
  if (files.length === 0) {
    console.log('No *.json files in data/recipes/.')
    return
  }
  let total = 0
  for (const file of files) {
    const source = file.replace(/\.json$/, '')
    const parsed = JSON.parse(readFileSync(join(dir, file), 'utf8')) as
      | Array<RawRecipe>
      | RawRecipe
    const rows = (Array.isArray(parsed) ? parsed : [parsed]).map((r) =>
      toRow(r, source),
    )
    // Batch upsert.
    for (let i = 0; i < rows.length; i += 200) {
      const batch = rows.slice(i, i + 200)
      await db
        .insert(recipe)
        .values(batch)
        .onConflictDoUpdate({
          target: recipe.id,
          set: {
            title: sql`excluded.title`,
            raw: sql`excluded.raw`,
            ingredients: sql`excluded.ingredients`,
            instructions: sql`excluded.instructions`,
            dietaryTags: sql`excluded.dietary_tags`,
          },
        })
    }
    total += rows.length
    console.log(`  ${file}: ${rows.length} recipes`)
  }
  console.log(`Done. Upserted ${total} recipes.`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
