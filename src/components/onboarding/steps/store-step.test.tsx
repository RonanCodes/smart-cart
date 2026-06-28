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
import { FlagsProvider } from '#/lib/flags-context'
import { mergeFlags } from '#/lib/flags'
import type { FlagSet } from '#/lib/flags'

const track = vi.fn()
vi.mock('#/lib/analytics', () => ({
  track: (...args: Array<unknown>) => track(...args),
  FUNNEL_EVENTS: { storeSelected: 'store_selected' },
}))

beforeEach(() => {
  track.mockReset()
})

/**
 * Real-context harness mirroring OnboardingFlow: patches flow through the actual
 * reducer so the test can assert what the step wrote into the shared draft.
 */
function withForm(
  ui: React.ReactElement,
  initial: OnboardingDraft = EMPTY_DRAFT,
  flags: FlagSet = mergeFlags(null),
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
    return (
      <FlagsProvider flags={flags}>
        <OnboardingFormProvider value={value}>{ui}</OnboardingFormProvider>
      </FlagsProvider>
    )
  }
  render(<Harness />)
  return latest
}

/** Flags with Jumbo turned on (visible), for the "enabled" path. */
const JUMBO_ON = mergeFlags({ 'store.jumbo.visible': true })

describe('StoreStep', () => {
  it('renders exactly the three Dutch stores', () => {
    withForm(<StoreStep />)
    expect(screen.getByRole('radio', { name: /Albert Heijn/ })).toBeTruthy()
    expect(screen.getByRole('radio', { name: /Jumbo/ })).toBeTruthy()
    expect(screen.getByRole('radio', { name: /Picnic/ })).toBeTruthy()
    expect(screen.getAllByRole('radio')).toHaveLength(3)
  })

  it('shows Jumbo as a disabled "Coming soon" option by default (flag off)', () => {
    const latest = withForm(<StoreStep />)
    const jumbo = screen.getByRole('radio', { name: /Jumbo/ })
    expect(jumbo.getAttribute('aria-disabled')).toBe('true')
    expect((jumbo as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('Coming soon')).toBeTruthy()
    fireEvent.click(jumbo)
    expect(latest.draft.store).toBeNull()
  })

  it('lets Jumbo be picked once its visible flag is on', () => {
    const latest = withForm(<StoreStep />, EMPTY_DRAFT, JUMBO_ON)
    const jumbo = screen.getByRole('radio', { name: /Jumbo/ })
    expect((jumbo as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(jumbo)
    expect(latest.draft.store).toBe('jumbo')
  })

  it('selects Albert Heijn into draft.store with the ah slug', () => {
    const latest = withForm(<StoreStep />)
    fireEvent.click(screen.getByRole('radio', { name: /Albert Heijn/ }))
    expect(latest.draft.store).toBe('ah')
  })

  it('fires store_selected (source onboarding) when a store is picked', () => {
    withForm(<StoreStep />)
    fireEvent.click(screen.getByRole('radio', { name: /Albert Heijn/ }))
    expect(track).toHaveBeenCalledWith('store_selected', {
      store: 'ah',
      source: 'onboarding',
    })
  })

  it('fires nothing when the disabled "Coming soon" Jumbo is tapped (flag off)', () => {
    withForm(<StoreStep />)
    fireEvent.click(screen.getByRole('radio', { name: /Jumbo/ }))
    expect(track).not.toHaveBeenCalled()
  })

  it('fires store_selected (source onboarding) when Jumbo is picked (flag on)', () => {
    withForm(<StoreStep />, EMPTY_DRAFT, JUMBO_ON)
    fireEvent.click(screen.getByRole('radio', { name: /Jumbo/ }))
    expect(track).toHaveBeenCalledWith('store_selected', {
      store: 'jumbo',
      source: 'onboarding',
    })
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
