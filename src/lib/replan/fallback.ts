import { z } from 'zod'
import type { LanguageModel } from 'ai'
import type { ReplanEdit } from './types'

/**
 * AI-SDK fallback for instructions the deterministic parser cannot read.
 *
 * The contract is deliberately tiny: the model fills the SAME `ReplanEdit` shape
 * the parser emits, nothing more. It picks an intent type, the days it touches,
 * and (for exclude / more-of) a single food or cuisine term. It NEVER returns a
 * recipe, a meal, or a title. The planner picks real recipes from the catalogue;
 * the model only emits constraints. A wrong model answer can at worst replan the
 * wrong day, never invent food.
 *
 * Shippable without a live API key:
 *  - The Zod schema + the prompt builder are pure and unit tested.
 *  - The live call is gated: `runAiFallback` only hits the network when given a
 *    model. With no model (no binding / no key) it returns an `unknown` edit, so
 *    the engine degrades to a clear "can't do that yet" instead of throwing.
 *  - Tests inject a stub `generateObject` (or a stub model) so the fallback path
 *    is fully covered offline.
 */

const DAY_ENUM = z.enum([
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
])

/**
 * The structured-output schema. Mirrors `ReplanEdit` minus the free-text `reason`
 * (we synthesize that locally so the model spends no tokens on prose). The model
 * cannot return 'unknown' or 'needs-pricing' usefully, but we allow 'unknown' so
 * it can decline cleanly.
 */
export const replanEditSchema = z.object({
  type: z.enum(['skip-day', 'swap-day', 'exclude', 'more-of', 'unknown']),
  days: z.array(DAY_ENUM).default([]),
  term: z.string().nullable().default(null),
  termKind: z.enum(['cuisine', 'ingredient']).nullable().default(null),
})

export type ReplanEditSchema = z.infer<typeof replanEditSchema>

const SYSTEM_PROMPT = `You translate a household's plain-language instruction about their weekly dinner plan into a structured edit. You NEVER suggest, name, or invent recipes or meals. You only emit a constraint: an intent type, the days it touches, and at most one food or cuisine term.

Intent types:
- "skip-day": the user is eating out / away / wants a day empty. Set "days".
- "swap-day": the user dislikes a day's meal and wants a different one. Set "days" if a day is named.
- "exclude": the user does not want an ingredient or cuisine this week (e.g. "no shellfish", "lay off the spicy stuff"). Set "term" and "termKind".
- "more-of": the user wants more of a cuisine or ingredient. Set "term" and "termKind".
- "unknown": you cannot map the instruction to any of the above. Decline.

Rules:
- "term" is a single lowercase food or cuisine word, or null.
- "termKind" is "cuisine" for a cuisine ("italian", "thai"), "ingredient" for a food ("salmon", "pork"), or null.
- Only fill "days" with the exact weekday names mentioned.
- If you are unsure, return type "unknown". Never guess a recipe.`

/** Build the user prompt for a given instruction. Pure, for testability. */
export function buildFallbackPrompt(instruction: string): {
  system: string
  prompt: string
} {
  return {
    system: SYSTEM_PROMPT,
    prompt: `Instruction: ${instruction.trim()}`,
  }
}

/** Turn the model's raw object into a full `ReplanEdit` (adds the local reason). */
export function toReplanEdit(obj: ReplanEditSchema): ReplanEdit {
  const reason = (() => {
    switch (obj.type) {
      case 'skip-day':
        return obj.days.length
          ? `Clearing ${obj.days.join(', ')}.`
          : 'Clearing a day.'
      case 'swap-day':
        return obj.days.length
          ? `Swapping ${obj.days.join(', ')} for the next-best pick.`
          : 'Swapping for the next-best pick.'
      case 'exclude':
        return obj.term
          ? `Excluding ${obj.term} from the week.`
          : 'Excluding an item.'
      case 'more-of':
        return obj.term
          ? `Biasing the week toward ${obj.term}.`
          : 'Adding more of something.'
      case 'unknown':
      default:
        return "I couldn't work out what to change."
    }
  })()
  return {
    type: obj.type,
    days: obj.days,
    term: obj.term ? obj.term.toLowerCase().trim() : null,
    termKind: obj.termKind,
    reason,
  }
}

/**
 * The shape of the `ai` SDK's `generateObject` we depend on. Declaring it lets a
 * test inject a stub without pulling the real provider, and keeps the live import
 * lazy (the model only loads inside the Worker).
 */
export type GenerateObjectFn = (args: {
  model: LanguageModel
  schema: typeof replanEditSchema
  system: string
  prompt: string
}) => Promise<{ object: ReplanEditSchema }>

export interface AiFallbackDeps {
  /** The language model to call. When absent, the fallback declines offline. */
  model?: LanguageModel | null
  /**
   * The `generateObject` implementation. Defaults to the real one (lazy-imported
   * inside the Worker). Tests pass a stub so no network is touched.
   */
  generateObject?: GenerateObjectFn
}

/**
 * Run the AI fallback for an instruction. Returns a `ReplanEdit`.
 *
 * - No model (no binding / key): returns an `unknown` edit. The caller turns this
 *   into a clean "can't do that yet" message. This is the offline-shippable path.
 * - With a model: calls `generateObject` against the constrained schema and maps
 *   the result. Any error is caught and degraded to `unknown` so a flaky model
 *   can never crash a replan.
 */
export async function runAiFallback(
  instruction: string,
  deps: AiFallbackDeps,
): Promise<ReplanEdit> {
  const unknownEdit: ReplanEdit = {
    type: 'unknown',
    days: [],
    term: null,
    termKind: null,
    reason: "I couldn't work out what to change.",
  }

  if (!deps.model) return unknownEdit

  const { system, prompt } = buildFallbackPrompt(instruction)
  try {
    const gen = deps.generateObject ?? (await loadGenerateObject())
    const { object } = await gen({
      model: deps.model,
      schema: replanEditSchema,
      system,
      prompt,
    })
    return toReplanEdit(replanEditSchema.parse(object))
  } catch {
    return unknownEdit
  }
}

/** Lazy-load the real `generateObject` so it never enters a non-Worker bundle. */
async function loadGenerateObject(): Promise<GenerateObjectFn> {
  const { generateObject } = await import('ai')
  return generateObject
}
