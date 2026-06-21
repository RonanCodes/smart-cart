import { describe, it, expect } from 'vitest'
import {
  positionToIndex,
  indexToPosition,
  readHistoryIndex,
  historyStateFor,
} from './onboarding-history'

// Six steps in the real registry; the mapping is parametric on stepCount so the
// tests pin the contract rather than a magic number.
const STEP_COUNT = 6

describe('onboarding-history step<->history mapping', () => {
  it('maps the intro to index 0', () => {
    expect(positionToIndex({ phase: 'intro', stepIndex: 0 }, STEP_COUNT)).toBe(
      0,
    )
  })

  it('maps each step to a contiguous index 1..stepCount', () => {
    for (let s = 0; s < STEP_COUNT; s++) {
      expect(
        positionToIndex({ phase: 'steps', stepIndex: s }, STEP_COUNT),
      ).toBe(s + 1)
    }
  })

  it('maps the auth phase to stepCount + 1', () => {
    expect(positionToIndex({ phase: 'auth', stepIndex: 0 }, STEP_COUNT)).toBe(
      STEP_COUNT + 1,
    )
  })

  it('round-trips every valid position through index and back', () => {
    const positions = [
      { phase: 'intro', stepIndex: 0 } as const,
      ...Array.from(
        { length: STEP_COUNT },
        (_, s) => ({ phase: 'steps', stepIndex: s }) as const,
      ),
      { phase: 'auth', stepIndex: STEP_COUNT - 1 } as const,
    ]
    for (const pos of positions) {
      const idx = positionToIndex(pos, STEP_COUNT)
      expect(indexToPosition(idx, STEP_COUNT)).toEqual(pos)
    }
  })

  it('gives Back from a step the previous step, not the intro (the #371 bug)', () => {
    // The regression: pressing Back on step 3 must land on step 2, never jump
    // all the way to the intro. Decrementing the linear index is exactly that.
    const onStep3 = positionToIndex(
      { phase: 'steps', stepIndex: 2 },
      STEP_COUNT,
    )
    const afterBack = indexToPosition(onStep3 - 1, STEP_COUNT)
    expect(afterBack).toEqual({ phase: 'steps', stepIndex: 1 })
  })

  it('gives Back from the first step the intro, and Back from auth the last step', () => {
    const onStep0 = positionToIndex(
      { phase: 'steps', stepIndex: 0 },
      STEP_COUNT,
    )
    expect(indexToPosition(onStep0 - 1, STEP_COUNT)).toEqual({
      phase: 'intro',
      stepIndex: 0,
    })
    const onAuth = positionToIndex({ phase: 'auth', stepIndex: 0 }, STEP_COUNT)
    expect(indexToPosition(onAuth - 1, STEP_COUNT)).toEqual({
      phase: 'steps',
      stepIndex: STEP_COUNT - 1,
    })
  })

  it('clamps out-of-range indices to the nearest valid position', () => {
    expect(indexToPosition(-5, STEP_COUNT)).toEqual({
      phase: 'intro',
      stepIndex: 0,
    })
    expect(indexToPosition(999, STEP_COUNT)).toEqual({
      phase: 'auth',
      stepIndex: STEP_COUNT - 1,
    })
  })

  it('reads our linear index out of a history.state and ignores foreign state', () => {
    expect(readHistoryIndex(historyStateFor(3))).toBe(3)
    expect(readHistoryIndex(null)).toBeNull()
    expect(readHistoryIndex({ somethingElse: 1 })).toBeNull()
    expect(readHistoryIndex({ onboardingPos: 'nope' })).toBeNull()
  })
})
