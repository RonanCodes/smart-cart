import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * public/llms.txt is served verbatim (no route, no build step), per the
 * llmstxt.org convention AI agents probe for alongside robots.txt. Worker logs
 * showed a GET for it 404ing (finding find_611fc1e9), so this file must exist
 * and describe Souso in the llms.txt shape: an H1 title, then a blockquote
 * summary.
 */
describe('public/llms.txt', () => {
  it('exists and describes Souso to AI agents', () => {
    const filePath = path.resolve(process.cwd(), 'public/llms.txt')
    const content = readFileSync(filePath, 'utf8')

    expect(content).toMatch(/^# Souso\b/)
    expect(content).toMatch(/^>\s+.+/m)
    expect(content).toContain('AI household food planner')
  })
})
