import { describe, it, expect } from 'vitest'
import { showBenchmark } from './admin-dev-only'

describe('showBenchmark', () => {
  it('shows the benchmark surface in a dev build', () => {
    expect(showBenchmark(true)).toBe(true)
  })

  it('hides the benchmark surface on the deployed build', () => {
    expect(showBenchmark(false)).toBe(false)
  })
})
