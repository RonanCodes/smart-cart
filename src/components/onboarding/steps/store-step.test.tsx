import * as React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { StoreStep } from './store-step'
import {
  EMPTY_DRAFT,
  OnboardingFormProvider,
  onboardingReducer,
} from '../form-state'
import type { OnboardingDraft } from '../form-state'

const track = vi.fn()
vi.mock('#/lib/analytics', () => ({
  track: (...args: Array<unknown>) => track(...args),
  FUNNEL_EVENTS: { storeSelected: 'store_selected' },
}))

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
  beforeEach(() => track.mockReset())

  it('renders exactly the three Dutch stores', () => {
    withForm(<StoreStep />)
    expect(screen.getByRole('radio', { name: /Albert Heijn/ })).toBeTruthy()
    expect(screen.getByRole('radio', { name: /Jumbo/ })).toBeTruthy()
    expect(screen.getByRole('radio', { name: /Picnic/ })).toBeTruthy()
    expect(screen.getAllByRole('radio')).toHaveLength(3)
  })

  it('shows Jumbo as a disabled "Coming soon" option that cannot be picked', () => {
    const latest = withForm(<StoreStep />)
    const jumbo = screen.getByRole('radio', { name: /Jumbo/ })
    expect(jumbo.getAttribute('aria-disabled')).toBe('true')
    expect((jumbo as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('Coming soon')).toBeTruthy()
    // A click on the disabled option must not change the draft store.
    fireEvent.click(jumbo)
    expect(latest.draft.store).toBeNull()
  })

  it('selects Albert Heijn into draft.store with the ah slug', () => {
    const latest = withForm(<StoreStep />)
    fireEvent.click(screen.getByRole('radio', { name: /Albert Heijn/ }))
    expect(latest.draft.store).toBe('ah')
  })

  it('fires store_selected when a store is picked, never for the disabled one', () => {
    withForm(<StoreStep />)
    fireEvent.click(screen.getByRole('radio', { name: /Picnic/ }))
    expect(track).toHaveBeenCalledWith(
      'store_selected',
      expect.objectContaining({ store: 'picnic', source: 'onboarding' }),
    )
    track.mockReset()
    // The parked Jumbo option must not emit an event.
    fireEvent.click(screen.getByRole('radio', { name: /Jumbo/ }))
    expect(track).not.toHaveBeenCalled()
  })

  it('shows already-selected store as checked', () => {
    withForm(<StoreStep />, { ...EMPTY_DRAFT, store: 'ah' })
    const ah = screen.getByRole('radio', { name: /Albert Heijn/ })
    expect(ah.getAttribute('aria-checked')).toBe('true')
  })

  it('selects Picnic into draft.store with the picnic slug', () => {
    const latest = withForm(<StoreStep />)
    fireEvent.click(screen.getByRole('radio', { name: /Picnic/ }))
    expect(latest.draft.store).toBe('picnic')
    expect(
      screen
        .getByRole('radio', { name: /Picnic/ })
        .getAttribute('aria-checked'),
    ).toBe('true')
  })
})
