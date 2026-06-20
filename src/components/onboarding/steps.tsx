import { useOnboardingForm } from './form-state'

/**
 * Step registry — the ordered list of screens the stepped flow renders after the
 * intro carousel. Sibling slices (#106-#109) fill in the stub bodies below; the
 * shell (OnboardingFlow) just walks this array. To add a step, write a component
 * that reads/patches the draft via useOnboardingForm and add an entry to STEPS.
 *
 * `canAdvance` (optional) gates the bottom 'Next' CTA from the current draft. A
 * step with no `canAdvance` is always advanceable (the stubs are, so the flow is
 * navigable end-to-end today).
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

/**
 * StepStub — a placeholder body the sibling slices replace. It renders the
 * step's intent so the flow is walkable now and shows reviewers what plugs in
 * where. Not a real form; #106-#109 swap these for the actual inputs.
 */
function StepStub({ note }: { note: string }) {
  // Touch the form context so the wiring is exercised end-to-end even in stubs.
  useOnboardingForm()
  return (
    <div className="border-border bg-card text-muted-foreground rounded-[var(--radius-ios)] border border-dashed p-6 text-sm">
      <p className="text-foreground mb-1 font-semibold">
        Coming in a follow-up
      </p>
      <p>{note}</p>
    </div>
  )
}

export const STEPS: Array<OnboardingStep> = [
  {
    id: 'household',
    title: 'Who is eating?',
    subtitle: 'Adults, children and any pets — this sizes your portions.',
    Component: () => (
      <StepStub note="Household: adults / children (+ ages) / cats + dogs steppers. Slice #106." />
    ),
  },
  {
    id: 'dislikes',
    title: 'Anything to avoid?',
    subtitle: 'Ingredients you would rather never see. A hard filter.',
    Component: () => (
      <StepStub note="Dislikes: ingredient pills + 'search an ingredient'. Slice #107." />
    ),
  },
  {
    id: 'diet',
    title: 'Your tastes',
    subtitle: 'Dietary restrictions we should always honour.',
    Component: () => (
      <StepStub note="Diet: Dairy free / Gluten free / Porkless / Vegan / Vegetarian / Pescatarian. Slice #107." />
    ),
  },
  {
    id: 'kitchen',
    title: 'Your kitchen',
    subtitle: 'What can you cook with? Keeps recipes feasible.',
    Component: () => (
      <StepStub note="Kitchen: Oven / Microwave / Stovetop / Blender / Multi cooker / Air fryer. Slice #108." />
    ),
  },
  {
    id: 'goals',
    title: 'Your goals',
    subtitle: 'What matters most? We weight the week toward it.',
    Component: () => (
      <StepStub note="Goals: Eat balanced / Pay less / Lighten mental load / Discover recipes / Avoid waste / Eat less meat. Slice #108." />
    ),
  },
  {
    id: 'store',
    title: 'Where do you shop?',
    subtitle: 'We build a ready-to-order basket here.',
    Component: () => (
      <StepStub note="Store: Albert Heijn / Jumbo / Picnic (Picnic tap = 'Coming soon, if we can convince the CTO'). Slice #109." />
    ),
  },
]
