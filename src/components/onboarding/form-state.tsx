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

/** How a tester prefers to be reached for a feedback chat (#407). */
export type ContactPref = 'whatsapp' | 'call' | 'either'

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
  /** Recipe-content language: 'en' | 'nl'. Defaults to English (#310). */
  locale: 'en' | 'nl'
  /** Optional phone/WhatsApp, for beta testers happy to be reached out to for a
   * chat (#407). Never required; stored on the household profile. */
  phone: string | null
  /** Preferred way to be reached, when a phone is given (#407). */
  contactPref: ContactPref | null
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
  locale: 'en',
  phone: null,
  contactPref: null,
}

/**
 * sessionStorage key for the in-flight draft. The draft lives in the reducer
 * while the flow is mounted; this mirror is a belt-and-braces backup so an
 * accidental reload mid-flow (notably during the email/OTP step) does not lose
 * the answers. sessionStorage (not localStorage) so it is scoped to the tab and
 * cleared when the tab closes — a half-finished draft never leaks across visits.
 */
export const DRAFT_STORAGE_KEY = 'souso.onboarding.draft'

/**
 * Restore a draft saved by {@link saveDraft}, or null when there is none / it is
 * unreadable. Merges over EMPTY_DRAFT so a draft saved by an older shape still
 * loads (missing keys fall back to defaults). No-throw: storage can be disabled
 * (private mode) or hold garbage, neither of which must break onboarding.
 */
export function loadDraft(): OnboardingDraft | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.sessionStorage.getItem(DRAFT_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<OnboardingDraft>
    return { ...EMPTY_DRAFT, ...parsed }
  } catch {
    return null
  }
}

/** Mirror the draft to sessionStorage. No-throw (storage may be unavailable). */
export function saveDraft(draft: OnboardingDraft): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft))
  } catch {
    // Private mode / quota: the in-memory reducer is still the source of truth.
  }
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
