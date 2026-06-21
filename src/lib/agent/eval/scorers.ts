import type { EvalScorer } from 'braintrust'
import type { PlannedWeek } from '../../planner/types'
import { getFixture, substringMatcher } from './fixtures'
import type {
  ReplanEvalExpected,
  ReplanEvalInput,
  ReplanEvalMetadata,
  ReplanEvalOutput,
} from './types'

type Scorer = EvalScorer<
  ReplanEvalInput,
  ReplanEvalOutput,
  ReplanEvalExpected,
  ReplanEvalMetadata
>

function score(name: string, ok: boolean, reason?: string) {
  return {
    name,
    score: ok ? 1 : 0,
    ...(reason ? { metadata: { reason } } : {}),
  }
}

function filledRefs(week: PlannedWeek): Array<string> {
  return week.days.map((d) => d.recipeRef).filter((r) => r.length > 0)
}

function dayRef(week: PlannedWeek, day: string): string {
  return week.days.find((d) => d.day === day)?.recipeRef ?? ''
}

function countTermInWeek(
  week: PlannedWeek,
  term: string,
  recipes: ReturnType<typeof getFixture>['recipes'],
): number {
  const matches = substringMatcher(term)
  const byRef = new Map(recipes.map((r) => [r.id, r]))
  return week.days.filter((d) => {
    const r = d.recipeRef ? byRef.get(d.recipeRef) : undefined
    return r ? matches(r) : false
  }).length
}

const DECLINE_MARKERS = [
  "can't",
  "couldn't",
  "don't have",
  'nothing changed',
  'nothing with',
  'not enough',
  'not sure what',
  'already as quick',
  'already ',
  'no other option',
  'no dinners to',
]

function looksLikeDecline(message: string): boolean {
  const m = message.toLowerCase()
  return DECLINE_MARKERS.some((p) => m.includes(p))
}

/** Every recipeRef must exist in the fixture catalogue (hard rule). */
export const groundedRecipes: Scorer = ({ input, output }) => {
  const fixture = getFixture(input.fixtureId)
  const ids = new Set(fixture.recipes.map((r) => r.id))
  const bad = output.week.days.filter(
    (d) => d.recipeRef && !ids.has(d.recipeRef),
  )
  return score(
    'grounded_recipes',
    bad.length === 0,
    bad.length
      ? `Unknown refs: ${bad.map((d) => d.recipeRef).join(', ')}`
      : undefined,
  )
}

/** No duplicate dinners in the same week. */
export const noDuplicateRecipes: Scorer = ({ output }) => {
  const refs = filledRefs(output.week)
  const unique = new Set(refs)
  return score(
    'no_duplicate_recipes',
    unique.size === refs.length,
    unique.size !== refs.length ? `Duplicate refs in week` : undefined,
  )
}

/** Optional expected.changed flag. */
export const weekChanged: Scorer = ({ expected, output }) => {
  if (expected.changed === undefined) return score('week_changed', true)
  return score(
    'week_changed',
    output.changed === expected.changed,
    `expected changed=${expected.changed}, got ${output.changed}`,
  )
}

/** Required tool names must appear at least once. */
export const toolsCalled: Scorer = ({ expected, output }) => {
  if (!expected.mustCallTools?.length) return score('tools_called', true)
  const names = new Set(output.toolCalls.map((t) => t.name))
  const missing = expected.mustCallTools.filter((t) => !names.has(t))
  return score(
    'tools_called',
    missing.length === 0,
    missing.length ? `Missing tools: ${missing.join(', ')}` : undefined,
  )
}

/** Required tools must appear in order (subsequence of full call list). */
export const toolsOrder: Scorer = ({ expected, output }) => {
  if (!expected.mustCallToolsInOrder?.length) return score('tools_order', true)
  const seq = output.toolCalls.map((t) => t.name)
  let i = 0
  for (const name of seq) {
    if (name === expected.mustCallToolsInOrder[i]) i++
    if (i === expected.mustCallToolsInOrder.length) break
  }
  const ok = i === expected.mustCallToolsInOrder.length
  return score(
    'tools_order',
    ok,
    ok
      ? undefined
      : `Expected order ${expected.mustCallToolsInOrder.join(' → ')}, got ${seq.join(' → ')}`,
  )
}

/** Forbidden tools must not appear. */
export const forbiddenTools: Scorer = ({ expected, output }) => {
  if (!expected.forbiddenTools?.length) return score('forbidden_tools', true)
  const names = new Set(output.toolCalls.map((t) => t.name))
  const hit = expected.forbiddenTools.filter((t) => names.has(t))
  return score(
    'forbidden_tools',
    hit.length === 0,
    hit.length ? `Forbidden tools used: ${hit.join(', ')}` : undefined,
  )
}

/** Cleared days must end with empty recipeRef. */
export const daysCleared: Scorer = ({ expected, output }) => {
  if (!expected.clearedDays?.length) return score('days_cleared', true)
  const bad = expected.clearedDays.filter(
    (day) => dayRef(output.week, day) !== '',
  )
  return score(
    'days_cleared',
    bad.length === 0,
    bad.length ? `Still filled: ${bad.join(', ')}` : undefined,
  )
}

/** Swapped days must differ from the fixture's initial week. */
export const daysSwapped: Scorer = ({ input, expected, metadata, output }) => {
  if (!expected.swappedDays?.length) return score('days_swapped', true)
  const initial = metadata.initialWeek ?? getFixture(input.fixtureId).week
  const bad = expected.swappedDays.filter(
    (day) => dayRef(output.week, day) === dayRef(initial, day),
  )
  return score(
    'days_swapped',
    bad.length === 0,
    bad.length ? `Unchanged: ${bad.join(', ')}` : undefined,
  )
}

/** Message should include expected substrings (case-insensitive). */
export const messageIncludes: Scorer = ({ expected, output }) => {
  if (!expected.messageIncludes?.length) return score('message_includes', true)
  const m = output.message.toLowerCase()
  const missing = expected.messageIncludes.filter(
    (s) => !m.includes(s.toLowerCase()),
  )
  return score(
    'message_includes',
    missing.length === 0,
    missing.length ? `Missing phrases: ${missing.join(', ')}` : undefined,
  )
}

/** When expected, the agent should honestly decline (no matcher, no alternatives). */
export const honestDecline: Scorer = ({ expected, output }) => {
  if (!expected.messageDeclines) return score('honest_decline', true)
  const declined = !output.changed && looksLikeDecline(output.message)
  return score(
    'honest_decline',
    declined,
    declined ? undefined : 'Expected a decline message with no week change',
  )
}

/** After exclude, no recipe in the week should match the term. */
export const termAbsent: Scorer = ({ input, expected, output }) => {
  if (!expected.noTermInWeek) return score('term_absent', true)
  const fixture = getFixture(input.fixtureId)
  if (!fixture.withMatcher) return score('term_absent', true)
  const count = countTermInWeek(
    output.week,
    expected.noTermInWeek,
    fixture.recipes,
  )
  return score(
    'term_absent',
    count === 0,
    count
      ? `Still ${count} day(s) matching "${expected.noTermInWeek}"`
      : undefined,
  )
}

/** After lean-more, minimum dinners should match the term. */
export const termMinCount: Scorer = ({ input, expected, output }) => {
  if (!expected.minTermCount) return score('term_min_count', true)
  const fixture = getFixture(input.fixtureId)
  const count = countTermInWeek(
    output.week,
    expected.minTermCount.term,
    fixture.recipes,
  )
  const ok = count >= expected.minTermCount.min
  return score(
    'term_min_count',
    ok,
    ok
      ? undefined
      : `Expected ≥${expected.minTermCount.min} "${expected.minTermCount.term}", got ${count}`,
  )
}

/** Final message must not cite catalogue recipe titles (anti-hallucination). */
export const noRecipeNamesInMessage: Scorer = ({ input, output }) => {
  const readOnly =
    output.toolCalls.length > 0 &&
    output.toolCalls.every((t) => t.name === 'get_week')
  if (readOnly) return score('no_recipe_names_in_message', true)

  const fixture = getFixture(input.fixtureId)
  const msg = output.message.toLowerCase()
  const cited = fixture.recipes.filter(
    (r) => r.title.length >= 10 && msg.includes(r.title.toLowerCase()),
  )
  return score(
    'no_recipe_names_in_message',
    cited.length === 0,
    cited.length
      ? `Cited titles: ${cited.map((r) => r.title).join('; ')}`
      : undefined,
  )
}

/** Vegetarian profile: every filled day must be vegetarian-tagged. */
export const dietRespected: Scorer = ({ input, output }) => {
  const fixture = getFixture(input.fixtureId)
  if (fixture.profile.diet !== 'vegetarian')
    return score('diet_respected', true)
  const byRef = new Map(fixture.recipes.map((r) => [r.id, r]))
  const bad = output.week.days.filter((d) => {
    if (!d.recipeRef) return false
    const r = byRef.get(d.recipeRef)
    return r ? !r.dietaryTags.includes('vegetarian') : true
  })
  return score(
    'diet_respected',
    bad.length === 0,
    bad.length ? `Non-veg on: ${bad.map((d) => d.day).join(', ')}` : undefined,
  )
}

/** Tool args must never contain recipe ids or titles (schema + runtime). */
export const toolArgsAreConstraints: Scorer = ({ output }) => {
  const forbidden = /recipe|meal|title|dish/i
  for (const call of output.toolCalls) {
    const json = JSON.stringify(call.args).toLowerCase()
    if (forbidden.test(json) && !/day_type|busy|home|out/.test(json)) {
      return score(
        'tool_args_are_constraints',
        false,
        `Tool ${call.name} args look recipe-like: ${json}`,
      )
    }
  }
  return score('tool_args_are_constraints', true)
}

export const replanScorers: Array<Scorer> = [
  groundedRecipes,
  noDuplicateRecipes,
  weekChanged,
  toolsCalled,
  toolsOrder,
  forbiddenTools,
  daysCleared,
  daysSwapped,
  messageIncludes,
  honestDecline,
  termAbsent,
  termMinCount,
  noRecipeNamesInMessage,
  dietRespected,
  toolArgsAreConstraints,
]

/** Run scorers locally (vitest / dry-run) without Braintrust. */
export async function scoreReplanOutput(args: {
  input: ReplanEvalInput
  output: ReplanEvalOutput
  expected: ReplanEvalExpected
  metadata: ReplanEvalMetadata
}): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  for (const scorer of replanScorers) {
    const result = await scorer({
      input: args.input,
      output: args.output,
      expected: args.expected,
      metadata: args.metadata,
    })
    const items = Array.isArray(result) ? result : [result]
    for (const item of items) {
      if (item == null || typeof item === 'number') continue
      out[item.name] = item.score ?? 0
    }
  }
  return out
}
