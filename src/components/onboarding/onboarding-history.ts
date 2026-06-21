/**
 * onboarding-history — the pure step<->history mapping for the onboarding flow.
 *
 * THE BUG (#371): the whole flow lives in one route (`/onboarding`) and steps
 * are React state, so the browser/OS Back button popped the ENTIRE route, jumping
 * the user back past every step to wherever they came from (the intro / home),
 * losing their place. Fix: give each forward move its own history entry keyed to
 * the flow position, so Back walks the flow one position at a time and Forward
 * re-advances.
 *
 * This module is the framework-free core: it turns a flow position (the phase +
 * step the shell is showing) into a single linear integer and back. The shell
 * (onboarding-flow.tsx) owns the actual pushState/popstate plumbing; everything
 * decision-shaped lives here so it can be locked by unit tests without a DOM.
 *
 * The linear position is the natural reading order of the flow:
 *
 *   0            intro carousel / welcome board
 *   1 .. total   the stepped form, position p shows STEPS[p - 1]
 *   total + 1    the email/OTP `auth` phase (only present when requireAuth)
 *
 * where `total` is STEPS.length.
 */

export type OnboardingPhase = 'intro' | 'steps' | 'auth'

/** Where the flow shell is currently parked. */
export interface OnboardingPosition {
  phase: OnboardingPhase
  /** Index into STEPS; meaningful only when phase === 'steps'. */
  stepIndex: number
}

/** The history.state shape we stamp on each onboarding entry. */
export interface OnboardingHistoryState {
  onboardingPos: number
}

const KEY = 'onboardingPos'

/**
 * Collapse a {phase, stepIndex} into the single linear integer used as the
 * history key. `stepCount` is STEPS.length.
 */
export function positionToIndex(
  pos: OnboardingPosition,
  stepCount: number,
): number {
  switch (pos.phase) {
    case 'intro':
      return 0
    case 'steps':
      // Clamp into the step range so an out-of-bounds index can never produce a
      // position that collides with intro (0) or auth (stepCount + 1).
      return clamp(pos.stepIndex, 0, stepCount - 1) + 1
    case 'auth':
      return stepCount + 1
  }
}

/**
 * Expand a linear integer back into a {phase, stepIndex}. The inverse of
 * positionToIndex; out-of-range indices clamp to the nearest valid position so a
 * stale/foreign history entry can never wedge the shell.
 */
export function indexToPosition(
  index: number,
  stepCount: number,
): OnboardingPosition {
  const max = stepCount + 1
  const i = clamp(Math.round(index), 0, max)
  if (i === 0) return { phase: 'intro', stepIndex: 0 }
  if (i === max) return { phase: 'auth', stepIndex: stepCount - 1 }
  return { phase: 'steps', stepIndex: i - 1 }
}

/** Read our linear position out of an arbitrary history.state, if present. */
export function readHistoryIndex(state: unknown): number | null {
  if (
    typeof state === 'object' &&
    state !== null &&
    KEY in state &&
    typeof (state as Record<string, unknown>)[KEY] === 'number'
  ) {
    return (state as OnboardingHistoryState).onboardingPos
  }
  return null
}

/** Build the history.state object for a given linear position. */
export function historyStateFor(index: number): OnboardingHistoryState {
  return { onboardingPos: index }
}

function clamp(n: number, lo: number, hi: number): number {
  if (Number.isNaN(n)) return lo
  return Math.min(Math.max(n, lo), hi)
}
