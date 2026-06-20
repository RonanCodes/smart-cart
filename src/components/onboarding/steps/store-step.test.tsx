import * as React from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { StoreStep } from './store-step'
import {
  EMPTY_DRAFT,
  OnboardingFormProvider,
  onboardingReducer,
} from '../form-state'
import type { OnboardingDraft } from '../form-state'

/**
 * Real-context harness mirroring OnboardingFlow: patches flow through the actual
 * reducer so the test can assert what the step wrote into the shared draft.
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

describe('StoreStep', () => {
  it('renders exactly the three Dutch stores', () => {
    withForm(<StoreStep />)
    expect(screen.getByRole('radio', { name: /Albert Heijn/ })).toBeTruthy()
    expect(screen.getByRole('radio', { name: /Jumbo/ })).toBeTruthy()
    expect(screen.getByRole('radio', { name: /Picnic/ })).toBeTruthy()
    expect(screen.getAllByRole('radio')).toHaveLength(3)
  })

  it('selects Jumbo into draft.store with its slug', () => {
    const latest = withForm(<StoreStep />)
    fireEvent.click(screen.getByRole('radio', { name: /Jumbo/ }))
    expect(latest.draft.store).toBe('jumbo')
  })

  it('selects Albert Heijn into draft.store with the ah slug', () => {
    const latest = withForm(<StoreStep />)
    fireEvent.click(screen.getByRole('radio', { name: /Albert Heijn/ }))
    expect(latest.draft.store).toBe('ah')
  })

  it('shows already-selected store as checked', () => {
    withForm(<StoreStep />, { ...EMPTY_DRAFT, store: 'ah' })
    const ah = screen.getByRole('radio', { name: /Albert Heijn/ })
    expect(ah.getAttribute('aria-checked')).toBe('true')
  })

  it('tapping Picnic shows the joke and does NOT select a store', () => {
    const latest = withForm(<StoreStep />)
    // No joke before the tap.
    expect(screen.queryByText(/convince the CTO/)).toBeNull()

    fireEvent.click(screen.getByRole('radio', { name: /Picnic/ }))

    // Joke is shown.
    expect(
      screen.getByText(/Coming soon, if we can convince the CTO/),
    ).toBeTruthy()
    // Picnic never writes to the draft.
    expect(latest.draft.store).toBeNull()
    // Picnic stays unchecked.
    expect(
      screen
        .getByRole('radio', { name: /Picnic/ })
        .getAttribute('aria-checked'),
    ).toBe('false')
  })
})
