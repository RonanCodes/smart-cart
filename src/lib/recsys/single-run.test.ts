import { describe, expect, it } from 'vitest'
import { CHECKPOINTS, runSingleAlgorithm } from './benchmark-core'
import { loadBenchmarkFixture } from './fixture'
import { registeredKeys } from './registry'
import { DEFAULT_ADAPTIVE_WEIGHTS } from './config'

/**
 * Unit coverage for the fast single-algorithm runner that the admin Benchmark tab
 * drives. It must be: deterministic (same inputs -> same numbers), bounded by the
 * user-limit sub-sample, honour custom checkpoints, and thread Adaptive weights
 * through so a different tuning produces a (possibly) different recall. Pure +
 * deterministic, no DB / network, so it runs in CI on the frozen fixture.
 */
describe('runSingleAlgorithm (admin fast benchmark)', () => {
  const { recipes, users } = loadBenchmarkFixture()

  it('runs every registered algorithm without throwing', () => {
    for (const key of registeredKeys()) {
      const r = runSingleAlgorithm(recipes, users, key, { userLimit: 12 })
      expect(r.key).toBe(key)
      expect(typeof r.name).toBe('string')
      expect(r.usersScored).toBeGreaterThan(0)
      expect(r.usersScored).toBeLessThanOrEqual(12)
    }
  })

  it('is deterministic: same inputs produce identical numbers', () => {
    const a = runSingleAlgorithm(recipes, users, 'adaptive', { userLimit: 20 })
    const b = runSingleAlgorithm(recipes, users, 'adaptive', { userLimit: 20 })
    expect(a.recallByCheckpoint).toEqual(b.recallByCheckpoint)
    expect(a.medianSwipesToTarget).toBe(b.medianSwipesToTarget)
    expect(a.pctReachedTarget).toBe(b.pctReachedTarget)
  })

  it('honours the user-limit sub-sample (smaller = fewer users scored)', () => {
    const small = runSingleAlgorithm(recipes, users, 'adaptive', {
      userLimit: 10,
    })
    const big = runSingleAlgorithm(recipes, users, 'adaptive', {
      userLimit: 40,
    })
    expect(small.usersScored).toBeLessThanOrEqual(10)
    expect(big.usersScored).toBeGreaterThan(small.usersScored)
  })

  it('records recall only at the requested checkpoints', () => {
    const r = runSingleAlgorithm(recipes, users, 'adaptive', {
      userLimit: 12,
      checkpoints: [20, 30],
    })
    expect(Object.keys(r.recallByCheckpoint).map(Number).sort()).toEqual([
      20, 30,
    ])
    for (const cp of [20, 30]) {
      const v = r.recallByCheckpoint[cp]!
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
  })

  it('defaults to the standard CHECKPOINTS when none are passed', () => {
    const r = runSingleAlgorithm(recipes, users, 'maths', { userLimit: 10 })
    expect(
      Object.keys(r.recallByCheckpoint)
        .map(Number)
        .sort((x, y) => x - y),
    ).toEqual([...CHECKPOINTS].sort((x, y) => x - y))
  })

  it('threads Adaptive weights through (default weights reproduce the default run)', () => {
    const def = runSingleAlgorithm(recipes, users, 'adaptive', {
      userLimit: 20,
    })
    const explicitDefault = runSingleAlgorithm(recipes, users, 'adaptive', {
      userLimit: 20,
      weights: DEFAULT_ADAPTIVE_WEIGHTS,
    })
    expect(explicitDefault.recallByCheckpoint).toEqual(def.recallByCheckpoint)
  })

  it('a different idf gate can change adaptive recall', () => {
    const def = runSingleAlgorithm(recipes, users, 'adaptive', {
      userLimit: 40,
    })
    const tuned = runSingleAlgorithm(recipes, users, 'adaptive', {
      userLimit: 40,
      weights: { ...DEFAULT_ADAPTIVE_WEIGHTS, idfGate: 0.5 },
    })
    // Not asserting direction (tuning can help or hurt), only that the knob is
    // actually wired through and reaches the ranker.
    const defVals = Object.values(def.recallByCheckpoint)
    const tunedVals = Object.values(tuned.recallByCheckpoint)
    expect(defVals).not.toEqual(tunedVals)
  })

  it('throws on an unknown algorithm key', () => {
    expect(() =>
      runSingleAlgorithm(recipes, users, 'nope', { userLimit: 5 }),
    ).toThrow()
  })
})
