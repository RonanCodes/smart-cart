import { tool } from 'ai'
import { z } from 'zod'
import { MEMORY_KINDS } from '../memory/memory'
import type { MemorySource } from '../memory/memory'

/** Where a memory tool write is stamped as coming from (chat vs voice). */
export interface MemoryToolContext {
  householdId: string
  source: MemorySource
}

/**
 * The durable-memory tool surface, shared by the chat and voice agents.
 *
 * Kept in its own module (not `tools.ts`) so Braintrust offline evals for the
 * replan agent never pull `memory-server` → D1 → `cloudflare:workers` into the
 * bundle. The runner dynamically imports this module only when `memory` is wired.
 *
 * `recall_memory` grounds the assistant before it acts: it returns what we
 * remember about the household plus this/last week and recent feedback, so the
 * model can read a nuance like "not pizza every week" correctly (a variety wish,
 * not a ban). `remember` stores a structured fact the model has already
 * interpreted — the model decides the `kind`/`polarity`, no regex on our side.
 */
export function buildMemoryTools(ctx: MemoryToolContext) {
  return {
    recall_memory: tool({
      description:
        'Recall what we know about this household before acting: durable preferences and constraints, the current and previous week, and recent meal feedback. Call this first when a request depends on taste, variety, or history.',
      inputSchema: z.object({}),
      execute: async () => {
        const { buildMemoryContext } = await import('../memory/memory-server')
        const { text } = await buildMemoryContext(ctx.householdId)
        return text
      },
    }),

    remember: tool({
      description:
        'Save a durable fact about the household for future weeks. Interpret nuance yourself: "I don\'t want pizza every week" is a variety wish (kind="variety", cuisine="pizza"), NOT a dislike. A real dislike or allergy is kind="constraint" with polarity="dislike". Keep `content` a short first-person note.',
      inputSchema: z.object({
        content: z
          .string()
          .min(1)
          .describe("A short note in the household's words."),
        kind: z
          .enum(MEMORY_KINDS as unknown as [string, ...Array<string>])
          .describe(
            'preference (likes/wants), constraint (dislike/allergy/diet), variety (not too often), context (life facts), logistics (timing/budget).',
          ),
        cuisine: z
          .string()
          .nullish()
          .describe('A cuisine or dish this is about, lowercase, if any.'),
        term: z
          .string()
          .nullish()
          .describe('A single food/ingredient term this is about, if any.'),
        polarity: z
          .enum(['like', 'dislike', 'neutral'])
          .optional()
          .describe('Sentiment toward the subject. Default neutral.'),
        scope: z
          .enum(['persistent', 'week'])
          .optional()
          .describe('persistent (always) or week (just this week).'),
      }),
      execute: async (input) => {
        const { rememberFact } = await import('../memory/memory-server')
        const m = await rememberFact(ctx.householdId, {
          content: input.content,
          source: ctx.source,
          kind: input.kind as (typeof MEMORY_KINDS)[number],
          cuisine: input.cuisine ?? null,
          term: input.term ?? null,
          polarity: input.polarity,
          scope: input.scope,
        })
        return `Saved: "${m.content}".`
      },
    }),
  }
}

export type MemoryTools = ReturnType<typeof buildMemoryTools>
