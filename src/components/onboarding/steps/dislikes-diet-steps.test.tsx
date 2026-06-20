import * as React from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DislikesStep } from './dislikes-step'
import { DietStep } from './diet-step'
import {
  EMPTY_DRAFT,
  OnboardingFormProvider,
  onboardingReducer,
} from '../form-state'
import type { OnboardingDraft } from '../form-state'

/**
 * A tiny harness that gives a step the real form context so patches flow through
 * the actual reducer, mirroring how OnboardingFlow drives it. `latest` exposes
 * the current draft so a test can assert what the step wrote.
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

describe('DislikesStep', () => {
  it('renders the suggested ingredient pills', () => {
    withForm(<DislikesStep />)
    expect(screen.getByRole('button', { name: 'Shellfish' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Nuts' })).toBeTruthy()
    expect(screen.getByPlaceholderText('Search an ingredient')).toBeTruthy()
  })

  it('toggles a pill into and out of draft.dislikes', () => {
    const latest = withForm(<DislikesStep />)
    fireEvent.click(screen.getByRole('button', { name: 'Egg' }))
    expect(latest.draft.dislikes).toContain('Egg')
    // The pressed pill now carries a remove affordance; tapping again clears it.
    fireEvent.click(screen.getByRole('button', { name: /Egg/ }))
    expect(latest.draft.dislikes).not.toContain('Egg')
  })

  it('adds a custom ingredient from the search box on Enter', () => {
    const latest = withForm(<DislikesStep />)
    const input = screen.getByPlaceholderText('Search an ingredient')
    fireEvent.change(input, { target: { value: 'Capers' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(latest.draft.dislikes).toContain('Capers')
    expect(screen.getByRole('button', { name: /Capers/ })).toBeTruthy()
  })

  it('shows already-selected dislikes as pressed pills', () => {
    withForm(<DislikesStep />, { ...EMPTY_DRAFT, dislikes: ['Soy'] })
    const pill = screen.getByRole('button', { name: /Soy/ })
    expect(pill.getAttribute('aria-pressed')).toBe('true')
  })
})

describe('DietStep', () => {
  it('renders all six dietary restriction options plus info notes', () => {
    withForm(<DietStep />)
    for (const label of [
      'Dairy free',
      'Gluten free',
      'Porkless',
      'Vegan',
      'Vegetarian',
      'Pescatarian',
    ]) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy()
    }
    expect(screen.getByText(/always honoured/)).toBeTruthy()
    expect(screen.getByText(/change these any time/)).toBeTruthy()
  })

  it('multi-selects restrictions into draft.diet', () => {
    const latest = withForm(<DietStep />)
    fireEvent.click(screen.getByRole('button', { name: 'Vegan' }))
    fireEvent.click(screen.getByRole('button', { name: 'Gluten free' }))
    expect(latest.draft.diet).toEqual(['Vegan', 'Gluten free'])
  })

  it('toggles a restriction off when tapped twice', () => {
    const latest = withForm(<DietStep />)
    const veg = screen.getByRole('button', { name: 'Vegetarian' })
    fireEvent.click(veg)
    expect(latest.draft.diet).toContain('Vegetarian')
    fireEvent.click(veg)
    expect(latest.draft.diet).not.toContain('Vegetarian')
  })
})
