/**
 * Turn data/recipes/*.json into a D1-applyable SQL seed file.
 *
 *   pnpm seed:recipes
 *   wrangler d1 execute smart_cart_db --remote --file=drizzle/seed/recipes.sql
 *   # (use --local for local dev)
 *
 * Each JSON file is an array of recipe objects (or a single object). Known fields
 * map to columns; the full object is kept in `raw`. Provide a stable `id` per
 * recipe (e.g. "ah-12345") so re-applying is idempotent (INSERT OR REPLACE).
 */
import {
  readdirSync,
  readFileSync,
  existsSync,
  mkdirSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

type RawRecipe = Record<string, unknown> & { id?: string; title?: string }

const str = (v: unknown): string | undefined =>
  typeof v === 'string' ? v : undefined
const num = (v: unknown): number | undefined =>
  typeof v === 'number' ? v : undefined
const arr = <T>(v: unknown): Array<T> | undefined =>
  Array.isArray(v) ? (v as Array<T>) : undefined

/** Single-quote escape for SQLite literals. */
const q = (v: string) => `'${v.replace(/'/g, "''")}'`
const qjson = (v: unknown) => q(JSON.stringify(v ?? null))
const qnull = (v: string | number | undefined) =>
  v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : q(v)

function rowValues(r: RawRecipe, source: string): string {
  const id = r.id ?? `${source}-${randomUUID()}`
  const now = Math.floor(Date.now() / 1000)
  return [
    q(id),
    q(str(r.source) ?? source),
    qnull(str(r.sourceUrl) ?? str(r.url)),
    q(r.title ?? 'Untitled'),
    qnull(num(r.servings)),
    qnull(num(r.prepMinutes) ?? num(r.prep_minutes)),
    qnull(num(r.calories)),
    qnull(num(r.protein)),
    qnull(str(r.cuisine)),
    q(str(r.mealType) ?? 'dinner'),
    qnull(str(r.category)),
    qjson(arr<string>(r.dietaryTags) ?? arr<string>(r.tags) ?? []),
    qjson(arr(r.ingredients) ?? []),
    qjson(arr<string>(r.instructions) ?? []),
    qjson(r),
    String(now),
  ].join(', ')
}

const COLS =
  'id, source, source_url, title, servings, prep_minutes, calories, protein, cuisine, meal_type, category, dietary_tags, ingredients, instructions, raw, created_at'

function main() {
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
  const lines: Array<string> = []
  let total = 0
  for (const file of files) {
    const source = file.replace(/\.json$/, '')
    const parsed = JSON.parse(readFileSync(join(dir, file), 'utf8')) as
      | Array<RawRecipe>
      | RawRecipe
    const rows = Array.isArray(parsed) ? parsed : [parsed]
    for (const r of rows) {
      lines.push(
        `INSERT OR REPLACE INTO recipe (${COLS}) VALUES (${rowValues(r, source)});`,
      )
    }
    total += rows.length
  }
  const outDir = join(process.cwd(), 'drizzle', 'seed')
  mkdirSync(outDir, { recursive: true })
  const out = join(outDir, 'recipes.sql')
  writeFileSync(out, lines.join('\n') + '\n')
  console.log(`Wrote ${total} recipes to ${out}`)
  console.log(
    'Apply with: wrangler d1 execute smart_cart_db --remote --file=drizzle/seed/recipes.sql',
  )
}

main()
