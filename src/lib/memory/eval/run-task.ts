import { models } from '../../models'
import { classifyNote } from '../classify'
import type {
  MemoryEvalExpected,
  MemoryEvalInput,
  MemoryEvalMetadata,
  MemoryEvalOutput,
} from './types'

/**
 * Braintrust eval task: classify one free-text note into a structured memory
 * draft using the same `classifyNote` path the feedback bridge uses.
 */
export async function runMemoryClassifierEvalTask(
  input: MemoryEvalInput,
  hooks: {
    metadata: MemoryEvalMetadata
    expected: MemoryEvalExpected
  },
): Promise<MemoryEvalOutput> {
  hooks.metadata.tags = [...(hooks.metadata.tags ?? [])]

  const draft = await classifyNote(input.note, { model: models.fast })
  return { draft }
}
