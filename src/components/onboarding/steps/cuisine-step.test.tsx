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

describe('CuisineStep', () => {
  it('renders the cuisine grid', () => {
    withForm(<CuisineStep />)
    expect(screen.getByRole('button', { name: 'Italian' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Thai' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Vietnamese' })).toBeTruthy()
  })

  it('cycles a cuisine neutral -> like -> hate -> neutral on tap', () => {
    const latest = withForm(<CuisineStep />)
    const tile = screen.getByRole('button', { name: 'Italian' })

    // neutral -> like
    fireEvent.click(tile)
    expect(latest.draft.cuisinesLiked).toContain('Italian')
    expect(latest.draft.cuisinesDisliked).not.toContain('Italian')

    // like -> hate (moves to the other list, never both)
    fireEvent.click(screen.getByRole('button', { name: 'Italian' }))
    expect(latest.draft.cuisinesLiked).not.toContain('Italian')
    expect(latest.draft.cuisinesDisliked).toContain('Italian')

    // hate -> neutral (cleared from both)
    fireEvent.click(screen.getByRole('button', { name: 'Italian' }))
    expect(latest.draft.cuisinesLiked).not.toContain('Italian')
    expect(latest.draft.cuisinesDisliked).not.toContain('Italian')
  })

  it('never holds a cuisine in both lists at once', () => {
    const latest = withForm(<CuisineStep />, {
      ...EMPTY_DRAFT,
      cuisinesDisliked: ['Thai'],
    })
    // Thai starts hated; tap cycles hate -> neutral, so it leaves both lists.
    fireEvent.click(screen.getByRole('button', { name: 'Thai' }))
    expect(latest.draft.cuisinesDisliked).not.toContain('Thai')
    expect(latest.draft.cuisinesLiked).not.toContain('Thai')
  })

  it('reflects an already-liked cuisine as pressed', () => {
    withForm(<CuisineStep />, { ...EMPTY_DRAFT, cuisinesLiked: ['Mexican'] })
    const tile = screen.getByRole('button', { name: 'Mexican' })
    expect(tile.getAttribute('aria-pressed')).toBe('true')
    expect(tile.getAttribute('data-state')).toBe('like')
  })
})
