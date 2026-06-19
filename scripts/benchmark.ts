/**
 * Benchmark the swipe recommenders. For each synthetic user we simulate the
 * onboarding swipe loop (the recommender picks the next deck, the user swipes per
 * the hidden ground-truth) and measure how well the recommender's top-20 matches
 * the user's true top-20, as a function of how many swipes it took. The winner is
 * the one that reaches high recall in the fewest swipes.
 *
 *   pnpm benchmark        # or: pnpm tsx scripts/benchmark.ts
 *
 * Runs against the FROZEN benchmark fixture (data/fixtures/benchmark/<version>/),
 * not the live catalogue or D1, so the numbers are deterministic and reproducible
 * with no network. Refresh the fixture with `pnpm fixture:freeze` after a deliberate
 * catalogue change, then re-run this.
 *
 * The per-algorithm math lives in src/lib/recsys/benchmark-core.ts and is shared with
 * the regression-gate test (benchmark.guard.test.ts), so "the benchmark" means the
 * same thing in the report and in the gate.
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  CHECKPOINTS,
  TARGET_RECALL,
  TOP_N,
  DECK,
  MAX,
  runBenchmark,
} from '../src/lib/recsys/benchmark-core'
import { loadBenchmarkFixture } from '../src/lib/recsys/fixture'

function main() {
  const fixture = loadBenchmarkFixture()
  const { recipes, users } = fixture
  console.log(
    `Fixture ${fixture.meta.version}: ${recipes.length} recipes, ${users.length} users (rng seed ${fixture.meta.rngSeed}).`,
  )

  const { usersScored, summary } = runBenchmark(recipes, users)
  const used = usersScored
  const names = Object.keys(summary)

  // Markdown report.
  let md = `# Swipe recommender benchmark\n\n`
  md += `Frozen fixture: \`${fixture.meta.version}\` (${recipes.length} recipes, rng seed ${fixture.meta.rngSeed}). Synthetic users: ${used}. Deck ${DECK}/round, recall@${TOP_N} vs each user's true top ${TOP_N}. Deterministic, no live DB / no network.\n\n`
  md += `## Recall@${TOP_N} by swipe count\n\n`
  md += `| strategy | ${CHECKPOINTS.map((c) => `${c} swipes`).join(' | ')} | median swipes to ${TARGET_RECALL * 100}% |\n`
  md += `| --- | ${CHECKPOINTS.map(() => '---').join(' | ')} | --- |\n`
  for (const n of names) {
    const a = summary[n]!
    const cells = CHECKPOINTS.map(
      (c) => `${(a.recallByCheckpoint[c]! * 100).toFixed(0)}%`,
    )
    const med = a.medianSwipesToTarget
    const pctReached = (a.pctReachedTarget * 100).toFixed(0)
    md += `| **${n}** | ${cells.join(' | ')} | ${med != null ? med : 'n/a'} (${pctReached}% reach) |\n`
  }
  md += `\nHigher recall sooner is better. "median swipes to ${TARGET_RECALL * 100}%" is the headline: the fewest swipes to a good match. Max ${MAX} swipes simulated.\n`

  mkdirSync(join(process.cwd(), 'docs', 'benchmarks'), { recursive: true })
  writeFileSync(join(process.cwd(), 'docs', 'benchmarks', 'results.md'), md)
  writeFileSync(
    join(process.cwd(), 'docs', 'benchmarks', 'results.json'),
    JSON.stringify(
      {
        fixture: {
          version: fixture.meta.version,
          rngSeed: fixture.meta.rngSeed,
          recipes: recipes.length,
          users: used,
        },
        summary,
      },
      null,
      2,
    ),
  )
  console.log(md)
}

main()
