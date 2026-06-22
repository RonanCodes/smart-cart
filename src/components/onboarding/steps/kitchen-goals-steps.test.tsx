import * as React from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { KitchenStep } from './kitchen-step'
import { GoalsStep } from './goals-step'
import {
  EMPTY_DRAFT,
  OnboardingFormProvider,
  onboardingReducer,
} from '../form-state'
import type { OnboardingDraft } from '../form-state'

/**
 * Mirrors the dislikes/diet harness: a real form context so patches flow through
 * the actual reducer, with `latest` exposing the live draft for assertions.
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

describe('KitchenStep', () => {
  it('renders all six appliance options', () => {
    withForm(<KitchenStep />)
    for (const label of [
      'Oven',
      'Microwave',
      'Stovetop',
      'Blender',
      'Multi cooker',
      'Air fryer',
    ]) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy()
    }
  })

  it('multi-selects appliances into draft.equipment', () => {
    const latest = withForm(<KitchenStep />)
    fireEvent.click(screen.getByRole('button', { name: 'Oven' }))
    fireEvent.click(screen.getByRole('button', { name: 'Air fryer' }))
    expect(latest.draft.equipment).toEqual(['Oven', 'Air fryer'])
  })

  it('toggles an appliance off when tapped twice', () => {
    const latest = withForm(<KitchenStep />)
    const oven = screen.getByRole('button', { name: 'Oven' })
    fireEvent.click(oven)
    expect(latest.draft.equipment).toContain('Oven')
    fireEvent.click(oven)
    expect(latest.draft.equipment).not.toContain('Oven')
  })

  it('shows already-selected appliances as pressed', () => {
    withForm(<KitchenStep />, { ...EMPTY_DRAFT, equipment: ['Blender'] })
    const pill = screen.getByRole('button', { name: 'Blender' })
    expect(pill.getAttribute('aria-pressed')).toBe('true')
  })
})

describe('GoalsStep', () => {
  it('renders all eight goal options', () => {
    withForm(<GoalsStep />)
    for (const label of [
      'Eat a more balanced diet',
      'Pay less for my groceries',
      'Cook and discover new recipes',
      'Avoid unnecessary purchases',
      'Eat less meat',
      'More protein',
      'Quick meals',
      'Low-cal meals',
    ]) {
      expect(
        screen.getByRole('button', { name: new RegExp(label) }),
      ).toBeTruthy()
    }
  })

  it('selects and persists each of the new protein / quick / low-cal goals', () => {
    const latest = withForm(<GoalsStep />)
    fireEvent.click(screen.getByRole('button', { name: /More protein/ }))
    fireEvent.click(screen.getByRole('button', { name: /Quick meals/ }))
    fireEvent.click(screen.getByRole('button', { name: /Low-cal meals/ }))
    expect(latest.draft.goals).toEqual([
      'More protein',
      'Quick meals',
      'Low-cal meals',
    ])
  })

  it('toggles a new goal off when tapped twice', () => {
    const latest = withForm(<GoalsStep />)
    const goal = screen.getByRole('button', { name: /More protein/ })
    fireEvent.click(goal)
    expect(latest.draft.goals).toContain('More protein')
    fireEvent.click(goal)
    expect(latest.draft.goals).not.toContain('More protein')
  })

  it('multi-selects goals into draft.goals', () => {
    const latest = withForm(<GoalsStep />)
    fireEvent.click(screen.getByRole('button', { name: /Eat less meat/ }))
    fireEvent.click(
      screen.getByRole('button', { name: /Pay less for my groceries/ }),
    )
    expect(latest.draft.goals).toEqual([
      'Eat less meat',
      'Pay less for my groceries',
    ])
  })

  it('toggles a goal off when tapped twice', () => {
    const latest = withForm(<GoalsStep />)
    const goal = screen.getByRole('button', {
      name: /Cook and discover new recipes/,
    })
    fireEvent.click(goal)
    expect(latest.draft.goals).toContain('Cook and discover new recipes')
    fireEvent.click(goal)
    expect(latest.draft.goals).not.toContain('Cook and discover new recipes')
  })

  it('shows already-selected goals as pressed', () => {
    withForm(<GoalsStep />, { ...EMPTY_DRAFT, goals: ['Eat less meat'] })
    const row = screen.getByRole('button', { name: /Eat less meat/ })
    expect(row.getAttribute('aria-pressed')).toBe('true')
  })
})
