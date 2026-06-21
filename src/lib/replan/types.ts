import type { PlannerRecipe } from '../planner/types'

/**
 * The semantic term matcher used by the replan agent's exclude / lean-more tools
 * (ADR-0004).
 *
 * A matcher is true when a recipe matches a free term ("mushroom", "fish") by
 * embedding cosine over the term and the recipe's precomputed vector. It is built
 * once per term upstream (the term embedded once, every recipe scored), so the
 * predicate is pure and synchronous here. The maths lives in `term-match.ts`; this
 * is just the shared shape its builders return and the `WeekSession` consumes.
 */
export type TermMatcher = (recipe: PlannerRecipe) => boolean
