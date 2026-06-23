import {
  Salad,
  PiggyBank,
  ChefHat,
  ShoppingCart,
  Sprout,
  Drumstick,
  Timer,
  Feather,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

/**
 * The single source of truth for the onboarding "Your goals" options.
 *
 * Goals are a SOFT weighting, never a hard filter: picking one nudges the week
 * (e.g. "Eat less meat" biases toward fewer meat dinners). They are stored as
 * the label string verbatim on `household.profile.goals` (an `Array<string>`),
 * so adding an option here is all that is needed to capture a new goal end to
 * end. The planner reads the persisted labels; see `plannerHonorsGoals`.
 *
 * Shared so the onboarding GoalsStep and the Profile PreferencesSheet render an
 * identical list (they used to carry two hand-kept copies that could drift).
 */
export interface GoalOption {
  /** The label stored in `draft.goals` / `profile.goals` verbatim. */
  label: string
  icon: LucideIcon
}

export const GOAL_OPTIONS: ReadonlyArray<GoalOption> = [
  { label: 'Eat a more balanced diet', icon: Salad },
  { label: 'Pay less for my groceries', icon: PiggyBank },
  { label: 'Cook and discover new recipes', icon: ChefHat },
  { label: 'Avoid unnecessary purchases', icon: ShoppingCart },
  { label: 'Eat less meat', icon: Sprout },
  { label: 'More protein', icon: Drumstick },
  { label: 'Quick meals', icon: Timer },
  { label: 'Low-cal meals', icon: Feather },
]
