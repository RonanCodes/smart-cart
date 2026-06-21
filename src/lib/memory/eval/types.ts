import type {
  MemoryDraft,
  MemoryKind,
  MemoryPolarity,
  MemoryScope,
} from '../memory'

/** What the eval task receives. */
export interface MemoryEvalInput {
  /** The free-text note to classify (feedback note or agent-less input). */
  note: string
}

/** What the classifier produced. */
export interface MemoryEvalOutput {
  draft: MemoryDraft | null
}

/**
 * Ground-truth expectations for code scorers. Most fields are optional; only
 * specify what the case is testing so unrelated dimensions do not fail it.
 */
export interface MemoryEvalExpected {
  /** The memory kind the note should map to. */
  kind?: MemoryKind
  /** Expected polarity (critical for variety vs dislike trap). */
  polarity?: MemoryPolarity
  /** Expected cuisine (lowercased), if any. */
  cuisine?: string | null
  /** Expected term (lowercased), if any. */
  term?: string | null
  /** Expected scope. */
  scope?: MemoryScope
  /** When true, polarity must NOT be dislike (variety trap guard). */
  mustNotBeDislike?: boolean
  /** When true, kind must NOT be constraint (variety trap guard). */
  mustNotBeConstraint?: boolean
}

/** Row metadata; run-task fills tags before scoring. */
export type MemoryEvalMetadata = {
  tags?: Array<string>
}
