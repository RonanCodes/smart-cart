import { tool } from 'ai'
import { z } from 'zod'
import type { Tool } from 'ai'
import type { MemorySource } from '../memory/memory'

/**
 * The shared agent tool surface: ONE definition consumed by two callers — the
 * chat tool-calling agent (via the AI SDK `tool()` adapter) and the voice (VAPI)
 * dispatch (via `dispatchAgentTool`). Defining the tools once guarantees chat and
 * voice behave identically: same names, same schemas, same handlers.
 *
 * Every handler is server-only and reaches its collaborators through dynamic
 * `import()` (the planner-server / vapi-dispatch pattern), so this module can be
 * dynamically imported from a server-fn handler or the VAPI webhook without ever
 * leaking the D1 binding into the client bundle.
 *
 * The `householdId` is ALWAYS the server-verified identity supplied by the caller
 * (the signed-in user's household, or the household from the signed VAPI call
 * token) — never a tool argument, which a model could spoof.
 */

/** Side-channel + identity the handlers run against. */
export interface AgentToolContext {
  /** Server-verified household. Never read from a tool argument. */
  householdId: string
  /** Where the write came from, stamped on any memory the agent stores. */
  source: MemorySource
  /**
   * Called when a tool changed the week, so the chat server can adopt the new
   * plan revision in the UI. Voice leaves this undefined (it only speaks back).
   */
  onReplan?: (res: {
    planId: string
    weekStart: string
    changed: boolean
  }) => void
}

export const rememberInputSchema = z.object({
  content: z
    .string()
    .min(1)
    .describe("The household's words, e.g. 'not pizza every week'."),
  kind: z
    .enum(['preference', 'constraint', 'variety', 'context', 'logistics'])
    .describe(
      "How to use it: 'variety' = wants it LESS often (not banned); 'constraint' = allergy/never; 'preference' = plain like/dislike; 'logistics' = time/equipment/budget; 'context' = anything else.",
    ),
  cuisine: z
    .string()
    .nullish()
    .describe(
      'A single lowercase cuisine word if one is the subject, else null.',
    ),
  term: z
    .string()
    .nullish()
    .describe(
      'A single lowercase food/ingredient word if one is the subject, else null.',
    ),
  polarity: z
    .enum(['like', 'dislike', 'neutral'])
    .default('neutral')
    .describe(
      "'neutral' for a variety wish; 'dislike' for an allergy/dislike.",
    ),
  scope: z
    .enum(['persistent', 'week'])
    .default('persistent')
    .describe("'week' only if it clearly applies to this week alone."),
})

export const replanInputSchema = z.object({
  instruction: z
    .string()
    .min(1)
    .describe(
      "A single plain-language change to the week, e.g. 'eating out Wednesday', 'no fish', 'more pasta'.",
    ),
})

const emptyInputSchema = z.object({})

/** A tool definition: name, model-facing description, input schema, handler. */
interface AgentToolDef<TSchema extends z.ZodTypeAny> {
  name: string
  description: string
  schema: TSchema
  run: (args: z.infer<TSchema>, ctx: AgentToolContext) => Promise<string>
}

function def<TSchema extends z.ZodTypeAny>(
  d: AgentToolDef<TSchema>,
): AgentToolDef<TSchema> {
  return d
}

async function runRecallMemory(ctx: AgentToolContext): Promise<string> {
  const { buildMemoryContext } = await import('../memory/memory-server')
  const { text } = await buildMemoryContext(ctx.householdId)
  return text
}

async function runGetWeek(ctx: AgentToolContext): Promise<string> {
  const { getWeekText } = await import('../memory/memory-server')
  return getWeekText(ctx.householdId)
}

async function runRemember(
  args: z.infer<typeof rememberInputSchema>,
  ctx: AgentToolContext,
): Promise<string> {
  const { rememberFact } = await import('../memory/memory-server')
  const m = await rememberFact(ctx.householdId, {
    content: args.content,
    source: ctx.source,
    kind: args.kind,
    cuisine: args.cuisine ?? null,
    term: args.term ?? null,
    polarity: args.polarity,
    scope: args.scope,
  })
  return `Got it — I'll remember that: "${m.content}".`
}

async function runReplan(
  args: z.infer<typeof replanInputSchema>,
  ctx: AgentToolContext,
): Promise<string> {
  const { replanForHousehold } = await import('../replan-internal-server')
  const res = await replanForHousehold(ctx.householdId, args.instruction)
  if (!res) {
    return "There's no week planned yet, so there's nothing to change."
  }
  ctx.onReplan?.({
    planId: res.planId,
    weekStart: res.weekStart,
    changed: res.changed,
  })
  return res.message
}

/**
 * The tool registry. Order is the order the model sees them. Recall is first so
 * the agent is nudged to read memory before acting.
 */
export const AGENT_TOOLS = [
  def({
    name: 'recall_memory',
    description:
      "Read everything we remember about this household plus this week's and last week's dinners and recent post-meal feedback. Call this FIRST to ground any decision.",
    schema: emptyInputSchema,
    run: (_args, ctx) => runRecallMemory(ctx),
  }),
  def({
    name: 'get_week',
    description: "Read the household's current planned week (the dinners).",
    schema: emptyInputSchema,
    run: (_args, ctx) => runGetWeek(ctx),
  }),
  def({
    name: 'remember',
    description:
      "Save an important, durable fact about the household's tastes or context for future weeks. Use this whenever you learn something worth keeping. A note like 'not pizza every week' is a 'variety' wish (eat it less often), NOT a dislike.",
    schema: rememberInputSchema,
    run: runRemember,
  }),
  def({
    name: 'replan_week',
    description:
      'Change the current week from a single plain-language instruction. The change is grounded in the real recipe catalogue (never invents recipes).',
    schema: replanInputSchema,
    run: runReplan,
  }),
] as const

/** Tool names the agent surface exposes (for typing the dispatch). */
export type AgentToolName = (typeof AGENT_TOOLS)[number]['name']

/** The registry widened to a uniform def type, so the generic consumers below
 * don't trip over the union of per-tool schema types. */
const AGENT_TOOL_LIST = AGENT_TOOLS as ReadonlyArray<AgentToolDef<z.ZodTypeAny>>

/**
 * Validate + run one tool by name (the VAPI dispatch path). Returns an honest
 * string for an unknown tool or bad arguments rather than throwing, so a voice
 * call never fails hard.
 */
export async function dispatchAgentTool(
  name: string,
  rawArgs: Record<string, unknown>,
  ctx: AgentToolContext,
): Promise<string> {
  const t = AGENT_TOOL_LIST.find((d) => d.name === name)
  if (!t) return `I don't know how to "${name}" yet.`
  const parsed = t.schema.safeParse(rawArgs)
  if (!parsed.success) {
    return `I couldn't use ${name} — the details were incomplete.`
  }
  return t.run(parsed.data, ctx)
}

/**
 * Build the AI SDK `tools` map for the chat agent's `generateText` loop. Each
 * tool's `execute` closes over the verified context, so the model never passes
 * identity. Returns a plain record keyed by tool name.
 */
export function buildAiTools(ctx: AgentToolContext): Record<string, Tool> {
  const tools: Record<string, Tool> = {}
  for (const d of AGENT_TOOL_LIST) {
    tools[d.name] = tool({
      description: d.description,
      inputSchema: d.schema,
      execute: async (args: unknown) => d.run(d.schema.parse(args), ctx),
    })
  }
  return tools
}
