import { createServerFn } from '@tanstack/react-start'

/**
 * The chat agent server fn: the text box on the week view talks to THIS, a real
 * tool-calling agent that shares its tool surface with the voice (VAPI) agent
 * (src/lib/agent/tools.ts). It recalls the household's memory (pre-injected as
 * grounding), acts via tools (replan_week, remember, ...), and replies.
 *
 * Identity is server-verified (signed-in user -> their household); the model
 * never supplies it. Every server-only collaborator is dynamically imported in
 * the handler so none of it (nor the D1 binding) leaks into the client bundle
 * (the replan-server / planner-server pattern).
 *
 * Degrades cleanly with no chat model: it falls back to the deterministic replan
 * engine so the one flow still works offline (the existing demo behaviour).
 */

export interface ChatAgentRequest {
  /** The user's plain-language message from the week-view chat box. */
  instruction: string
}

export interface ChatAgentResponse {
  /** The new plan revision id when the week changed, else null. */
  planId: string | null
  /** Whether the week actually changed (so the client knows to reload it). */
  changed: boolean
  /** A short message to show the user. */
  message: string
}

/** What a replan tool side effect reports back to the handler. */
interface ReplanCapture {
  planId: string
  weekStart: string
  changed: boolean
}

export const chatAgent = createServerFn({ method: 'POST' })
  .validator((data: ChatAgentRequest) => data)
  .handler(async ({ data }): Promise<ChatAgentResponse> => {
    const instruction = data.instruction.trim()
    if (!instruction) throw new Error('instruction required')

    const { getSessionUser } = await import('./server-auth')
    const user = await getSessionUser()
    if (!user) throw new Error('Not signed in')

    const { getDb } = await import('../db/client')
    const { household } = await import('../db/schema')
    const { eq } = await import('drizzle-orm')
    const db = await getDb()

    const rows = await db
      .select({ id: household.id })
      .from(household)
      .where(eq(household.ownerId, user.id))
      .limit(1)
    const hh = rows[0]
    if (!hh) throw new Error('No household, onboard first')

    // Capture any replan a tool performs so we can adopt the new plan in the UI.
    let replan: ReplanCapture | null = null

    const model = await loadChatModel()

    if (model) {
      const { buildAiTools } = await import('./agent/tools')
      const { buildMemoryContext } = await import('./memory/memory-server')
      const { runAgent } = await import('./agent/agent')

      const tools = buildAiTools({
        householdId: hh.id,
        source: 'chat',
        onReplan: (r) => {
          replan = r
        },
      })
      const { text: memoryContext } = await buildMemoryContext(hh.id)
      const res = await runAgent(
        { instruction, memoryContext, tools },
        { model },
      )

      const captured = replan as ReplanCapture | null
      const message =
        res?.text.trim() || (captured?.changed ? 'Updated your week.' : 'Done.')
      return {
        planId: captured?.changed ? captured.planId : null,
        changed: Boolean(captured?.changed),
        message,
      }
    }

    // No chat model: run the deterministic replan engine directly so the one flow
    // still works offline. (Memory is not written here — there is no model to
    // classify a free-text message without one.)
    const { replanForHousehold } = await import('./replan-internal-server')
    const res = await replanForHousehold(hh.id, instruction)
    if (!res) {
      return {
        planId: null,
        changed: false,
        message: "There's no week planned yet, so there's nothing to change.",
      }
    }
    return {
      planId: res.changed ? res.planId : null,
      changed: res.changed,
      message: res.message,
    }
  })

/** The chat model, gated on OPENAI_API_KEY. Null -> deterministic fallback. */
async function loadChatModel() {
  const { readEnv } = await import('./env')
  const key = await readEnv('OPENAI_API_KEY')
  if (!key) return null
  try {
    const { models } = await import('./models')
    return models.fast
  } catch {
    return null
  }
}
