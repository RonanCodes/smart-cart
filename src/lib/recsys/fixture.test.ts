import { describe, expect, it } from 'vitest'
import { FIXTURE_VERSION, loadBenchmarkFixture } from './fixture'

/**
 * The frozen benchmark fixture is the contract that makes the benchmark
 * deterministic and network-free. These tests guard the loader and the shape +
 * internal consistency of the committed snapshot, so a malformed or partial
 * fixture fails CI rather than silently skewing benchmark numbers.
 */
describe('benchmark fixture', () => {
  const fixture = loadBenchmarkFixture()

  it('loads the pinned version', () => {
    expect(fixture.meta.version).toBe(FIXTURE_VERSION)
  })

  it('meta counts match the actual arrays', () => {
    expect(fixture.recipes.length).toBe(fixture.meta.recipes)
    expect(fixture.users.length).toBe(fixture.meta.users)
  })

  it('has a non-trivial committed catalogue and users', () => {
    expect(fixture.recipes.length).toBeGreaterThan(1000)
    expect(fixture.users.length).toBeGreaterThan(0)
  })

  it('records the RNG seed for reproducibility', () => {
    expect(typeof fixture.meta.rngSeed).toBe('number')
  })

  it('every recipe has the RecipeLite shape the recommenders read', () => {
    for (const r of fixture.recipes) {
      expect(typeof r.id).toBe('string')
      expect(typeof r.title).toBe('string')
      expect(Array.isArray(r.dietaryTags)).toBe(true)
      expect(Array.isArray(r.ingredients)).toBe(true)
      for (const ing of r.ingredients) {
        expect(typeof ing.name).toBe('string')
        expect(ing.name.length).toBeGreaterThan(0)
      }
    }
  })

  it('recipe ids are unique', () => {
    const ids = new Set(fixture.recipes.map((r) => r.id))
    expect(ids.size).toBe(fixture.recipes.length)
  })

  it('every synthetic user has the UserProfile shape', () => {
    for (const u of fixture.users) {
      expect(typeof u.id).toBe('string')
      expect(Array.isArray(u.lovedCuisines)).toBe(true)
      expect(Array.isArray(u.dislikedCuisines)).toBe(true)
      expect(typeof u.vegetarian).toBe('boolean')
    }
  })

  it('is deterministic: two loads are deep-equal', () => {
    expect(loadBenchmarkFixture()).toEqual(fixture)
  })
})
