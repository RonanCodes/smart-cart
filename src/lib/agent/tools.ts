import { tool } from 'ai'
import { z } from 'zod'
import type { WeekSession } from './week-session'

/**
 * The replan agent's tool surface.
 *
 * Every tool takes a CONSTRAINT (which days, what term, what day type) and returns
 * a short spoken summary. None of them accepts or returns a recipe id or title:
 * the model never names a dish. The real recipe is always picked by the planner
 * core inside the `WeekSession`, so a wrong tool call can at worst replan the wrong
 * day, never invent food (CONTEXT.md hard rule: no hallucinated recipes).
 *
 * The registry shape (a plain object of named tools bound to a session) leaves room
 * to grow into the full Souso assistant later (add_items, generate_cart) without
 * touching the runner.
 */

const DAY = z.enum([
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
])

const DAY_TYPE = z.enum(['home', 'busy', 'out'])

export function buildReplanTools(session: WeekSession) {
  return {
    get_week: tool({
      description:
        'Read the current week back: each day and its dinner (or that it is an eating-out day). Use this before editing if you are unsure what is planned.',
      inputSchema: z.object({}),
      execute: async () => session.describe(),
    }),

    skip_day: tool({
      description:
        'Clear one or more days because the household is eating out or away. The days are left empty.',
      inputSchema: z.object({
        days: z.array(DAY).min(1).describe('Weekday names to clear.'),
      }),
      execute: async ({ days }) => session.skipDays(days).summary,
    }),

    swap_day: tool({
      description:
        "Replace a day's dinner with the next-best pick by the household's preference. Use when they dislike a specific day's meal or want something different. With no day, swaps the day in focus.",
      inputSchema: z.object({
        days: z
          .array(DAY)
          .default([])
          .describe('Weekday names to swap; empty for the focused/last day.'),
      }),
      execute: async ({ days }) => session.swapDays(days).summary,
    }),

    exclude: tool({
      description:
        'Remove an ingredient or cuisine from the week and refill the affected days (e.g. "no fish", "lay off the spicy stuff"). Pass a single lowercase food or cuisine term.',
      inputSchema: z.object({
        term: z
          .string()
          .min(1)
          .describe('A single food or cuisine to avoid, lowercase.'),
      }),
      execute: async ({ term }) => (await session.exclude(term)).summary,
    }),

    lean_more: tool({
      description:
        'Favour more of an ingredient or cuisine in the week ("more pasta", "more veggies"). Pass a single lowercase food or cuisine term.',
      inputSchema: z.object({
        term: z
          .string()
          .min(1)
          .describe('A single food or cuisine to favour, lowercase.'),
      }),
      execute: async ({ term }) => (await session.leanMore(term)).summary,
    }),

    make_quicker: tool({
      description:
        'Replace dinners with quicker ones (short prep time). Use for "something faster", "we are busy this week". With no day, applies to the whole week.',
      inputSchema: z.object({
        days: z
          .array(DAY)
          .default([])
          .describe('Weekday names to speed up; empty for the whole week.'),
      }),
      execute: async ({ days }) => session.makeQuicker(days).summary,
    }),

    set_day_type: tool({
      description:
        "Set a day's type: 'out' to clear it, 'busy' to require a quick dinner, 'home' for a normal dinner (filling it if empty).",
      inputSchema: z.object({
        day: DAY,
        type: DAY_TYPE,
      }),
      execute: async ({ day, type }) => session.setDayType(day, type).summary,
    }),

    add_meal: tool({
      description:
        'Add a dinner to an empty day (one that was eating-out or cleared). Picks the top dinner that fits the household and the day.',
      inputSchema: z.object({ day: DAY }),
      execute: async ({ day }) => session.addMeal(day).summary,
    }),

    regenerate_week: tool({
      description:
        'Start over with a fresh week of dinners, keeping each day type. Use for "start over" or "give me a totally new week".',
      inputSchema: z.object({}),
      execute: async () => session.regenerate().summary,
    }),
  }
}

export type ReplanTools = ReturnType<typeof buildReplanTools>
