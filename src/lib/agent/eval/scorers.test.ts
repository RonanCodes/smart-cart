import { describe, expect, it } from 'vitest'
import { generateWeek } from '../../planner/planner'
import { getFixture } from './fixtures'
import { scoreReplanOutput } from './scorers'
import type { ReplanEvalOutput } from './types'

function mockOutput(
  fixtureId: string,
  patch: Partial<ReplanEvalOutput>,
): ReplanEvalOutput {
  const fixture = getFixture(fixtureId)
  return {
    message: 'Done.',
    week: fixture.week,
    changed: false,
    toolCalls: [],
    ...patch,
  }
}

describe('replan eval scorers (offline)', () => {
  it('flags ungrounded recipe refs', async () => {
    const fixture = getFixture('standard')
    const scores = await scoreReplanOutput({
      input: { instruction: 'x', fixtureId: 'standard' },
      output: mockOutput('standard', {
        week: {
          days: [
            { day: 'Monday', meal: 'Fake', recipeRef: 'not-in-catalogue' },
          ],
        },
      }),
      expected: {},
      metadata: { initialWeek: fixture.week },
    })
    expect(scores.grounded_recipes).toBe(0)
  })

  it('detects duplicate recipe refs', async () => {
    const fixture = getFixture('standard')
    const ref = fixture.week.days[0]!.recipeRef
    const scores = await scoreReplanOutput({
      input: { instruction: 'x', fixtureId: 'standard' },
      output: mockOutput('standard', {
        week: {
          days: [
            { day: 'Monday', meal: 'A', recipeRef: ref },
            { day: 'Tuesday', meal: 'B', recipeRef: ref },
          ],
        },
      }),
      expected: {},
      metadata: { initialWeek: fixture.week },
    })
    expect(scores.no_duplicate_recipes).toBe(0)
  })

  it('checks tool order as a subsequence', async () => {
    const scores = await scoreReplanOutput({
      input: { instruction: 'x', fixtureId: 'standard' },
      output: mockOutput('standard', {
        toolCalls: [
          { name: 'get_week', args: {} },
          { name: 'skip_day', args: { days: ['Friday'] } },
          { name: 'exclude', args: { term: 'fish' } },
        ],
        changed: true,
      }),
      expected: { mustCallToolsInOrder: ['skip_day', 'exclude'] },
      metadata: {},
    })
    expect(scores.tools_order).toBe(1)
  })

  it('scores fish absent after exclude expectation', async () => {
    const fixture = getFixture('fish-heavy')
    const nonFish = fixture.recipes.filter(
      (r) => !r.ingredients.some((i) => i.name.includes('salmon')),
    )
    const week = generateWeek(nonFish, fixture.profile, fixture.swipes, {
      seed: 7,
    })
    const scores = await scoreReplanOutput({
      input: { instruction: 'no fish', fixtureId: 'fish-heavy' },
      output: {
        message: 'Removed fish.',
        changed: true,
        toolCalls: [{ name: 'exclude', args: { term: 'fish' } }],
        week,
      },
      expected: { noTermInWeek: 'fish' },
      metadata: { initialWeek: fixture.week },
    })
    expect(scores.term_absent).toBe(1)
  })

  it('requires honest decline when matcher is off', async () => {
    const scores = await scoreReplanOutput({
      input: { instruction: 'no fish', fixtureId: 'no-matcher' },
      output: mockOutput('no-matcher', {
        message: "Can't filter out fish right now.",
        changed: false,
        toolCalls: [{ name: 'exclude', args: { term: 'fish' } }],
      }),
      expected: { messageDeclines: true, changed: false },
      metadata: {},
    })
    expect(scores.honest_decline).toBe(1)
    expect(scores.week_changed).toBe(1)
  })

  it('allows recipe titles when the agent only inspected the week', async () => {
    const fixture = getFixture('standard')
    const wed = fixture.week.days.find((d) => d.day === 'Wednesday')!
    const scores = await scoreReplanOutput({
      input: { instruction: "what's on Wednesday?", fixtureId: 'standard' },
      output: mockOutput('standard', {
        message: `Wednesday is planned as "${wed.meal}".`,
        changed: false,
        toolCalls: [{ name: 'get_week', args: {} }],
      }),
      expected: {},
      metadata: {},
    })
    expect(scores.no_recipe_names_in_message).toBe(1)
  })
})
