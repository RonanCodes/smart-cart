import { HouseholdStep } from './steps/household-step'
import { DislikesStep } from './steps/dislikes-step'
import { DietStep } from './steps/diet-step'
import { CuisineStep } from './steps/cuisine-step'
import { StoreStep } from './steps/store-step'
import { KitchenStep } from './steps/kitchen-step'
import { GoalsStep } from './steps/goals-step'

/**
 * Step registry — the ordered list of screens the stepped flow renders after the
 * intro carousel. The shell (OnboardingFlow) just walks this array. To add a
 * step, write a component that reads/patches the draft via useOnboardingForm and
 * add an entry to STEPS.
 *
 * `canAdvance` (optional) gates the bottom 'Next' CTA from the current draft. A
 * step with no `canAdvance` is always advanceable.
 */

import type { OnboardingDraft } from './form-state'

export interface OnboardingStep {
  /** Stable id, also used as the React key. */
  id: string
  /** Short heading shown above the step body. */
  title: string
  /** One-line helper under the heading. */
  subtitle?: string
  /** The step body. Reads + patches the draft through useOnboardingForm. */
  Component: () => React.ReactElement
  /** Optional gate on the 'Next' CTA. Defaults to always-advanceable. */
  canAdvance?: (draft: OnboardingDraft) => boolean
}

export const STEPS: Array<OnboardingStep> = [
  {
    id: 'household',
    title: 'Who is eating?',
    subtitle: 'Adults, children and any pets, so we can size your portions.',
    Component: HouseholdStep,
  },
  {
    id: 'dislikes',
    title: 'Dislikes',
    subtitle: 'Choose the ingredients you would like to avoid.',
    Component: DislikesStep,
  },
  {
    id: 'diet',
    title: 'Your tastes',
    subtitle: 'Any dietary restrictions?',
    Component: DietStep,
  },
  {
    id: 'cuisine',
    title: 'Cuisines you love',
    subtitle: 'One tap to like, tap again to dislike, once more to clear.',
    Component: CuisineStep,
  },
  {
    id: 'kitchen',
    title: 'Your kitchen',
    subtitle: 'Which kitchen appliances do you have?',
    Component: KitchenStep,
  },
  {
    id: 'goals',
    title: 'Your goals',
    subtitle: 'What matters most? We weight the week toward it.',
    Component: GoalsStep,
  },
  {
    id: 'store',
    title: 'Where do you shop?',
    subtitle: 'We build a ready-to-order basket here.',
    Component: StoreStep,
  },
]
