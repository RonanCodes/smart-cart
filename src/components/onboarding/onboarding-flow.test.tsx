import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { OnboardingFlow } from './onboarding-flow'
import { IntroCarousel } from './intro-carousel'
import { STEPS } from './steps'

// The email/OTP phase talks to Better Auth's client; mock it so the flow tests
// stay unit-level (no network). Each test sets the resolved error (or none).
const sendVerificationOtp = vi.fn()
const signInEmailOtp = vi.fn()
vi.mock('#/lib/auth-client', () => ({
  authClient: {
    emailOtp: {
      sendVerificationOtp: (...args: Array<unknown>) =>
        sendVerificationOtp(...args),
    },
    signIn: {
      emailOtp: (...args: Array<unknown>) => signInEmailOtp(...args),
    },
    // #414: verify() confirms the session before handing off; resolve a user so
    // confirmSession() returns immediately in the onboarding-flow tests.
    getSession: () => Promise.resolve({ data: { user: { id: 'u1' } } }),
  },
}))

beforeEach(() => {
  sendVerificationOtp.mockReset().mockResolvedValue({ error: null })
  signInEmailOtp.mockReset().mockResolvedValue({ error: null })
  window.sessionStorage.clear()
})

/** Advance from the welcome board through every step to the last step's CTA. */
function walkToLastStep() {
  fireEvent.click(screen.getByRole('button', { name: 'Get started' }))
  for (let i = 0; i < STEPS.length - 1; i++) {
    fireEvent.click(screen.getByTestId('onboarding-next'))
  }
}

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
  it('opens on the welcome board, not the steps', () => {
    render(<OnboardingFlow onComplete={() => {}} />)
    expect(screen.getByTestId('onboarding-welcome')).toBeTruthy()
    expect(screen.queryByTestId('onboarding-steps')).toBeNull()
  })

  it('enters the stepped form on Get started, showing the first step', () => {
    render(<OnboardingFlow onComplete={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Get started' }))
    expect(screen.getByTestId('onboarding-steps')).toBeTruthy()
    expect(screen.getByText(STEPS[0]!.title)).toBeTruthy()
    expect(screen.getByText(`1/${STEPS.length}`)).toBeTruthy()
  })

  it('walks Next through every step, then enters the email phase (signed out)', () => {
    const onComplete = vi.fn()
    render(<OnboardingFlow onComplete={onComplete} />)
    fireEvent.click(screen.getByRole('button', { name: 'Get started' }))

    // Advance through all but the final step. Some steps (e.g. dislikes) own
    // their title inside the step body, so the shell renders no heading — only
    // assert the shell title when the step declares one.
    for (let i = 0; i < STEPS.length - 1; i++) {
      const title = STEPS[i]!.title
      if (title) expect(screen.getByText(title)).toBeTruthy()
      fireEvent.click(screen.getByTestId('onboarding-next'))
    }
    // EMAIL-LAST: the final step's CTA reads 'Continue' and moves to the email
    // phase, NOT straight to onComplete (the account is created there first).
    const finish = screen.getByTestId('onboarding-next')
    expect(finish.textContent).toContain('Continue')
    fireEvent.click(finish)
    expect(screen.getByTestId('onboarding-auth')).toBeTruthy()
    expect(onComplete).not.toHaveBeenCalled()
  })

  it('ends on a Continue CTA when an email phase follows (signed out)', () => {
    render(<OnboardingFlow onComplete={() => {}} />)
    walkToLastStep()
    expect(screen.getByTestId('onboarding-next').textContent).toContain(
      'Continue',
    )
  })

  it('skips the email phase and builds straight away for a signed-in redo', () => {
    const onComplete = vi.fn()
    render(<OnboardingFlow requireAuth={false} onComplete={onComplete} />)
    walkToLastStep()
    // A signed-in redo (requireAuth=false) has no email phase: the last step's
    // CTA reads 'Build my week' and fires onComplete directly.
    const finish = screen.getByTestId('onboarding-next')
    expect(finish.textContent).toContain('Build my week')
    fireEvent.click(finish)
    expect(onComplete).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('onboarding-auth')).toBeNull()
  })

  it('sends the OTP then fires onComplete after a successful verify', async () => {
    const onComplete = vi.fn()
    render(<OnboardingFlow onComplete={onComplete} />)
    walkToLastStep()
    fireEvent.click(screen.getByTestId('onboarding-next'))

    // Enter email -> request code.
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), {
      target: { value: 'new@person.com' },
    })
    await act(async () => {
      fireEvent.click(screen.getByTestId('onboarding-email-send'))
    })
    expect(sendVerificationOtp).toHaveBeenCalledWith({
      email: 'new@person.com',
      type: 'sign-in',
    })

    // Enter code -> verify -> onComplete fires (the account is now created).
    fireEvent.change(screen.getByPlaceholderText('123456'), {
      target: { value: '123456' },
    })
    await act(async () => {
      fireEvent.click(screen.getByTestId('onboarding-email-verify'))
    })
    expect(signInEmailOtp).toHaveBeenCalledWith({
      email: 'new@person.com',
      otp: '123456',
    })
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1))
  })

  it('digit-strips the OTP and does not complete on a verify error', async () => {
    signInEmailOtp.mockResolvedValue({ error: { code: 'INVALID_OTP' } })
    const onComplete = vi.fn()
    render(<OnboardingFlow onComplete={onComplete} />)
    walkToLastStep()
    fireEvent.click(screen.getByTestId('onboarding-next'))
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), {
      target: { value: 'new@person.com' },
    })
    await act(async () => {
      fireEvent.click(screen.getByTestId('onboarding-email-send'))
    })
    // The input strips non-digits on change, so spacing never reaches state, but
    // the verify call also strips defensively — assert the clean 6 digits go out.
    fireEvent.change(screen.getByPlaceholderText('123456'), {
      target: { value: '1 2 3 4 5 6' },
    })
    await act(async () => {
      fireEvent.click(screen.getByTestId('onboarding-email-verify'))
    })
    expect(signInEmailOtp).toHaveBeenCalledWith({
      email: 'new@person.com',
      otp: '123456',
    })
    expect(onComplete).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toBeTruthy()
  })

  it('persists the draft to sessionStorage and restores it on remount', () => {
    const { unmount } = render(<OnboardingFlow onComplete={() => {}} />)
    walkToLastStep()
    // A draft exists in storage now (the effect mirrors every change; the empty
    // draft is written on mount).
    expect(window.sessionStorage.getItem('souso.onboarding.draft')).toBeTruthy()
    unmount()
    // Remount (an accidental reload): the draft is restored, the flow does not
    // throw, and storage is intact.
    render(<OnboardingFlow skipIntro onComplete={() => {}} />)
    expect(screen.getByTestId('onboarding-steps')).toBeTruthy()
    expect(window.sessionStorage.getItem('souso.onboarding.draft')).toBeTruthy()
  })

  it('starts directly on the steps when skipIntro is set', () => {
    render(<OnboardingFlow skipIntro onComplete={() => {}} />)
    expect(screen.getByTestId('onboarding-steps')).toBeTruthy()
    expect(screen.queryByTestId('onboarding-welcome')).toBeNull()
  })

  it('steps back from the first step to the welcome board', async () => {
    render(<OnboardingFlow onComplete={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Get started' }))
    expect(screen.getByTestId('onboarding-steps')).toBeTruthy()
    // The in-app Back arrow defers to the browser's Back (#371) so it shares one
    // path with the OS Back button; popstate is async, so wait for the transition.
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    await waitFor(() =>
      expect(screen.getByTestId('onboarding-welcome')).toBeTruthy(),
    )
  })

  /**
   * #371: the browser/OS Back button must step the form back ONE position, not
   * jump all the way to the intro. We simulate the browser Back by firing a
   * `popstate` carrying the previous position's history.state — exactly what the
   * browser delivers when the user taps Back after the shell pushed an entry per
   * forward move.
   */
  function browserBack() {
    // The browser moves the history pointer first, then dispatches popstate with
    // the now-current entry's state. JSDOM doesn't move the pointer, so we model
    // it by reading the index we're at, writing the previous index into
    // history.state, and firing popstate with it.
    const current = (window.history.state ?? {}) as { onboardingPos?: number }
    const prev = (current.onboardingPos ?? 0) - 1
    const prevState = prev >= 0 ? { onboardingPos: prev } : null
    act(() => {
      window.history.replaceState(prevState, '')
      window.dispatchEvent(new PopStateEvent('popstate', { state: prevState }))
    })
  }

  it('browser Back steps the form back one step, not to the intro (#371)', () => {
    render(<OnboardingFlow onComplete={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Get started' }))
    // Advance to step 3 (index 2).
    fireEvent.click(screen.getByTestId('onboarding-next'))
    fireEvent.click(screen.getByTestId('onboarding-next'))
    expect(screen.getByText(`3/${STEPS.length}`)).toBeTruthy()

    // Browser Back: must land on step 2, NOT bounce to the welcome board.
    browserBack()
    expect(screen.getByTestId('onboarding-steps')).toBeTruthy()
    expect(screen.getByText(`2/${STEPS.length}`)).toBeTruthy()
    expect(screen.queryByTestId('onboarding-welcome')).toBeNull()

    // One more Back -> step 1.
    browserBack()
    expect(screen.getByText(`1/${STEPS.length}`)).toBeTruthy()

    // Back from the first step -> the welcome board (intro).
    browserBack()
    expect(screen.getByTestId('onboarding-welcome')).toBeTruthy()
  })

  it('pushes a history entry per forward move so Back has somewhere to go (#371)', () => {
    const pushSpy = vi.spyOn(window.history, 'pushState')
    render(<OnboardingFlow onComplete={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Get started' }))
    fireEvent.click(screen.getByTestId('onboarding-next'))
    // Two forward moves (intro->step0, step0->step1) => two pushed entries, each
    // stamped with its linear position.
    const pushed = pushSpy.mock.calls.map(
      (c) => c[0] as { onboardingPos?: number } | null | undefined,
    )
    expect(pushed.some((s) => s?.onboardingPos === 1)).toBe(true)
    expect(pushed.some((s) => s?.onboardingPos === 2)).toBe(true)
    pushSpy.mockRestore()
  })
})
