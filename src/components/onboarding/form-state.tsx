import * as React from 'react'

/**
 * Onboarding form state — the shared draft the whole Jow-style flow writes into.
 *
 * The form (not the swipe deck) is now the data source for the recommender. Each
 * step screen reads and patches one slice of this draft via `useOnboardingForm`;
 * the flow shell (OnboardingFlow) owns the reducer and the navigation. Final
 * persistence is wired separately (#110) — this context only holds the in-flight
 * answers and is deliberately decoupled from the server function.
 *
 * Shape mirrors household.profile + the household size columns so #110 can map it
 * across with no surprises.
 */

export interface OnboardingPets {
  cats: number
  dogs: number
}

export interface OnboardingDraft {
  /** Household size. Adults default to 2, the common case. */
  adults: number
  children: number
  /** Ages of the children, parallel-ish to `children` (sizes child portions). */
  childrenAges: Array<number>
  /** Pets, captured for portion / leftover sizing. */
  pets: OnboardingPets
  /** Ingredients to avoid — a hard filter on the recommender. */
  dislikes: Array<string>
  /** Dietary restriction labels (Dairy free, Gluten free, Vegan, ...). */
  diet: Array<string>
  /** Kitchen appliances the household has — gates recipe feasibility. */
  equipment: Array<string>
  /** Soft goals (Eat balanced, Pay less, ...) — a soft weighting. */
  goals: Array<string>
  /** Cuisines the household likes (Italian, Thai, ...) — biases the planner UP. */
  cuisinesLiked: Array<string>
  /** Cuisines the household hates — down-weighted (or filtered) by the planner. */
  cuisinesDisliked: Array<string>
  /** Preferred store: 'ah' | 'jumbo' | 'picnic'. */
  store: string | null
}

export const EMPTY_DRAFT: OnboardingDraft = {
  adults: 2,
  children: 0,
  childrenAges: [],
  pets: { cats: 0, dogs: 0 },
  dislikes: [],
  diet: [],
  equipment: [],
  goals: [],
  cuisinesLiked: [],
  cuisinesDisliked: [],
  store: null,
}

export type OnboardingAction = {
  type: 'patch'
  patch: Partial<OnboardingDraft>
}

export function onboardingReducer(
  state: OnboardingDraft,
  action: OnboardingAction,
): OnboardingDraft {
  // Single action today (shallow patch); a switch is overkill and trips the
  // exhaustiveness lint, so map the one case directly.
  return { ...state, ...action.patch }
}

interface OnboardingFormValue {
  draft: OnboardingDraft
  /** Shallow-merge a slice of the draft. The step screens call this. */
  patch: (patch: Partial<OnboardingDraft>) => void
}

const OnboardingFormContext = React.createContext<OnboardingFormValue | null>(
  null,
)

export function OnboardingFormProvider({
  value,
  children,
}: {
  value: OnboardingFormValue
  children: React.ReactNode
}) {
  return (
    <OnboardingFormContext.Provider value={value}>
      {children}
    </OnboardingFormContext.Provider>
  )
}

/** Read + patch the shared onboarding draft. Throws outside the provider. */
export function useOnboardingForm(): OnboardingFormValue {
  const ctx = React.useContext(OnboardingFormContext)
  if (!ctx) {
    throw new Error('useOnboardingForm must be used inside OnboardingFlow')
  }
  return ctx
}
