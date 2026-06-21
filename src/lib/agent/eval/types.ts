import type {
  PlannedWeek,
  PlannerProfile,
  PlannerRecipe,
  PlannerSwipe,
} from '../../planner/types'

/** A deterministic, stubbed household + catalogue for one eval row. */
export interface ReplanFixture {
  id: string
  description: string
  recipes: Array<PlannerRecipe>
  profile: PlannerProfile
  swipes: Array<PlannerSwipe>
  week: PlannedWeek
  seed?: number
  /** When false, exclude / lean-more decline (no embedding matcher). */
  withMatcher: boolean
  tags: Array<string>
}

/** What the eval task receives. */
export interface ReplanEvalInput {
  instruction: string
  fixtureId: string
}

/** What the agent run produced. */
export interface ReplanEvalOutput {
  message: string
  week: PlannedWeek
  changed: boolean
  toolCalls: Array<{ name: string; args: unknown }>
}

/**
 * Ground-truth expectations for code scorers. Most fields are optional; only
 * specify what the case is testing so unrelated dimensions do not fail it.
 */
export interface ReplanEvalExpected {
  /** Whether the week should have moved at all. */
  changed?: boolean
  /** Tool names that must appear at least once (any order). */
  mustCallTools?: Array<string>
  /** Tool names in exact call order (subset of full sequence). */
  mustCallToolsInOrder?: Array<string>
  /** Tool names that must not appear. */
  forbiddenTools?: Array<string>
  /** Day labels that must end empty (eating out). */
  clearedDays?: Array<string>
  /** Day labels whose recipeRef must differ from the fixture's initial week. */
  swappedDays?: Array<string>
  /** Substrings the final message should mention (lowercased match). */
  messageIncludes?: Array<string>
  /** When true, the message should read as a decline (pricing, no matcher, etc.). */
  messageDeclines?: boolean
  /**
   * After the run, no recipe in the week should match this term (uses the same
   * substring stand-in as the fixture matcher when withMatcher is true).
   */
  noTermInWeek?: string
  /** Minimum dinners matching `term` after a lean-more intent. */
  minTermCount?: { term: string; min: number }
  /** All recipeRefs must exist in the fixture catalogue (always scored too). */
  grounded?: true
  /** No duplicate recipeRefs in filled days (always scored too). */
  noDuplicates?: true
}

/** Row metadata; run-task fills fixture + tool-call fields before scoring. */
export type ReplanEvalMetadata = {
  fixtureId?: string
  fixtureDescription?: string
  tags?: Array<string>
  toolCalls?: Array<{ name: string; args: unknown }>
  initialWeek?: PlannedWeek
  recipeIds?: Array<string>
}
