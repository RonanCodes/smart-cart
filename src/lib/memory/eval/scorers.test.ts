import { describe, expect, it } from 'vitest'
import { scoreMemoryClassifierOutput } from './scorers'

describe('memory classifier eval scorers (offline)', () => {
  it('passes a correct variety classification', async () => {
    const scores = await scoreMemoryClassifierOutput({
      input: { note: 'not pizza every week' },
      output: {
        draft: {
          kind: 'variety',
          cuisine: 'pizza',
          term: null,
          polarity: 'neutral',
          scope: 'persistent',
        },
      },
      expected: {
        kind: 'variety',
        cuisine: 'pizza',
        polarity: 'neutral',
        mustNotBeDislike: true,
        mustNotBeConstraint: true,
      },
      metadata: {},
    })
    expect(scores.kind_match).toBe(1)
    expect(scores.polarity_match).toBe(1)
    expect(scores.not_dislike).toBe(1)
    expect(scores.not_constraint).toBe(1)
  })

  it('flags variety misclassified as dislike (headline trap)', async () => {
    const scores = await scoreMemoryClassifierOutput({
      input: { note: 'not pizza every week' },
      output: {
        draft: {
          kind: 'preference',
          cuisine: 'pizza',
          term: null,
          polarity: 'dislike',
          scope: 'persistent',
        },
      },
      expected: {
        kind: 'variety',
        polarity: 'neutral',
        mustNotBeDislike: true,
        mustNotBeConstraint: true,
      },
      metadata: {},
    })
    expect(scores.kind_match).toBe(0)
    expect(scores.polarity_match).toBe(0)
    expect(scores.not_dislike).toBe(0)
  })

  it('passes a constraint with term match (peanut/peanuts)', async () => {
    const scores = await scoreMemoryClassifierOutput({
      input: { note: 'allergic to peanuts' },
      output: {
        draft: {
          kind: 'constraint',
          cuisine: null,
          term: 'peanuts',
          polarity: 'dislike',
          scope: 'persistent',
        },
      },
      expected: {
        kind: 'constraint',
        term: 'peanut',
        polarity: 'dislike',
      },
      metadata: {},
    })
    expect(scores.kind_match).toBe(1)
    expect(scores.term_match).toBe(1)
  })

  it('flags null classifier output', async () => {
    const scores = await scoreMemoryClassifierOutput({
      input: { note: 'note' },
      output: { draft: null },
      expected: { kind: 'context' },
      metadata: {},
    })
    expect(scores.classified).toBe(0)
    expect(scores.kind_match).toBe(0)
  })
})
