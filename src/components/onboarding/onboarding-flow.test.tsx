import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { OnboardingFlow } from './onboarding-flow'
import { IntroCarousel } from './intro-carousel'
import { STEPS } from './steps'

describe('IntroCarousel', () => {
  it('renders the first Souso value slide with paging dots and a CTA', () => {
    render(<IntroCarousel onGetStarted={() => {}} />)
    expect(screen.getByText('Meals that cater to your needs')).toBeTruthy()
    // One tab per slide.
    expect(screen.getAllByRole('tab')).toHaveLength(3)
    expect(screen.getByRole('button', { name: 'Get started' })).toBeTruthy()
  })

  it('pages to another slide when a dot is tapped', () => {
    render(<IntroCarousel onGetStarted={() => {}} />)
    fireEvent.click(screen.getByRole('tab', { name: /Slide 3/ }))
    expect(screen.getByText('Easy to cook')).toBeTruthy()
  })

  it('fires onGetStarted from the CTA', () => {
    const onGetStarted = vi.fn()
    render(<IntroCarousel onGetStarted={onGetStarted} />)
    fireEvent.click(screen.getByRole('button', { name: 'Get started' }))
    expect(onGetStarted).toHaveBeenCalledTimes(1)
  })

  it('shows the sign-in affordance only when handed onSignIn', () => {
    const { rerender } = render(<IntroCarousel onGetStarted={() => {}} />)
    expect(screen.queryByText('I have an account')).toBeNull()
    rerender(<IntroCarousel onGetStarted={() => {}} onSignIn={() => {}} />)
    expect(screen.getByText('I have an account')).toBeTruthy()
  })
})

describe('OnboardingFlow', () => {
  it('opens on the intro carousel, not the steps', () => {
    render(<OnboardingFlow onComplete={() => {}} />)
    expect(screen.getByTestId('intro-carousel')).toBeTruthy()
    expect(screen.queryByTestId('onboarding-steps')).toBeNull()
  })

  it('enters the stepped form on Get started, showing the first step', () => {
    render(<OnboardingFlow onComplete={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Get started' }))
    expect(screen.getByTestId('onboarding-steps')).toBeTruthy()
    expect(screen.getByText(STEPS[0]!.title)).toBeTruthy()
    expect(screen.getByText(`1/${STEPS.length}`)).toBeTruthy()
  })

  it('walks Next through every step and fires onComplete on the last', () => {
    const onComplete = vi.fn()
    render(<OnboardingFlow onComplete={onComplete} />)
    fireEvent.click(screen.getByRole('button', { name: 'Get started' }))

    // Advance through all but the final step.
    for (let i = 0; i < STEPS.length - 1; i++) {
      expect(screen.getByText(STEPS[i]!.title)).toBeTruthy()
      fireEvent.click(screen.getByTestId('onboarding-next'))
    }
    // Final step shows the 'Build my week' label and completes.
    const finish = screen.getByTestId('onboarding-next')
    expect(finish.textContent).toContain('Build my week')
    fireEvent.click(finish)
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it('steps back from the first step to the intro carousel', () => {
    render(<OnboardingFlow onComplete={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Get started' }))
    expect(screen.getByTestId('onboarding-steps')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByTestId('intro-carousel')).toBeTruthy()
  })
})
