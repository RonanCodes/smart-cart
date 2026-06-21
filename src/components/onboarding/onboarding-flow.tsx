import * as React from 'react'
import { ChevronLeft } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { WelcomeBoard } from './welcome-board'
import { EmailStep } from './steps/email-step'
import { STEPS } from './steps'
import {
  DRAFT_STORAGE_KEY,
  EMPTY_DRAFT,
  OnboardingFormProvider,
  loadDraft,
  onboardingReducer,
  saveDraft,
} from './form-state'
import type { OnboardingDraft } from './form-state'
import { track, FUNNEL_EVENTS } from '#/lib/analytics'

/** Non-PII funnel properties derived from the in-flight draft (household size +
 * store). NO names/email — analytics stays PII-free (analytics.stripPii also
 * defends this). */
function draftFunnelProps(draft: OnboardingDraft) {
  return {
    householdSize: (draft.adults || 0) + (draft.children || 0),
    adults: draft.adults,
    children: draft.children,
    store: draft.store,
  }
}

/**
 * OnboardingFlow — the Jow-style form shell that replaces the swipe deck as the
 * onboarding entry. It owns:
 *   - the phase machine (intro carousel -> stepped form -> email/OTP),
 *   - the shared form-state reducer (the draft each step patches),
 *   - the chrome: a top progress bar, a back arrow, and a bottom 'Next' CTA.
 *
 * It renders one step at a time from the STEPS registry, so sibling slices add a
 * screen by appending to that array with no change here.
 *
 * EMAIL-LAST (TJ's design): a signed-out visitor runs the WHOLE form first, then
 * the terminal `auth` phase asks for their email and verifies a 6-digit code,
 * which CREATES + authenticates the account (Better Auth emailOTP open sign-up).
 * Only after auth succeeds does `onComplete` fire — the parent then persists the
 * household + builds the first week (the session cookie is now set). A signed-in
 * user redoing onboarding (`requireAuth={false}`) skips the email phase: the last
 * step's CTA fires `onComplete` directly.
 *
 * DRAFT SURVIVES AUTH: the draft lives in the reducer and never unmounts during
 * the email/OTP step (it is an in-place phase, no page navigation), so nothing is
 * lost. As a backup against an accidental reload mid-flow, the draft is mirrored
 * to sessionStorage and restored on mount, then cleared once onboarding completes.
 *
 * Mobile first at 390px. The parent route supplies the safe-area frame.
 */

type Phase = 'intro' | 'steps' | 'auth'

export function OnboardingFlow({
  onComplete,
  onSignIn,
  skipIntro = false,
  requireAuth = true,
}: {
  /** Called with the final draft once onboarding is ready to persist. For a
   * signed-out flow this fires AFTER the email/OTP verify; for a signed-in redo
   * it fires straight off the last step. #110 persists + builds the week. */
  onComplete: (draft: OnboardingDraft) => void
  /** 'I have an account' on the intro carousel. */
  onSignIn?: () => void
  /** Start directly on the stepped form, skipping the built-in intro carousel
   * (used when the host already shows its own welcome screen). */
  skipIntro?: boolean
  /** When true (the default, a signed-out visitor), append the email/OTP phase
   * after the steps so the user creates their account at the end. When false (a
   * signed-in redo), skip it — they already have a session. */
  requireAuth?: boolean
}) {
  const [phase, setPhase] = React.useState<Phase>(skipIntro ? 'steps' : 'intro')
  const [stepIndex, setStepIndex] = React.useState(0)
  // Lazily restore any draft left behind by a reload mid-flow; falls back to the
  // empty draft. The reducer is the live source of truth from here on.
  const [draft, dispatch] = React.useReducer(
    onboardingReducer,
    EMPTY_DRAFT,
    (initial) => loadDraft() ?? initial,
  )

  // Mirror every draft change to sessionStorage so an accidental reload during
  // the email/OTP step does not lose the answers. Cleared on completion.
  React.useEffect(() => {
    saveDraft(draft)
  }, [draft])

  // Top of the funnel: the onboarding flow mounted. Once per mount.
  React.useEffect(() => {
    track(FUNNEL_EVENTS.onboardingStarted, { skipIntro, requireAuth })
  }, [skipIntro, requireAuth])

  const formValue = React.useMemo(
    () => ({
      draft,
      patch: (patch: Partial<OnboardingDraft>) =>
        dispatch({ type: 'patch', patch }),
    }),
    [draft],
  )

  function complete() {
    // The flow is done: drop the sessionStorage backup so a later visit starts
    // clean, then hand the draft to the parent to persist + build the week.
    if (typeof window !== 'undefined') {
      window.sessionStorage.removeItem(DRAFT_STORAGE_KEY)
    }
    onComplete(draft)
  }

  if (phase === 'intro') {
    return (
      <WelcomeBoard
        onGetStarted={() => {
          setStepIndex(0)
          setPhase('steps')
        }}
        onSignIn={onSignIn}
      />
    )
  }

  if (phase === 'auth') {
    return (
      <div
        className="flex min-h-0 flex-1 flex-col"
        data-testid="onboarding-auth"
      >
        <header className="shrink-0 px-5 pt-4">
          <button
            type="button"
            aria-label="Back"
            onClick={() => setPhase('steps')}
            className="border-border flex h-10 w-10 items-center justify-center rounded-full border transition active:scale-95"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
        </header>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pt-6">
          <h1 className="text-[1.6rem] leading-tight font-bold tracking-tight">
            Almost there
          </h1>
          <p className="text-muted-foreground mt-1 text-[0.95rem]">
            Save your plan so it is here next time.
          </p>
          <div className="mt-6 flex-1">
            <EmailStep onVerified={complete} />
          </div>
        </div>
      </div>
    )
  }

  const total = STEPS.length
  const step = STEPS[stepIndex]
  // stepIndex is always clamped to [0, total) by the nav below; the guard keeps
  // the type checker honest under noUncheckedIndexedAccess.
  if (!step) return null
  const isLast = stepIndex === total - 1
  const canAdvance = step.canAdvance ? step.canAdvance(draft) : true
  const progressPct = ((stepIndex + 1) / total) * 100

  function back() {
    if (stepIndex === 0) {
      setPhase('intro')
      return
    }
    setStepIndex((i) => i - 1)
  }

  function next() {
    // Each completed step is a funnel rung; `step.id` names which one (household,
    // dislikes, diet, cuisine, kitchen, goals, store, ...). `step` is guaranteed
    // here (the early `if (!step) return null` returns before this renders), but
    // re-read defensively for noUncheckedIndexedAccess.
    track(FUNNEL_EVENTS.onboardingStepCompleted, {
      step: STEPS[stepIndex]?.id,
      stepIndex,
      total,
      ...draftFunnelProps(draft),
    })
    if (isLast) {
      // A signed-out visitor goes to the email/OTP phase to create their account
      // before we persist; a signed-in redo (requireAuth=false) completes now.
      if (requireAuth) {
        // Reached the email/OTP phase: the user has submitted the whole form and
        // is about to give their email. The auth agent owns the OTP
        // request/verify breadcrumbs inside EmailStep; this marks the funnel rung.
        track(FUNNEL_EVENTS.emailSubmitted, draftFunnelProps(draft))
        setPhase('auth')
        return
      }
      complete()
      return
    }
    setStepIndex((i) => i + 1)
  }

  const { Component } = step

  return (
    <OnboardingFormProvider value={formValue}>
      <div
        className="flex min-h-0 flex-1 flex-col"
        data-testid="onboarding-steps"
      >
        <header className="shrink-0 px-5 pt-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              aria-label="Back"
              onClick={back}
              className="border-border flex h-10 w-10 items-center justify-center rounded-full border transition active:scale-95"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <div
              className="bg-secondary h-1.5 flex-1 overflow-hidden rounded-full"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={total}
              aria-valuenow={stepIndex + 1}
              aria-label="Onboarding progress"
            >
              <div
                className="bg-primary h-full rounded-full transition-all"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <span className="text-muted-foreground w-10 text-right text-sm tabular-nums">
              {stepIndex + 1}/{total}
            </span>
          </div>
        </header>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pt-6">
          {step.title && (
            <h1 className="text-[1.6rem] leading-tight font-bold tracking-tight">
              {step.title}
            </h1>
          )}
          {step.subtitle && (
            <p className="text-muted-foreground mt-1 text-[0.95rem]">
              {step.subtitle}
            </p>
          )}
          <div className={step.title ? 'mt-6 flex-1' : 'flex-1'}>
            <Component />
          </div>
        </div>

        <div
          className="shrink-0 px-5 pt-4 pb-8"
          data-testid="onboarding-footer"
        >
          <Button
            size="pill"
            disabled={!canAdvance}
            onClick={next}
            data-testid="onboarding-next"
          >
            {isLast ? (requireAuth ? 'Continue' : 'Build my week') : 'Next'}
          </Button>
        </div>
      </div>
    </OnboardingFormProvider>
  )
}
