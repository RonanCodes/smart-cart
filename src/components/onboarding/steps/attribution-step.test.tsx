import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AttributionStep } from './attribution-step'
import { OnboardingFormProvider, EMPTY_DRAFT } from '../form-state'
import type { OnboardingDraft } from '../form-state'

const trackMock = vi.hoisted(() => vi.fn())
vi.mock('#/lib/analytics', async (importActual) => {
  const actual = await importActual<Record<string, unknown>>()
  return { ...actual, track: trackMock }
})

function renderStep(overrides: Partial<OnboardingDraft> = {}, patch = vi.fn()) {
  const draft = { ...EMPTY_DRAFT, ...overrides }
  render(
    <OnboardingFormProvider value={{ draft, patch }}>
      <AttributionStep />
    </OnboardingFormProvider>,
  )
  return patch
}

describe('AttributionStep', () => {
  it('renders the source options and the optional referrer field', () => {
    renderStep()
    expect(screen.getByTestId('attribution-step')).toBeTruthy()
    expect(screen.getByRole('radio', { name: /linkedin/i })).toBeTruthy()
    expect(screen.getByRole('radio', { name: /tiktok/i })).toBeTruthy()
    expect(screen.getByRole('radio', { name: /instagram/i })).toBeTruthy()
    expect(screen.getByRole('radio', { name: /word of mouth/i })).toBeTruthy()
    expect(screen.getByRole('radio', { name: /other/i })).toBeTruthy()
    // The referrer ("anyone we should thank?") input is always shown.
    expect(screen.getByTestId('attribution-referrer')).toBeTruthy()
  })

  it('patches the source bucket when an option is picked', () => {
    const patch = renderStep()
    fireEvent.click(screen.getByRole('radio', { name: /linkedin/i }))
    expect(patch).toHaveBeenCalledWith({ source: 'linkedin' })
  })

  it('hides the Other free-text until Other is picked, then reveals it', () => {
    // Not picked: no other-text field.
    renderStep()
    expect(screen.queryByTestId('attribution-source-other')).toBeNull()
  })

  it('reveals the Other free-text when source is other', () => {
    const patch = renderStep({ source: 'other' })
    const otherInput = screen.getByTestId('attribution-source-other')
    expect(otherInput).toBeTruthy()
    fireEvent.change(otherInput, { target: { value: 'a friend' } })
    expect(patch).toHaveBeenCalledWith({ sourceOther: 'a friend' })
  })

  it('patches the optional referrer free text as the user types', () => {
    const patch = renderStep()
    const input = screen.getByTestId('attribution-referrer')
    fireEvent.change(input, { target: { value: 'Ronan' } })
    expect(patch).toHaveBeenCalledWith({ referrer: 'Ronan' })
  })
})
