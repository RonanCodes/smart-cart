import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runBenchmark } from './benchmark-core'
import { loadBenchmarkFixture } from './fixture'

/**
 * Benchmark regression gate (hard).
 *
 * This recomputes the swipe benchmark on the FROZEN fixture (deterministic, no DB, no
 * network) and fails if ANY recommender's recall@20 drops below the committed baseline
 * minus a small tolerance, at any recorded checkpoint. The point: no change to the
 * rankers or ground-truth can silently regress recall. If a regression is intended,
 * regenerate docs/benchmarks/baseline.json deliberately and explain it in the PR.
 *
 * It runs as part of `pnpm test` (and therefore `pnpm quality` and the pre-push hook)
 * because it is a normal *.test.ts file picked up by `vitest run`.
 */

interface Baseline {
  fixtureVersion: string
  tolerance: number
  checkpoints: Array<number>
  algorithms: Record<
    string,
    {
      recallByCheckpoint: Record<string, number>
      medianSwipesToTarget: number | null
    }
  >
}

function loadBaseline(): Baseline {
  const path = join(process.cwd(), 'docs', 'benchmarks', 'baseline.json')
  return JSON.parse(readFileSync(path, 'utf8')) as Baseline
}

describe('benchmark regression gate', () => {
  const baseline = loadBaseline()
  const fixture = loadBenchmarkFixture()
  // Recompute the benchmark on the committed fixture. Deterministic, so this is the
  // same number the baseline was frozen from, on the current code.
  const { summary } = runBenchmark(fixture.recipes, fixture.users)

  it('the baseline is pinned to the current fixture version', () => {
    expect(baseline.fixtureVersion).toBe(fixture.meta.version)
  })

  it('every baselined algorithm is still present', () => {
    for (const name of Object.keys(baseline.algorithms)) {
      expect(summary[name]).toBeDefined()
    }
  })

  // One hard assertion per (algorithm, checkpoint): recall must not regress past the
  // baseline minus the tolerance. A named test per algorithm makes a RED gate point
  // straight at the culprit.
  for (const [name, base] of Object.entries(baseline.algorithms)) {
    it(`${name}: recall@20 does not regress below baseline - tolerance`, () => {
      const got = summary[name]
      expect(
        got,
        `algorithm "${name}" missing from recomputed benchmark`,
      ).toBeDefined()
      for (const checkpoint of baseline.checkpoints) {
        const baselineRecall = base.recallByCheckpoint[String(checkpoint)]
        expect(
          baselineRecall,
          `baseline missing checkpoint ${checkpoint} for ${name}`,
        ).toBeTypeOf('number')
        const floor = baselineRecall! - baseline.tolerance
        const actual = got!.recallByCheckpoint[checkpoint]!
        expect(
          actual,
          `${name} recall@20 at ${checkpoint} swipes regressed: ${actual.toFixed(4)} < floor ${floor.toFixed(4)} (baseline ${baselineRecall!.toFixed(4)} - tolerance ${baseline.tolerance})`,
        ).toBeGreaterThanOrEqual(floor)
      }
    })
  }
})
