/**
 * The frozen benchmark fixture loader. The fixture (data/fixtures/benchmark/<version>/)
 * is a committed snapshot of the catalogue + synthetic users + RNG seed, so the swipe
 * benchmark is deterministic and runs with no live DB and no network. Both the
 * benchmark script and the (future) regression-gate test read through here so they
 * always agree on which inputs "the benchmark" means.
 *
 * Node-only (reads from disk). Do not import from Worker code.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { RecipeLite, UserProfile } from './types'

/** The fixture version the benchmark is pinned to. Bump when the snapshot changes. */
export const FIXTURE_VERSION = 'v1'

export interface FixtureMeta {
  version: string
  rngSeed: number
  recipes: number
  users: number
  frozenAt: string
  note: string
}

export interface BenchmarkFixture {
  recipes: Array<RecipeLite>
  users: Array<UserProfile>
  meta: FixtureMeta
}

function fixtureDir(version: string): string {
  return join(process.cwd(), 'data', 'fixtures', 'benchmark', version)
}

function readJson<T>(dir: string, name: string): T {
  return JSON.parse(readFileSync(join(dir, name), 'utf8')) as T
}

/** Load the frozen benchmark fixture from disk. Deterministic, no network. */
export function loadBenchmarkFixture(
  version: string = FIXTURE_VERSION,
): BenchmarkFixture {
  const dir = fixtureDir(version)
  return {
    recipes: readJson<Array<RecipeLite>>(dir, 'catalogue.json'),
    users: readJson<Array<UserProfile>>(dir, 'users.json'),
    meta: readJson<FixtureMeta>(dir, 'meta.json'),
  }
}
