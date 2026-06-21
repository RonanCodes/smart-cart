import { describe, expect, it } from 'vitest'
import { generateText } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'
import { generateWeek } from '../planner/planner'
import type { PlannerRecipe, PlannerSwipe } from '../planner/types'
import { buildReplanTools } from './tools'
import { finalizeReplan, replanAgentArgs, toReplanEvents } from './runner'
import { WeekSession } from './week-session'

function catalogue(): Array<PlannerRecipe> {
  const out: Array<PlannerRecipe> = []
  let id = 0
  for (const cuisine of ['Italian', 'Thai', 'Mexican', 'Japanese']) {
    for (let i = 0; i < 20; i++) {
      out.push({
        id: `r${id++}`,
        title: `${cuisine} dish ${i}`,
        cuisine,
        category: 'Main',
        mealType: 'dinner',
        dietaryTags: [],
        ingredients: [{ name: 'chicken' }, { name: 'onion' }],
        calories: 500,
        protein: 25,
        prepMinutes: 10 + (i % 5) * 10,
      })
    }
  }
  return out
}

const swipes: Array<PlannerSwipe> = [{ recipeId: 'r0', like: true }]
const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
}

function makeSession() {
  const recipes = catalogue()
  return {
    recipes,
    session: new WeekSession({
      week: generateWeek(recipes, {}, swipes, { seed: 7 }),
      recipes,
      profile: {},
      swipes,
      seed: 7,
    }),
  }
}

/** A two-step mock: one tool call, then a closing line. */
function toolThenText(toolName: string, input: unknown, text: string) {
  let call = 0
  return new MockLanguageModelV3({
    doGenerate: async () => {
      call++
      if (call === 1) {
        return {
          finishReason: 'tool-calls',
          usage,
          warnings: [],
          content: [
            {
              type: 'tool-call',
              toolCallId: 't1',
              toolName,
              input: JSON.stringify(input),
            },
          ],
        } as never
      }
      return {
        finishReason: 'stop',
        usage,
        warnings: [],
        content: [{ type: 'text', text }],
      } as never
    },
  })
}

describe('replan agent runner (mock model)', () => {
  it('runs the tool loop and the planner-grounded session edits the week (voice path)', async () => {
    const { recipes, session } = makeSession()
    const model = toolThenText(
      'skip_day',
      { days: ['Wednesday'] },
      'Cleared Wednesday for you.',
    )
    const { text } = await generateText(
      replanAgentArgs({
        session,
        profile: {},
        recipes,
        instruction: "we're eating out Wednesday",
        model,
      }),
    )
    const res = finalizeReplan(text, session)
    expect(res.changed).toBe(true)
    expect(res.message).toContain('Wednesday')
    expect(res.week.days.find((d) => d.day === 'Wednesday')!.recipeRef).toBe('')
  })

  it('toReplanEvents streams text, a live week after each tool, and a final done', async () => {
    const { session } = makeSession()
    // Stand in for a streamText result: text deltas around a tool-result, and the
    // tool mutation happening (as it would mid-loop) right before the tool-result
    // part. The session is the source of truth for the week the event carries.
    const fullStream = (async function* () {
      yield { type: 'text-delta', text: 'Clearing ' }
      session.skipDays(['Friday'])
      yield { type: 'tool-result' }
      yield { type: 'text-delta', text: 'Friday.' }
    })()
    const result = { fullStream, text: Promise.resolve('Clearing Friday.') }

    const events = []
    for await (const e of toReplanEvents(result, session)) events.push(e)

    const kinds = events.map((e) => e.type)
    expect(kinds).toContain('text')
    expect(kinds).toContain('week')
    const streamedWeek = events.flatMap((e) =>
      e.type === 'week' ? [e.week] : [],
    )[0]
    expect(streamedWeek?.days.find((d) => d.day === 'Friday')!.recipeRef).toBe(
      '',
    )
    const done = events.find((e) => e.type === 'done')
    expect(done?.type).toBe('done')
    if (done?.type === 'done') {
      expect(done.changed).toBe(true)
      expect(done.message).toContain('Friday')
    }
  })
})

describe('no-recipe-naming invariant', () => {
  it('no tool accepts a recipe id or title; tools only take constraints', () => {
    const { session } = makeSession()
    const tools = buildReplanTools(session)
    const allowedKeys = new Set(['days', 'term', 'day', 'type'])
    for (const [name, t] of Object.entries(tools)) {
      const schema = t.inputSchema as {
        shape?: Record<string, unknown>
      }
      const keys = Object.keys(schema.shape ?? {})
      for (const k of keys) {
        expect(
          allowedKeys.has(k),
          `tool "${name}" exposes key "${k}" — tools must only take constraints, never a recipe`,
        ).toBe(true)
      }
      // Belt-and-braces: no constraint key hints at a recipe/meal/dish.
      for (const k of keys) {
        expect(/recipe|meal|dish|title/i.test(k)).toBe(false)
      }
    }
  })
})
