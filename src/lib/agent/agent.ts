import { stepCountIs } from 'ai'
import type { LanguageModel, Tool } from 'ai'

/**
 * The chat tool-calling agent (pure orchestration).
 *
 * One `generateText` loop with the shared tool surface (recall_memory, get_week,
 * remember, replan_week). The household's memory + this/last week + recent
 * feedback are PRE-INJECTED into the prompt, so the agent is already grounded and
 * typically only needs to act (replan_week) and learn (remember) — keeping the
 * number of model round-trips low.
 *
 * Injectable (mirrors replan/fallback.ts): the live `generateText` is loaded
 * lazily inside the Worker and can be stubbed in tests. With no model wired the
 * loop declines (returns null) and the caller falls back to the deterministic
 * replan engine, so the flow still works offline.
 */

/** Max tool round-trips before we force a final answer. */
const MAX_STEPS = 6

export const AGENT_SYSTEM_PROMPT = `You are Souso, a friendly assistant that helps a Dutch household manage their weekly dinner plan.

You are given, below the user's message, what we remember about this household plus this week's dinners, last week's dinners, and recent post-meal feedback. Use it to read intent correctly.

How to act:
- To change the week, call replan_week with ONE plain-language instruction at a time (e.g. "eating out Wednesday", "no fish", "more pasta"). It picks from the real recipe catalogue; you never invent recipes.
- When you learn a durable preference or fact, call remember so future weeks reflect it.
- Read nuance with care: "not pizza every week" is a VARIETY wish (serve it less often) with kind "variety" and polarity "neutral" — it is NOT a dislike and NOT a ban. Use last week's and this week's dinners to judge frequency.
- Only act when the user is actually asking for a change or telling you something to remember. If they just chat, answer briefly.

Keep your final reply to one or two short sentences, in the user's language.`

export type GenerateTextFn = (args: {
  model: LanguageModel
  system: string
  prompt: string
  tools: Record<string, Tool>
  stopWhen: ReturnType<typeof stepCountIs>
}) => Promise<{ text: string }>

export interface AgentDeps {
  /** The model to drive the loop. Absent -> the loop declines (returns null). */
  model?: LanguageModel | null
  /** The `generateText` impl. Defaults to the real one (lazy, Worker-only). */
  generateText?: GenerateTextFn
}

export interface RunAgentInput {
  /** The user's plain-language message. */
  instruction: string
  /** The pre-built memory + week + feedback grounding block. */
  memoryContext: string
  /** The AI SDK tools map, already bound to the verified household context. */
  tools: Record<string, Tool>
}

/**
 * Run the agent for one user turn. Returns the final assistant text, or null when
 * no model is wired (the caller then runs the deterministic replan fallback).
 * Any tool side effects (a replan, a remembered fact) happen inside the tools'
 * `execute`, which the caller observes through its tool context.
 */
export async function runAgent(
  input: RunAgentInput,
  deps: AgentDeps,
): Promise<{ text: string } | null> {
  if (!deps.model) return null
  const gen = deps.generateText ?? (await loadGenerateText())
  const { text } = await gen({
    model: deps.model,
    system: AGENT_SYSTEM_PROMPT,
    prompt: `User: ${input.instruction}\n\n---\n${input.memoryContext}`,
    tools: input.tools,
    stopWhen: stepCountIs(MAX_STEPS),
  })
  return { text }
}

/** Lazy-load the real `generateText` so it never enters a non-Worker bundle. */
async function loadGenerateText(): Promise<GenerateTextFn> {
  const { generateText } = await import('../braintrust-ai')
  return generateText
}
