import * as React from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CuisineStep } from './cuisine-step'
import {
  EMPTY_DRAFT,
  OnboardingFormProvider,
  onboardingReducer,
} from '../form-state'
import type { OnboardingDraft } from '../form-state'

/**
 * Drives CuisineStep with the real form reducer so patches flow exactly as they
 * do inside OnboardingFlow. `latest.draft` exposes the live draft for assertions.
 */
function withForm(
  ui: React.ReactElement,
  initial: OnboardingDraft = EMPTY_DRAFT,
) {
  const latest = { draft: initial }
  function Harness() {
    const [draft, dispatch] = React.useReducer(onboardingReducer, initial)
    latest.draft = draft
    const value = React.useMemo(
      () => ({
        draft,
        patch: (patch: Partial<OnboardingDraft>) =>
          dispatch({ type: 'patch', patch }),
      }),
      [draft],
    )
    return <OnboardingFormProvider value={value}>{ui}</OnboardingFormProvider>
  }
  render(<Harness />)
  return latest
}

/**
 * Tiles announce their state in the accessible name (issue #143), so the name
 * is `<cuisine>: <state phrase>`. Match on the cuisine prefix to stay robust to
 * the exact wording of the state phrase.
 */
function tile(cuisine: string): HTMLElement {
  return screen.getByRole('button', {
    name: new RegExp(`^${cuisine}:`),
  })
}

describe('CuisineStep', () => {
  it('renders the cuisine grid', () => {
    withForm(<CuisineStep />)
    expect(tile('Italian')).toBeTruthy()
    expect(tile('Thai')).toBeTruthy()
    expect(tile('Vietnamese')).toBeTruthy()
  })

  it('shows a like/dislike legend so the interaction is discoverable', () => {
    withForm(<CuisineStep />)
    // The legend spells out that one tap likes and two taps dislike, so users
    // are not left to discover the cycle by accident.
    expect(screen.getByText(/1 tap = like/i)).toBeTruthy()
    expect(screen.getByText(/2 taps = dislike/i)).toBeTruthy()
  })

  it('cycles a cuisine neutral -> like -> hate -> neutral on tap', () => {
    const latest = withForm(<CuisineStep />)

    // neutral -> like
    fireEvent.click(tile('Italian'))
    expect(latest.draft.cuisinesLiked).toContain('Italian')
    expect(latest.draft.cuisinesDisliked).not.toContain('Italian')

    // like -> hate (moves to the other list, never both)
    fireEvent.click(tile('Italian'))
    expect(latest.draft.cuisinesLiked).not.toContain('Italian')
    expect(latest.draft.cuisinesDisliked).toContain('Italian')

    // hate -> neutral (cleared from both)
    fireEvent.click(tile('Italian'))
    expect(latest.draft.cuisinesLiked).not.toContain('Italian')
    expect(latest.draft.cuisinesDisliked).not.toContain('Italian')
  })

  it('announces the next action in each tile state', () => {
    withForm(<CuisineStep />)
    const t = tile('Italian')

    // neutral announces that a tap will like it
    expect(t.getAttribute('aria-label')).toMatch(/tap to like/i)

    fireEvent.click(t)
    // liked announces that a tap will dislike it
    expect(tile('Italian').getAttribute('aria-label')).toMatch(
      /tap to dislike/i,
    )

    fireEvent.click(tile('Italian'))
    // disliked announces that a tap will clear it
    expect(tile('Italian').getAttribute('aria-label')).toMatch(/tap to clear/i)
  })

  it('never holds a cuisine in both lists at once', () => {
    const latest = withForm(<CuisineStep />, {
      ...EMPTY_DRAFT,
      cuisinesDisliked: ['Thai'],
    })
    // Thai starts hated; tap cycles hate -> neutral, so it leaves both lists.
    fireEvent.click(tile('Thai'))
    expect(latest.draft.cuisinesDisliked).not.toContain('Thai')
    expect(latest.draft.cuisinesLiked).not.toContain('Thai')
  })

  it('reflects an already-liked cuisine as pressed', () => {
    withForm(<CuisineStep />, { ...EMPTY_DRAFT, cuisinesLiked: ['Mexican'] })
    const t = tile('Mexican')
    expect(t.getAttribute('aria-pressed')).toBe('true')
    expect(t.getAttribute('data-state')).toBe('like')
  })
})
