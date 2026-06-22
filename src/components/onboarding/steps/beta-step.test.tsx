import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BetaStep } from './beta-step'
import { OnboardingFormProvider, EMPTY_DRAFT } from '../form-state'

function renderStep(patch = vi.fn()) {
  render(
    <OnboardingFormProvider value={{ draft: EMPTY_DRAFT, patch }}>
      <BetaStep />
    </OnboardingFormProvider>,
  )
  return patch
}

describe('BetaStep', () => {
  it('frames the beta-tester intent and points to the feedback button', () => {
    renderStep()
    expect(screen.getByTestId('beta-step')).toBeTruthy()
    expect(screen.getByText(/first beta testers/i)).toBeTruthy()
    expect(screen.getByText(/Feedback/)).toBeTruthy()
  })

  it('patches the optional phone as the user types (never required)', () => {
    const patch = renderStep()
    const input = screen.getByPlaceholderText('+31 6 12345678')
    fireEvent.change(input, { target: { value: '0612345678' } })
    expect(patch).toHaveBeenCalledWith({ phone: '0612345678' })
  })
})
