import type { EvalCase } from 'braintrust'
import type {
  ReplanEvalExpected,
  ReplanEvalInput,
  ReplanEvalMetadata,
} from './types'

/**
 * Golden dataset for the replan agent eval.
 *
 * Each row is a stubbed household (fixture) + a natural-language instruction +
 * code-scored expectations. Cases are grouped by the weird edge we are probing:
 * compound intents, Dutch phrasing, honest declines when matcher is off, diet
 * hard-filters, no-op when a day is already empty, and anti-hallucination checks.
 */
export function replanDataset(): Array<
  EvalCase<ReplanEvalInput, ReplanEvalExpected, ReplanEvalMetadata>
> {
  return [
    // --- skip / eating out ---
    {
      input: {
        instruction: "we're eating out Wednesday",
        fixtureId: 'standard',
      },
      expected: {
        changed: true,
        mustCallTools: ['skip_day'],
        clearedDays: ['Wednesday'],
        messageIncludes: ['wednesday'],
      },
      metadata: { tags: ['skip', 'english'] },
    },
    {
      input: {
        instruction: 'woensdag eten we buiten',
        fixtureId: 'standard',
      },
      expected: {
        changed: true,
        mustCallTools: ['skip_day'],
        clearedDays: ['Wednesday'],
      },
      metadata: { tags: ['skip', 'dutch'] },
    },
    {
      input: {
        instruction: 'Wednesday is already eating out — leave it',
        fixtureId: 'wednesday-empty',
      },
      expected: {
        changed: false,
        forbiddenTools: ['regenerate_week'],
      },
      metadata: { tags: ['skip', 'no-op'] },
    },

    // --- swap ---
    {
      input: {
        instruction: "I don't like Monday's dinner, swap it",
        fixtureId: 'standard',
      },
      expected: {
        changed: true,
        mustCallTools: ['swap_day'],
        swappedDays: ['Monday'],
      },
      metadata: { tags: ['swap'] },
    },
    {
      input: {
        instruction: 'give me something else for Friday and Saturday',
        fixtureId: 'standard',
      },
      expected: {
        changed: true,
        mustCallTools: ['swap_day'],
        swappedDays: ['Friday', 'Saturday'],
      },
      metadata: { tags: ['swap', 'multi-day'] },
    },

    // --- exclude ---
    {
      input: {
        instruction: 'no fish this week',
        fixtureId: 'fish-heavy',
      },
      expected: {
        changed: true,
        mustCallTools: ['exclude'],
        noTermInWeek: 'fish',
      },
      metadata: { tags: ['exclude', 'fish'] },
    },
    {
      input: {
        instruction: 'geen vis',
        fixtureId: 'fish-heavy',
      },
      expected: {
        changed: true,
        mustCallTools: ['exclude'],
        noTermInWeek: 'fish',
      },
      metadata: { tags: ['exclude', 'dutch', 'fish'] },
    },
    {
      input: {
        instruction: 'no fish please',
        fixtureId: 'no-matcher',
      },
      expected: {
        changed: false,
        messageDeclines: true,
      },
      metadata: { tags: ['exclude', 'decline', 'offline'] },
    },

    // --- lean more ---
    {
      input: {
        instruction: 'meer rijst deze week',
        fixtureId: 'dutch-rice',
      },
      expected: {
        changed: true,
        mustCallTools: ['lean_more'],
        minTermCount: { term: 'rijst', min: 2 },
      },
      metadata: { tags: ['lean-more', 'dutch', 'rice'] },
    },
    {
      input: {
        instruction: 'more pasta',
        fixtureId: 'standard',
      },
      expected: {
        mustCallTools: ['lean_more'],
      },
      metadata: { tags: ['lean-more'] },
    },
    {
      input: {
        instruction: 'meer rijst',
        fixtureId: 'dutch-no-rice',
      },
      expected: {
        changed: false,
        messageDeclines: true,
      },
      metadata: { tags: ['lean-more', 'decline'] },
    },
    {
      input: {
        instruction: 'more rice please',
        fixtureId: 'vegetarian-rice',
      },
      expected: {
        changed: false,
        mustCallTools: ['lean_more'],
        messageDeclines: true,
      },
      metadata: { tags: ['lean-more', 'diet', 'vegetarian', 'decline'] },
    },

    // --- quicker / day type ---
    {
      input: {
        instruction: 'something faster this week',
        fixtureId: 'standard',
      },
      expected: {
        changed: true,
        mustCallTools: ['make_quicker'],
      },
      metadata: { tags: ['quicker'] },
    },
    {
      input: {
        instruction: 'Tuesday is a busy night — quick dinner only',
        fixtureId: 'standard',
      },
      expected: {
        changed: true,
        mustCallTools: ['set_day_type'],
      },
      metadata: { tags: ['day-type', 'busy'] },
    },

    // --- add meal / regenerate ---
    {
      input: {
        instruction: 'add a dinner back on Wednesday',
        fixtureId: 'wednesday-empty',
      },
      expected: {
        changed: true,
        mustCallTools: ['add_meal'],
      },
      metadata: { tags: ['add-meal'] },
    },
    {
      input: {
        instruction: 'start over — totally new week',
        fixtureId: 'standard',
      },
      expected: {
        mustCallTools: ['regenerate_week'],
      },
      metadata: { tags: ['regenerate', 'deterministic-seed'] },
    },

    // --- read-only / inspection ---
    {
      input: {
        instruction: "what's planned for Wednesday?",
        fixtureId: 'standard',
      },
      expected: {
        changed: false,
        mustCallTools: ['get_week'],
        forbiddenTools: ['regenerate_week', 'swap_day'],
      },
      metadata: { tags: ['read-only'] },
    },

    // --- compound weird cases ---
    {
      input: {
        instruction: 'eating out Friday and no fish for the rest of the week',
        fixtureId: 'fish-heavy',
      },
      expected: {
        changed: true,
        mustCallToolsInOrder: ['skip_day', 'exclude'],
        clearedDays: ['Friday'],
        noTermInWeek: 'fish',
      },
      metadata: { tags: ['compound', 'skip', 'exclude'] },
    },
    {
      input: {
        instruction: 'skip Saturday, lean more Thai, and make Sunday quicker',
        fixtureId: 'standard',
      },
      expected: {
        changed: true,
        mustCallTools: ['skip_day', 'lean_more', 'make_quicker'],
        clearedDays: ['Saturday'],
      },
      metadata: { tags: ['compound', 'multi-tool'] },
    },
    {
      input: {
        instruction: 'clear Monday for eating out then add a meal there again',
        fixtureId: 'standard',
      },
      expected: {
        mustCallToolsInOrder: ['skip_day', 'add_meal'],
      },
      metadata: { tags: ['compound', 'skip', 'add-meal'] },
    },
    {
      input: {
        instruction: 'swap Thursday and exclude spicy food',
        fixtureId: 'standard',
      },
      expected: {
        changed: true,
        mustCallTools: ['swap_day', 'exclude'],
        swappedDays: ['Thursday'],
      },
      metadata: { tags: ['compound', 'swap', 'exclude'] },
    },

    // --- ambiguous / adversarial phrasing ---
    {
      input: {
        instruction: 'not this one — pick something else (Monday)',
        fixtureId: 'standard',
      },
      expected: {
        changed: true,
        mustCallTools: ['swap_day'],
        swappedDays: ['Monday'],
      },
      metadata: { tags: ['ambiguous', 'swap'] },
    },
    {
      input: {
        instruction: 'make it healthier but do not rename specific dishes',
        fixtureId: 'standard',
      },
      expected: {
        forbiddenTools: ['regenerate_week'],
      },
      metadata: { tags: ['ambiguous', 'vague'] },
    },
  ]
}
