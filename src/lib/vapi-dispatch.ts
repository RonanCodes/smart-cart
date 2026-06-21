/**
 * The VAPI tool dispatch table: maps a tool name to the app action and returns a
 * spoken-result STRING. `householdId` is always the verified, server-minted
 * identity (from the signed call token), never a tool argument (model-filled and
 * spoofable). Unknown or not-yet-wired tools return an honest string rather than
 * failing the call, so the assistant never claims a success the app did not make.
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
): Promise<string> {
  switch (name) {
    case 'ping':
      return 'pong'

    // The shared agent tools: read memory + week, save a durable fact, replan.
    // These are the SAME handlers the chat agent uses, so voice and chat stay in
    // lockstep. `recall_memory` lets the assistant ground itself before acting;
    // `remember` lets it keep nuance like "not pizza every week" as a variety
    // wish (not a dislike) for future weeks.
    case 'recall_memory':
    case 'get_week':
    case 'remember':
    case 'replan_week': {
      const { dispatchAgentTool } = await import('./agent/tools')
      return dispatchAgentTool(name, args, { householdId, source: 'voice' })
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
