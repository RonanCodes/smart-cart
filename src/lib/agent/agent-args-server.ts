import type { MemorySource } from '../memory/memory'
import { buildReplanSystemPrompt } from './prompt'
import { buildMemoryTools } from './memory-tools'
import type { ReplanAgentInput } from './runner'
import { replanAgentArgs } from './runner'

/** The household-scoped memory wiring for a server-side agent run. */
export interface ReplanMemoryInput {
  householdId: string
  source: MemorySource
  /** Pre-built grounding text (from `buildMemoryContext`), injected into prompt. */
  context?: string
}

export interface ReplanAgentInputWithMemory extends ReplanAgentInput {
  memory: ReplanMemoryInput
}

/**
 * Server-only replan args with durable-memory tools + grounded prompt.
 *
 * Lives outside `runner.ts` so Braintrust offline evals for the replan agent
 * never pull `memory-server` → D1 → `cloudflare:workers` into the bundle. Chat
 * and voice import this module dynamically inside their handlers.
 */
export async function replanAgentArgsWithMemory(
  input: ReplanAgentInputWithMemory,
) {
  const base = replanAgentArgs(input)
  return {
    ...base,
    system: buildReplanSystemPrompt(
      input.profile,
      input.recipes,
      input.memory.context,
    ),
    tools: {
      ...base.tools,
      ...buildMemoryTools({
        householdId: input.memory.householdId,
        source: input.memory.source,
      }),
    },
  }
}
