import type { PlannedWeek } from './planner/types'

/**
 * Voice replan: edit a household's most-recent week from a plain-language
 * instruction, with no request cookie (the VAPI tool webhook is server-to-server).
 * Runs the same planner-grounded replan agent the chat path uses (`runReplanAgent`
 * via `generateText`, non-streaming), then persists a new revision and returns the
 * spoken summary.
 *
 * Server-only, and deliberately NOT in `replan-server.ts`: that module is imported
 * by the client week view (for the `replanWeek` createServerFn), so a plain
 * exported function there that reaches the provider / D1 would leak into the client
 * bundle. Only the VAPI tool dispatch (server) imports this.
 */
export interface VoiceReplanResult {
  planId: string
  weekStart: string
  week: PlannedWeek
  changed: boolean
  message: string
}

export async function replanForHousehold(
  householdId: string,
  instruction: string,
  planId?: string,
): Promise<VoiceReplanResult | null> {
  const {
    loadVoiceReplanContext,
    persistRevision,
    buildReplanModel,
    buildMatcherFactory,
  } = await import('./agent/replan-context-server')

  const ctx = await loadVoiceReplanContext(householdId, planId)
  if (!ctx) return null

  const { model, aiAvailable } = await buildReplanModel()
  if (!aiAvailable || !model) {
    return {
      planId: ctx.planId,
      weekStart: ctx.weekStart,
      week: ctx.week,
      changed: false,
      message:
        "AI adjustments are off (no API key set), so I can't read free-form requests. The buttons (swap a day, eating-out) still work.",
    }
  }

  const buildMatcher = await buildMatcherFactory()
  const { WeekSession } = await import('./agent/week-session')
  const session = new WeekSession({
    week: ctx.week,
    recipes: ctx.recipes,
    profile: ctx.profile,
    swipes: ctx.swipes,
    penalties: ctx.penalties,
    buildMatcher,
  })

  const { generateText, flush } = await import('./braintrust-ai')
  const { replanAgentArgsWithMemory } =
    await import('./agent/agent-args-server')
  const { finalizeReplan } = await import('./agent/runner')

  // Ground the agent in durable memory + recent history, and let it write new
  // facts during the turn (stamped as voice). Best-effort: a memory read failure
  // must never break a voice replan, so fall back to no grounding.
  const { buildMemoryContext } = await import('./memory/memory-server')
  let memoryContext = ''
  try {
    memoryContext = (await buildMemoryContext(ctx.householdId)).text
  } catch {
    memoryContext = ''
  }

  try {
    const { text } = await generateText(
      await replanAgentArgsWithMemory({
        session,
        profile: ctx.profile,
        recipes: ctx.recipes,
        instruction,
        model,
        memory: {
          householdId: ctx.householdId,
          source: 'voice',
          context: memoryContext,
        },
      }),
    )
    const result = finalizeReplan(text, session)

    let planId = ctx.planId
    if (result.changed) {
      planId = await persistRevision(
        ctx.householdId,
        ctx.weekStart,
        result.week,
      )
    }
    return {
      planId,
      weekStart: ctx.weekStart,
      week: result.week,
      changed: result.changed,
      message: result.message,
    }
  } finally {
    try {
      await flush()
    } catch {
      // tracing flush is best-effort; never fail a voice turn on it.
    }
  }
}
