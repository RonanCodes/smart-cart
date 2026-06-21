import type { EvalScorer } from 'braintrust'
import type {
  MemoryEvalExpected,
  MemoryEvalInput,
  MemoryEvalMetadata,
  MemoryEvalOutput,
} from './types'

type Scorer = EvalScorer<
  MemoryEvalInput,
  MemoryEvalOutput,
  MemoryEvalExpected,
  MemoryEvalMetadata
>

function score(name: string, ok: boolean, reason?: string) {
  return {
    name,
    score: ok ? 1 : 0,
    ...(reason ? { metadata: { reason } } : {}),
  }
}

/** Classifier must return a draft (not null). */
export const classified: Scorer = ({ output }) => {
  return score(
    'classified',
    output.draft != null,
    output.draft == null ? 'Classifier returned null' : undefined,
  )
}

/** Expected kind must match. */
export const kindMatch: Scorer = ({ expected, output }) => {
  if (!expected.kind) return score('kind_match', true)
  if (!output.draft) return score('kind_match', false, 'No draft')
  return score(
    'kind_match',
    output.draft.kind === expected.kind,
    `expected kind=${expected.kind}, got ${output.draft.kind}`,
  )
}

/** Expected polarity must match. */
export const polarityMatch: Scorer = ({ expected, output }) => {
  if (!expected.polarity) return score('polarity_match', true)
  if (!output.draft) return score('polarity_match', false, 'No draft')
  return score(
    'polarity_match',
    output.draft.polarity === expected.polarity,
    `expected polarity=${expected.polarity}, got ${output.draft.polarity}`,
  )
}

/** Expected cuisine must match (case-insensitive). */
export const cuisineMatch: Scorer = ({ expected, output }) => {
  if (expected.cuisine === undefined) return score('cuisine_match', true)
  if (!output.draft) return score('cuisine_match', false, 'No draft')
  const exp = expected.cuisine?.toLowerCase() ?? null
  const got = output.draft.cuisine?.toLowerCase() ?? null
  return score(
    'cuisine_match',
    exp === got,
    `expected cuisine=${exp}, got ${got}`,
  )
}

/** Expected term must match (case-insensitive, substring ok for compound terms). */
export const termMatch: Scorer = ({ expected, output }) => {
  if (expected.term === undefined) return score('term_match', true)
  if (!output.draft) return score('term_match', false, 'No draft')
  const exp = expected.term?.toLowerCase() ?? null
  const got = output.draft.term?.toLowerCase() ?? null
  if (exp === null) {
    return score('term_match', got === null, `expected no term, got ${got}`)
  }
  // Allow "peanut" to match "peanuts" and "red meat" to match "meat" loosely.
  const ok =
    got === exp || (got != null && (got.includes(exp) || exp.includes(got)))
  return score(
    'term_match',
    ok,
    ok ? undefined : `expected term≈${exp}, got ${got}`,
  )
}

/** Expected scope must match. */
export const scopeMatch: Scorer = ({ expected, output }) => {
  if (!expected.scope) return score('scope_match', true)
  if (!output.draft) return score('scope_match', false, 'No draft')
  return score(
    'scope_match',
    output.draft.scope === expected.scope,
    `expected scope=${expected.scope}, got ${output.draft.scope}`,
  )
}

/** Variety trap: polarity must NOT be dislike. */
export const notDislike: Scorer = ({ expected, output }) => {
  if (!expected.mustNotBeDislike) return score('not_dislike', true)
  if (!output.draft) return score('not_dislike', false, 'No draft')
  return score(
    'not_dislike',
    output.draft.polarity !== 'dislike',
    `Variety note misclassified as dislike (polarity=${output.draft.polarity})`,
  )
}

/** Variety trap: kind must NOT be constraint. */
export const notConstraint: Scorer = ({ expected, output }) => {
  if (!expected.mustNotBeConstraint) return score('not_constraint', true)
  if (!output.draft) return score('not_constraint', false, 'No draft')
  return score(
    'not_constraint',
    output.draft.kind !== 'constraint',
    `Variety note misclassified as constraint (kind=${output.draft.kind})`,
  )
}

export const memoryClassifierScorers: Array<Scorer> = [
  classified,
  kindMatch,
  polarityMatch,
  cuisineMatch,
  termMatch,
  scopeMatch,
  notDislike,
  notConstraint,
]

/** Run scorers locally (vitest / dry-run) without Braintrust. */
export async function scoreMemoryClassifierOutput(args: {
  input: MemoryEvalInput
  output: MemoryEvalOutput
  expected: MemoryEvalExpected
  metadata: MemoryEvalMetadata
}): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  for (const scorer of memoryClassifierScorers) {
    const result = await scorer({
      input: args.input,
      output: args.output,
      expected: args.expected,
      metadata: args.metadata,
    })
    const items = Array.isArray(result) ? result : [result]
    for (const item of items) {
      if (item == null || typeof item === 'number') continue
      out[item.name] = item.score ?? 0
    }
  }
  return out
}
