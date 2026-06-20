import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import * as React from 'react'
import { HouseholdStep } from './household-step'
import {
  EMPTY_DRAFT,
  OnboardingFormProvider,
  onboardingReducer,
} from '../form-state'
import type { OnboardingDraft } from '../form-state'

/** Mounts HouseholdStep with a live reducer so patches round-trip like the flow. */
function renderStep() {
  function Harness() {
    const [draft, dispatch] = React.useReducer(onboardingReducer, EMPTY_DRAFT)
    const value = React.useMemo(
      () => ({
        draft,
        patch: (patch: Partial<OnboardingDraft>) =>
          dispatch({ type: 'patch', patch }),
      }),
      [draft],
    )
    return (
      <OnboardingFormProvider value={value}>
        <HouseholdStep />
      </OnboardingFormProvider>
    )
  }
  return render(<Harness />)
}

describe('HouseholdStep', () => {
  it('renders adults, children and pet steppers', () => {
    renderStep()
    expect(screen.getByTestId('household-step')).toBeTruthy()
    expect(screen.getByText('Adults')).toBeTruthy()
    expect(screen.getByText('Children')).toBeTruthy()
    expect(screen.getByText('Cats')).toBeTruthy()
    expect(screen.getByText('Dogs')).toBeTruthy()
  })

  it('floors adults at 1 (remove disables once you reach the floor)', () => {
    renderStep()
    const remove = screen.getByRole<HTMLButtonElement>('button', {
      name: 'Remove one adults',
    })
    // Default is 2 adults, so remove is live; one tap reaches the floor of 1.
    expect(remove.disabled).toBe(false)
    fireEvent.click(remove)
    expect(remove.disabled).toBe(true)
  })

  it('adds a child and reveals an age input seeded with a default', () => {
    renderStep()
    expect(screen.queryByTestId('children-ages')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Add one children' }))
    expect(screen.getByTestId('children-ages')).toBeTruthy()
    expect(screen.getByLabelText('Age of child 1')).toBeTruthy()
  })

  it('increments a pet counter on tap', () => {
    renderStep()
    fireEvent.click(screen.getByRole('button', { name: 'Add one cats' }))
    // The cats stepper now reads 1.
    const value = screen
      .getByText('Cats')
      .closest('div')
      ?.parentElement?.querySelector('[aria-live="polite"]')
    expect(value?.textContent).toBe('1')
  })
})
