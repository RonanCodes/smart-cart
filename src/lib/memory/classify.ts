import { z } from 'zod'
import type { LanguageModel } from 'ai'
import type { MemoryDraft } from './memory'

/**
 * LLM classification of a free-text note into a structured memory draft.
 *
 * This is the ONLY place memory interpretation needs a dedicated model call,
 * because it is the only writer with no agent already in the loop: a post-meal
 * feedback NOTE ("not pizza every week") is typed by the household, not by an
 * agent. The chat and voice agents instead fill the structured fields themselves
 * when they call the `remember` tool, so they cost zero extra calls.
 *
 * Deliberately tiny + injectable (mirrors replan/fallback.ts): the schema + the
 * prompt are pure and unit-tested, and the live `generateObject` is injected so
 * tests run offline. With no model wired the classifier returns null and the
 * caller stores the note as plain neutral context — never a wrong dislike.
 */

export const memoryDraftSchema = z.object({
  kind: z.enum(['preference', 'constraint', 'variety', 'context', 'logistics']),
  cuisine: z
    .string()
    .nullable()
    .describe(
      'A single lowercase cuisine or dish type (italian, thai, pizza, pasta, …), or null when none is clearly the subject.',
    ),
  term: z
    .string()
    .nullable()
    .describe(
      'A single lowercase food/ingredient term (salmon, mushroom, peanut, …), or null when none is clearly the subject.',
    ),
  polarity: z.enum(['like', 'dislike', 'neutral']),
  scope: z.enum(['persistent', 'week']),
})

export type MemoryDraftSchema = z.infer<typeof memoryDraftSchema>

export const CLASSIFY_SYSTEM_PROMPT = `You convert a household's short note about their weekly dinners into a structured memory. Output ONLY the structured fields. Never invent recipes.

Choose "kind":
- "variety": a frequency wish — they want something LESS OFTEN, not removed. Examples: "not pizza every week", "we eat too much pasta", "mix it up more". polarity is "neutral" (they do NOT dislike it, they just want it less often).
- "constraint": an allergy, intolerance, or a hard "never". polarity is "dislike".
- "preference": a plain like or dislike of a food/cuisine. polarity is "like" or "dislike".
- "logistics": cooking time, kitchen equipment, or budget notes. polarity is "neutral".
- "context": anything else worth remembering (household, schedule, kids). polarity is "neutral".

Set "cuisine" to a single lowercase cuisine word (italian, thai, pizza, pasta, curry, ...) when one is clearly the subject, else null.
Set "term" to a single lowercase food/ingredient word (salmon, mushroom, peanut, ...) when one is clearly the subject, else null.
Set "scope" to "week" only if they clearly mean just this week; otherwise "persistent".

The classic trap: "not pizza every week" is "variety" with polarity "neutral" and cuisine "pizza" — it must NOT become a dislike or a ban.`

/** The shape of the AI SDK's `generateObject` this module depends on. */
export type GenerateObjectFn = (args: {
  model: LanguageModel
  schema: typeof memoryDraftSchema
  system: string
  prompt: string
}) => Promise<{ object: MemoryDraftSchema }>

export interface ClassifyDeps {
  /** The model to call. When absent, the classifier declines (returns null). */
  model?: LanguageModel | null
  /** The `generateObject` impl. Defaults to the real one (lazy, Worker-only). */
  generateObject?: GenerateObjectFn
}

/** Build the user prompt for a note. Pure, for testability. */
export function buildClassifyPrompt(note: string): {
  system: string
  prompt: string
} {
  return {
    system: CLASSIFY_SYSTEM_PROMPT,
    prompt: `Note: ${note.trim()}`,
  }
}

/** Map the model's raw object to a MemoryDraft (lowercasing the free terms). */
export function toMemoryDraft(obj: MemoryDraftSchema): MemoryDraft {
  return {
    kind: obj.kind,
    cuisine: obj.cuisine ? obj.cuisine.toLowerCase().trim() : null,
    term: obj.term ? obj.term.toLowerCase().trim() : null,
    polarity: obj.polarity,
    scope: obj.scope,
  }
}

/**
 * Classify one note into a memory draft, or null when no model is wired or the
 * call fails. A null result is the caller's signal to store the note as plain
 * neutral context rather than guess.
 */
export async function classifyNote(
  note: string,
  deps: ClassifyDeps,
): Promise<MemoryDraft | null> {
  const trimmed = note.trim()
  if (!trimmed || !deps.model) return null

  const { system, prompt } = buildClassifyPrompt(trimmed)
  try {
    const gen = deps.generateObject ?? (await loadGenerateObject())
    const { object } = await gen({
      model: deps.model,
      schema: memoryDraftSchema,
      system,
      prompt,
    })
    return toMemoryDraft(memoryDraftSchema.parse(object))
  } catch {
    return null
  }
}

/** Lazy-load the real `generateObject` so it never enters a non-Worker bundle. */
async function loadGenerateObject(): Promise<GenerateObjectFn> {
  const { generateObject } = await import('../braintrust-ai')
  return generateObject
}
