import { generateText } from '../../braintrust-ai'
import { models } from '../../models'
import { finalizeReplan, replanAgentArgs } from '../runner'
import { WeekSession } from '../week-session'
import { getFixture, matcherFactory, recipeIds } from './fixtures'
import type {
  ReplanEvalExpected,
  ReplanEvalInput,
  ReplanEvalMetadata,
  ReplanEvalOutput,
} from './types'

function extractToolCalls(result: {
  steps: Array<{ toolCalls?: Array<{ toolName: string; input: unknown }> }>
}): Array<{ name: string; args: unknown }> {
  const out: Array<{ name: string; args: unknown }> = []
  for (const step of result.steps) {
    for (const call of step.toolCalls ?? []) {
      out.push({ name: call.toolName, args: call.input })
    }
  }
  return out
}

/**
 * Braintrust eval task: run the replan agent against a stubbed fixture and
 * attach tool-call metadata for step-level scorers (Braintrust agents guide).
 */
export async function runReplanEvalTask(
  input: ReplanEvalInput,
  hooks: {
    metadata: ReplanEvalMetadata
    expected: ReplanEvalExpected
  },
): Promise<ReplanEvalOutput> {
  const fixture = getFixture(input.fixtureId)
  const initialWeek = structuredClone(fixture.week)

  hooks.metadata.fixtureId = fixture.id
  hooks.metadata.fixtureDescription = fixture.description
  hooks.metadata.tags = [...fixture.tags, ...(hooks.metadata.tags ?? [])]
  hooks.metadata.initialWeek = initialWeek
  hooks.metadata.recipeIds = recipeIds(fixture.recipes)
  hooks.metadata.toolCalls = []

  const session = new WeekSession({
    week: structuredClone(fixture.week),
    recipes: fixture.recipes,
    profile: fixture.profile,
    swipes: fixture.swipes,
    seed: fixture.seed,
    buildMatcher: matcherFactory(fixture.withMatcher),
  })

  const result = await generateText(
    replanAgentArgs({
      session,
      profile: fixture.profile,
      recipes: fixture.recipes,
      instruction: input.instruction,
      model: models.fast,
    }),
  )

  const toolCalls = extractToolCalls(result)
  hooks.metadata.toolCalls = toolCalls

  const finalized = finalizeReplan(await result.text, session)
  return { ...finalized, toolCalls }
}
