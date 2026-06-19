/**
 * Freeze a deterministic benchmark fixture under data/fixtures/benchmark/v1/.
 *
 *   pnpm fixture:freeze
 *
 * The benchmark (scripts/benchmark.ts) must produce identical numbers on every run
 * and in CI, with no live DB and no network. To get that we snapshot the inputs once
 * and commit them: the catalogue projected to the RecipeLite shape the recommenders
 * read, the synthetic users, and the RNG seed + version metadata. The benchmark then
 * reads ONLY this frozen fixture, never data/seed/ (which moves as the catalogue grows)
 * and never D1. Re-run this script when you deliberately want to refresh the fixture
 * after a catalogue change, and commit the new snapshot.
 *
 * Fixture = data/fixtures/benchmark/v1/{catalogue.json, users.json, meta.json}.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { RecipeLite, UserProfile } from '../src/lib/recsys/types'

/** Bump when the fixture's shape or sourcing changes. */
const FIXTURE_VERSION = 'v1'
/** RNG seed the synthetic users were generated with (gen-synthetic-users.ts). */
const RNG_SEED = 7

interface SeedRecipe {
  id: string
  title: string
  cuisine: string | null
  category: string | null
  dietaryTags: Array<string>
  ingredients: Array<{ name: string }>
}

function readSeed<T>(name: string): T {
  return JSON.parse(
    readFileSync(join(process.cwd(), 'data', 'seed', name), 'utf8'),
  ) as T
}

function main() {
  const seed = readSeed<Array<SeedRecipe>>('recipes.json')
  const users = readSeed<Array<UserProfile>>('synthetic-users.json')

  // Project to the exact RecipeLite shape the recommenders consume. Anything not
  // read by the benchmark (instructions, images, macros) is dropped so the fixture
  // is small and the contract is explicit.
  const catalogue: Array<RecipeLite> = seed.map((r) => ({
    id: r.id,
    title: r.title,
    cuisine: r.cuisine,
    category: r.category,
    dietaryTags: r.dietaryTags,
    ingredients: r.ingredients.map((i) => ({ name: i.name })),
  }))

  const dir = join(
    process.cwd(),
    'data',
    'fixtures',
    'benchmark',
    FIXTURE_VERSION,
  )
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'catalogue.json'),
    JSON.stringify(catalogue, null, 0) + '\n',
  )
  writeFileSync(join(dir, 'users.json'), JSON.stringify(users, null, 0) + '\n')
  writeFileSync(
    join(dir, 'meta.json'),
    JSON.stringify(
      {
        version: FIXTURE_VERSION,
        rngSeed: RNG_SEED,
        recipes: catalogue.length,
        users: users.length,
        frozenAt: '2026-06-19',
        note: 'Deterministic benchmark inputs. The benchmark reads ONLY this fixture, never data/seed/ or D1. Regenerate with pnpm fixture:freeze and commit.',
      },
      null,
      2,
    ) + '\n',
  )
  console.log(
    `[fixture] froze ${FIXTURE_VERSION}: ${catalogue.length} recipes, ${users.length} users (seed ${RNG_SEED}) -> ${dir}`,
  )
}

main()
