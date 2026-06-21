import { describe, expect, it } from 'vitest'
import { buildCookingPrompt, PIXVERSE_INSUFFICIENT_BALANCE } from './pixverse'

describe('buildCookingPrompt', () => {
  it('names the dish and weaves in the first few steps', () => {
    const prompt = buildCookingPrompt('Risotto', [
      'Fry the onion.',
      'Add the rice.',
      'Stir in the stock.',
      'Finish with parmesan.',
    ])
    expect(prompt).toContain('"Risotto"')
    expect(prompt).toContain('Fry the onion.')
    expect(prompt).toContain('Add the rice.')
    expect(prompt).toContain('Stir in the stock.')
    // Only the first three steps are woven in, the fourth is dropped.
    expect(prompt).not.toContain('parmesan')
  })

  it('falls back to a plating shot when there are no steps', () => {
    const prompt = buildCookingPrompt('Soup', [])
    expect(prompt).toContain('"Soup"')
    expect(prompt).toContain('plated')
  })

  it('ignores blank step lines', () => {
    const prompt = buildCookingPrompt('Stew', ['', '   ', 'Simmer gently.'])
    expect(prompt).toContain('Simmer gently.')
  })

  it('stays within the length cap', () => {
    const long = Array.from({ length: 5 }, () => 'x'.repeat(2000))
    expect(buildCookingPrompt('Big', long).length).toBeLessThanOrEqual(1500)
  })

  it('exposes the insufficient-balance code so callers can detect a top-up case', () => {
    expect(PIXVERSE_INSUFFICIENT_BALANCE).toBe(500090)
  })
})
