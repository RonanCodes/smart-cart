import * as React from 'react'
import { ChevronLeft } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { WelcomeBoard } from './welcome-board'
import { STEPS } from './steps'
import {
  EMPTY_DRAFT,
  OnboardingFormProvider,
  onboardingReducer,
} from './form-state'
import type { OnboardingDraft } from './form-state'

/**
 * OnboardingFlow — the Jow-style form shell that replaces the swipe deck as the
 * onboarding entry. It owns:
 *   - the phase machine (intro carousel -> stepped form),
 *   - the shared form-state reducer (the draft each step patches),
 *   - the chrome: a top progress bar, a back arrow, and a bottom 'Next' CTA.
 *
 * It renders one step at a time from the STEPS registry, so sibling slices add a
 * screen by appending to that array with no change here. Persistence is NOT wired
 * here — `onComplete` fires with the final draft and #110 takes it from there.
 *
 * Mobile first at 390px. The parent route supplies the safe-area frame.
 */

type Phase = 'intro' | 'steps'

export function OnboardingFlow({
  onComplete,
  onSignIn,
  skipIntro = false,
}: {
  /** Called with the final draft when the last step is advanced. #110 persists. */
  onComplete: (draft: OnboardingDraft) => void
  /** 'I have an account' on the intro carousel. */
  onSignIn?: () => void
  /** Start directly on the stepped form, skipping the built-in intro carousel
   * (used when the host already shows its own welcome screen). */
  skipIntro?: boolean
}) {
  const [phase, setPhase] = React.useState<Phase>(skipIntro ? 'steps' : 'intro')
  const [stepIndex, setStepIndex] = React.useState(0)
  const [draft, dispatch] = React.useReducer(onboardingReducer, EMPTY_DRAFT)

  const formValue = React.useMemo(
    () => ({
      draft,
      patch: (patch: Partial<OnboardingDraft>) =>
        dispatch({ type: 'patch', patch }),
    }),
    [draft],
  )

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
    if (isLast) {
      onComplete(draft)
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
            {isLast ? 'Build my week' : 'Next'}
          </Button>
        </div>
      </div>
    </OnboardingFormProvider>
  )
}
