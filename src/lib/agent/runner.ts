import { stepCountIs } from 'ai'
import { buildReplanSystemPrompt } from './prompt'
import { buildReplanTools } from './tools'
import type { LanguageModel, ModelMessage } from 'ai'
import type {
  PlannedWeek,
  PlannerProfile,
  PlannerRecipe,
} from '../planner/types'
import type { WeekSession } from './week-session'

/**
 * The replan agent runner.
 *
 * The agent is a bounded tool loop over the planner-grounded `WeekSession`: the
 * model reads the instruction, calls the constraint tools (skip / swap / exclude /
 * lean / quicker / ...), and the session mutates the working week using the planner
 * core. We cap the loop so a confused model can never spin.
 *
 * The runner stays transport-agnostic: it builds the shared `streamText` /
 * `generateText` args and translates a stream into the app's `ReplanEvent`s. The
 * caller owns the actual provider call (the chat route uses the Braintrust-traced
 * `streamText`, the voice path uses `generateText`), so this module pulls in no
 * provider and is trivially testable with a mock model.
 */

/** Hard cap on tool-loop steps; a replan never needs more than a handful. */
export const REPLAN_MAX_STEPS = 8

export interface ReplanAgentInput {
  /** The mutable working week the tools edit. */
  session: WeekSession
  /** Household profile, folded into the grounded system prompt. */
  profile: PlannerProfile
  /** The catalogue, used only to list the available cuisines in the prompt. */
  recipes: Array<PlannerRecipe>
  /** The plain-language instruction. */
  instruction: string
  /** The language model to run the loop. */
  model: LanguageModel
  /**
   * Prior conversation turns for a multi-turn replan (#replan-ux). When the
   * agent asks a clarifying question ("Which day did you mean?") and the user
   * answers, the earlier turns are passed back here so the model understands the
   * answer in context. Empty / omitted for the common one-shot case, which keeps
   * the request identical to before. The current `instruction` is always
   * appended as the final user turn, so callers pass only the PRIOR turns.
   */
  history?: Array<ReplanTurn>
}

/** One prior turn in a multi-turn replan conversation. */
export interface ReplanTurn {
  role: 'user' | 'assistant'
  text: string
}

/** The shared args for `streamText` / `generateText`. */
export function replanAgentArgs(input: ReplanAgentInput) {
  const base = {
    model: input.model,
    system: buildReplanSystemPrompt(input.profile, input.recipes),
    tools: buildReplanTools(input.session),
    stopWhen: stepCountIs(REPLAN_MAX_STEPS),
  }
  // No prior turns: the original one-shot shape (a bare `prompt`), unchanged.
  if (!input.history || input.history.length === 0) {
    return { ...base, prompt: input.instruction }
  }
  // Multi-turn: hand the model the real conversation as `messages` (the prior
  // turns plus the new instruction as the final user turn). This is the AI
  // SDK's native shape, so the clarify→answer loop reads naturally with no
  // string-mashing. Bounded by the client to the last few turns.
  const messages: Array<ModelMessage> = [
    ...input.history.map((t) => ({ role: t.role, content: t.text })),
    { role: 'user' as const, content: input.instruction },
  ]
  return { ...base, messages }
}

/** The events the chat client consumes: streamed text, live week, final summary. */
export type ReplanEvent =
  | { type: 'text'; delta: string }
  | { type: 'week'; week: PlannedWeek }
  | { type: 'done'; message: string; changed: boolean }

/** The minimal `streamText` result shape the translator consumes. */
interface StreamLike {
  fullStream: AsyncIterable<{ type: string; text?: string }>
  text: PromiseLike<string>
}

/** Fallback narration when the model emits tool calls but no closing text. */
const DEFAULT_DONE = "Done. I've updated your week."

/**
 * Translate a `streamText` result into the app's replan event stream: text deltas
 * as they arrive, the working week after every tool result (so the grid reflows
 * live), and a final `done` event with the full message + whether anything moved.
 * The session is the source of truth for the week (tools have already mutated it by
 * the time a tool-result part arrives).
 */
export async function* toReplanEvents(
  result: StreamLike,
  session: WeekSession,
): AsyncGenerator<ReplanEvent> {
  let streamed = ''
  for await (const part of result.fullStream) {
    if (part.type === 'text-delta' && part.text) {
      streamed += part.text
      yield { type: 'text', delta: part.text }
    } else if (part.type === 'tool-result') {
      yield { type: 'week', week: session.getWeek() }
    }
  }
  const message = (await result.text).trim() || streamed.trim() || DEFAULT_DONE
  yield { type: 'done', message, changed: session.hasChanged() }
}

/** The non-streaming result shape (voice): final message + week + change flag. */
export interface ReplanRunResult {
  message: string
  week: PlannedWeek
  changed: boolean
}

/** Finalise a non-streaming run: pick the message and read the session's week. */
export function finalizeReplan(
  text: string,
  session: WeekSession,
): ReplanRunResult {
  return {
    message: text.trim() || DEFAULT_DONE,
    week: session.getWeek(),
    changed: session.hasChanged(),
  }
}
