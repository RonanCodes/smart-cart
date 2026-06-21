import { describe, it, expect } from 'vitest'
import { loaderDataShape } from './observability-client'

/**
 * The undefined-route/loader-data bugs on /week were the worst post-launch issues
 * — a Sentry error had no clue what the loader returned. `loaderDataShape`
 * captures the SHAPE (keys + types, never values) so a Sentry error shows what the
 * loader actually handed the route, without leaking recipe data or PII.
 *
 * Pure + exported so it is unit-testable without booting Sentry (the rest of the
 * module is guarded no-ops until `initObservability` runs in the browser).
 */
describe('loaderDataShape', () => {
  it('reports null / undefined plainly (the exact /week crash signal)', () => {
    expect(loaderDataShape(null)).toEqual({ type: 'null' })
    expect(loaderDataShape(undefined)).toEqual({ type: 'undefined' })
  })

  it('reports the keys and value-types of an object, not the values', () => {
    const shape = loaderDataShape({
      kind: 'week',
      offset: 0,
      week: { planId: 'p1' },
      feedback: [],
    })
    expect(shape).toEqual({
      type: 'object',
      keys: ['kind', 'offset', 'week', 'feedback'],
      types: {
        kind: 'string',
        offset: 'number',
        week: 'object',
        feedback: 'array',
      },
    })
  })

  it('does not leak primitive values, only the type', () => {
    const shape = loaderDataShape('a-recipe-secret') as { type: string }
    expect(shape.type).toBe('string')
    expect(JSON.stringify(shape)).not.toContain('secret')
  })

  it('marks arrays distinctly from objects', () => {
    expect(loaderDataShape([1, 2, 3])).toEqual({ type: 'array', length: 3 })
  })

  it('never throws on awkward input', () => {
    expect(() => loaderDataShape(NaN)).not.toThrow()
    expect(() => loaderDataShape(() => {})).not.toThrow()
  })
})
