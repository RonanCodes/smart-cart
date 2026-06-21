import type { EvalCase } from 'braintrust'
import type {
  MemoryEvalExpected,
  MemoryEvalInput,
  MemoryEvalMetadata,
} from './types'

/**
 * Golden dataset for the memory note classifier eval.
 *
 * Each row is a free-text note (the kind typed into post-meal feedback, or
 * paraphrased from chat) plus code-scored expectations. The headline trap is
 * variety vs dislike: "not pizza every week" must become kind=variety with
 * polarity=neutral, never a ban or hard constraint.
 */
export function memoryClassifierDataset(): Array<
  EvalCase<MemoryEvalInput, MemoryEvalExpected, MemoryEvalMetadata>
> {
  return [
    // --- variety (frequency wishes, NOT dislikes) ---
    {
      input: { note: 'not pizza every week' },
      expected: {
        kind: 'variety',
        cuisine: 'pizza',
        polarity: 'neutral',
        mustNotBeDislike: true,
        mustNotBeConstraint: true,
      },
      metadata: { tags: ['variety', 'headline-trap'] },
    },
    {
      input: { note: 'we eat too much pasta' },
      expected: {
        kind: 'variety',
        cuisine: 'pasta',
        polarity: 'neutral',
        mustNotBeDislike: true,
        mustNotBeConstraint: true,
      },
      metadata: { tags: ['variety'] },
    },
    {
      input: { note: 'mix it up more, less Italian' },
      expected: {
        kind: 'variety',
        cuisine: 'italian',
        polarity: 'neutral',
        mustNotBeDislike: true,
      },
      metadata: { tags: ['variety'] },
    },
    {
      input: { note: 'geen pizza elke week' },
      expected: {
        kind: 'variety',
        cuisine: 'pizza',
        polarity: 'neutral',
        mustNotBeDislike: true,
        mustNotBeConstraint: true,
      },
      metadata: { tags: ['variety', 'dutch'] },
    },
    {
      input: { note: 'too much curry lately' },
      expected: {
        kind: 'variety',
        polarity: 'neutral',
        mustNotBeDislike: true,
      },
      metadata: { tags: ['variety'] },
    },

    // --- constraints (allergies, hard never) ---
    {
      input: { note: 'allergic to peanuts' },
      expected: {
        kind: 'constraint',
        term: 'peanut',
        polarity: 'dislike',
      },
      metadata: { tags: ['constraint', 'allergy'] },
    },
    {
      input: { note: 'we are allergic to peanuts' },
      expected: {
        kind: 'constraint',
        term: 'peanut',
        polarity: 'dislike',
      },
      metadata: { tags: ['constraint', 'allergy'] },
    },
    {
      input: { note: 'never fish — my partner hates it' },
      expected: {
        kind: 'constraint',
        term: 'fish',
        polarity: 'dislike',
      },
      metadata: { tags: ['constraint'] },
    },
    {
      input: { note: 'no shellfish ever' },
      expected: {
        kind: 'constraint',
        term: 'shellfish',
        polarity: 'dislike',
      },
      metadata: { tags: ['constraint'] },
    },
    {
      input: { note: 'lactose intolerant' },
      expected: {
        kind: 'constraint',
        polarity: 'dislike',
      },
      metadata: { tags: ['constraint', 'allergy'] },
    },

    // --- preferences (plain likes/dislikes) ---
    {
      input: { note: 'we love Thai food' },
      expected: {
        kind: 'preference',
        cuisine: 'thai',
        polarity: 'like',
      },
      metadata: { tags: ['preference', 'like'] },
    },
    {
      input: { note: 'hate cilantro' },
      expected: {
        kind: 'preference',
        term: 'cilantro',
        polarity: 'dislike',
      },
      metadata: { tags: ['preference', 'dislike'] },
    },
    {
      input: { note: 'really enjoy salmon' },
      expected: {
        kind: 'preference',
        term: 'salmon',
        polarity: 'like',
      },
      metadata: { tags: ['preference', 'like'] },
    },

    // --- logistics ---
    {
      input: { note: 'we only have 20 minutes on weeknights' },
      expected: {
        kind: 'logistics',
        polarity: 'neutral',
      },
      metadata: { tags: ['logistics'] },
    },
    {
      input: { note: 'tight budget this month' },
      expected: {
        kind: 'logistics',
        polarity: 'neutral',
      },
      metadata: { tags: ['logistics'] },
    },

    // --- context ---
    {
      input: { note: 'kids are visiting this weekend' },
      expected: {
        kind: 'context',
        polarity: 'neutral',
      },
      metadata: { tags: ['context'] },
    },

    // --- scope ---
    {
      input: { note: 'just this week no red meat' },
      expected: {
        kind: 'constraint',
        term: 'red meat',
        polarity: 'dislike',
        scope: 'week',
      },
      metadata: { tags: ['scope', 'week'] },
    },
  ]
}
