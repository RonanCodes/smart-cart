/**
 * The VAPI tool dispatch table: maps a tool name to the app action and returns a
 * spoken-result STRING. `householdId` is always the verified, server-minted
 * identity (from the signed call token), never a tool argument (model-filled and
 * spoofable). `planId` is the meal_plan revision the user had open at call-start
 * (also from call metadata, not tool args). Unknown or not-yet-wired tools return
 * an honest string rather than failing the call.
 *
 * The memory + replan tools are the SHARED agent surface (src/lib/agent/tools.ts),
 * so the voice assistant and the chat agent behave identically: same names, same
 * schemas, same handlers. The voice path stamps `source: 'voice'` on any memory
 * it writes. Server-only collaborators are dynamically imported so none of them
 * (nor the D1 binding) leaks into the client bundle (the planner-server pattern).
 */
export async function dispatchVapiTool(
  name: string,
  args: Record<string, unknown>,
  householdId: string,
  planId?: string,
): Promise<string> {
  switch (name) {
    case 'ping':
      return 'pong'

    // Memory: ground the assistant before it acts, and let it keep durable facts.
    // `recall_memory` returns what we remember + this/last week + recent feedback;
    // `remember` stores a fact, keeping nuance like "not pizza every week" as a
    // variety wish (not a dislike). Voice stamps `source: 'voice'` on writes.
    case 'recall_memory': {
      const { buildMemoryContext } = await import('./memory/memory-server')
      const { text } = await buildMemoryContext(householdId)
      return text
    }

    case 'remember': {
      const content =
        typeof args.content === 'string' ? args.content.trim() : ''
      const kind = typeof args.kind === 'string' ? args.kind : ''
      const validKinds = [
        'preference',
        'constraint',
        'variety',
        'context',
        'logistics',
      ]
      if (!content || !validKinds.includes(kind)) {
        return "I didn't catch what to remember — say it once more?"
      }
      const { rememberFact } = await import('./memory/memory-server')
      const m = await rememberFact(householdId, {
        content,
        source: 'voice',
        kind: kind as
          | 'preference'
          | 'constraint'
          | 'variety'
          | 'context'
          | 'logistics',
        cuisine: typeof args.cuisine === 'string' ? args.cuisine : null,
        term: typeof args.term === 'string' ? args.term : null,
        polarity:
          args.polarity === 'like' ||
          args.polarity === 'dislike' ||
          args.polarity === 'neutral'
            ? args.polarity
            : undefined,
        scope:
          args.scope === 'week' || args.scope === 'persistent'
            ? args.scope
            : undefined,
      })
      return `Got it — I'll remember that: "${m.content}".`
    }

    case 'get_week': {
      const { loadVoiceReplanContext } =
        await import('./agent/replan-context-server')
      const ctx = await loadVoiceReplanContext(householdId, planId)
      if (!ctx) {
        return "You don't have a week planned yet, so there's nothing to read back."
      }
      const { WeekSession } = await import('./agent/week-session')
      const session = new WeekSession({
        week: ctx.week,
        recipes: ctx.recipes,
        profile: ctx.profile,
        swipes: ctx.swipes,
        penalties: ctx.penalties,
      })
      return session.describe()
    }

    case 'replan_week': {
      const instruction =
        typeof args.instruction === 'string' ? args.instruction.trim() : ''
      if (!instruction) {
        return 'Tell me what to change, for example "eating out Wednesday".'
      }
      const { replanForHousehold } = await import('./replan-internal-server')
      const res = await replanForHousehold(householdId, instruction, planId)
      if (!res) {
        return "You don't have a week planned yet, so there's nothing to change."
      }
      return res.message
    }

    // Wired in later slices (PRD §6). Honest "not wired yet" until then.
    case 'add_items':
      return "Adding items by voice isn't wired up yet."
    case 'generate_cart':
      return "Building your cart by voice isn't wired up yet."

    default:
      return `I don't know how to "${name}" yet.`
  }
}
