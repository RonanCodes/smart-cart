import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { ErrorBoundary } from './ErrorBoundary'

/**
 * The crash-screen feedback affordance. A user who hits the global error boundary
 * ("something went wrong") can now tell us what they were doing via the shared
 * FeedbackForm, tagged source 'error-boundary'. These lock that the button is
 * present on the fallback and opens the feedback sheet.
 */

// FeedbackForm reads the session and (on submit) hits server fns + Sentry; stub
// all three so this stays a pure UI assertion.
const useSession = vi.fn().mockReturnValue({ data: null })
vi.mock('#/lib/auth-client', () => ({
  useSession: () => useSession(),
}))
vi.mock('#/lib/app-feedback-server', () => ({
  submitFeedback: vi.fn().mockResolvedValue({ ok: true }),
}))
vi.mock('#/lib/observability-client', () => ({
  captureSentryFeedback: vi.fn(),
}))
// The boundary logs the caught error + captures it to Sentry; silence both so the
// test output stays clean and no real sink fires.
vi.mock('#/lib/log', () => ({ log: { error: vi.fn() } }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

function Boom(): never {
  throw new Error('kaboom')
}

beforeEach(() => {
  // The boundary logs a console.error on the caught error in React's dev path;
  // keep the test output quiet.
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('ErrorBoundary feedback affordance on the crash screen', () => {
  it('renders the "something is not right? tell us" trigger on the fallback', () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    )
    expect(screen.getByText('Something went wrong.')).toBeTruthy()
    expect(
      screen.getByRole('button', { name: /something is not right/i }),
    ).toBeTruthy()
  })

  it('opens the feedback form in a sheet when the trigger is tapped', () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    )
    // The sheet (and the form) are not mounted until the trigger is tapped.
    expect(screen.queryByLabelText('Your feedback')).toBeNull()

    fireEvent.click(
      screen.getByRole('button', { name: /something is not right/i }),
    )

    // The shared FeedbackForm is now on screen inside the sheet.
    expect(screen.getByLabelText('Your feedback')).toBeTruthy()
    expect(screen.getByRole('button', { name: /send feedback/i })).toBeTruthy()
  })
})
