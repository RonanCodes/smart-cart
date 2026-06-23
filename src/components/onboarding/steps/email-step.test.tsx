import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { EmailStep } from './email-step'

// #387 (the exact Sentry report): onboarding's email-step logged a wrong OTP
// (INVALID_OTP 400) as a Sentry exception. It must instead log a warn breadcrumb
// and surface the error inline; only an unexpected 5xx stays a Sentry error.

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
    // #414: verify() now confirms the session before handing off. Resolve a user
    // so confirmSession() returns immediately in these classification tests.
    getSession: () => Promise.resolve({ data: { user: { id: 'u1' } } }),
  },
}))

const logInfo = vi.fn()
const logWarn = vi.fn()
const logError = vi.fn()
vi.mock('#/lib/log', () => ({
  log: {
    info: (...args: Array<unknown>) => logInfo(...args),
    warn: (...args: Array<unknown>) => logWarn(...args),
    error: (...args: Array<unknown>) => logError(...args),
  },
}))

vi.mock('#/lib/push-client', () => ({ promptForNotifications: vi.fn() }))

const track = vi.fn()
vi.mock('#/lib/analytics', () => ({
  track: (...args: Array<unknown>) => track(...args),
  FUNNEL_EVENTS: { userLoggedIn: 'user_logged_in' },
}))

beforeEach(() => {
  sendVerificationOtp.mockReset().mockResolvedValue({ error: null })
  signInEmailOtp.mockReset().mockResolvedValue({ error: null })
  logInfo.mockReset()
  logWarn.mockReset()
  logError.mockReset()
  track.mockReset()
})

async function submitOtp(otp: string) {
  fireEvent.change(screen.getByPlaceholderText('you@example.com'), {
    target: { value: 'torben@example.com' },
  })
  fireEvent.click(screen.getByTestId('onboarding-email-send'))
  const codeInput = await screen.findByPlaceholderText('123456')
  fireEvent.change(codeInput, { target: { value: otp } })
  fireEvent.click(screen.getByTestId('onboarding-email-verify'))
}

describe('EmailStep verify-error classification (#387)', () => {
  it('logs a WRONG OTP (INVALID_OTP 400) as a warn breadcrumb, NOT a Sentry error', async () => {
    signInEmailOtp.mockResolvedValue({
      error: { code: 'INVALID_OTP', status: 400, message: 'Invalid OTP' },
    })
    render(<EmailStep onVerified={vi.fn()} />)
    await submitOtp('000000')

    await waitFor(() =>
      expect(logWarn).toHaveBeenCalledWith(
        'onboarding.otp_verify_failed',
        expect.objectContaining({ reason: 'invalid', status: 400 }),
      ),
    )
    expect(logError).not.toHaveBeenCalled()
    expect(await screen.findByText(/code isn't right/i)).toBeTruthy()
  })

  it('logs an unexpected 5xx verify failure as a Sentry error', async () => {
    signInEmailOtp.mockResolvedValue({
      error: { status: 500, message: 'Internal Server Error' },
    })
    render(<EmailStep onVerified={vi.fn()} />)
    await submitOtp('123456')

    await waitFor(() =>
      expect(logError).toHaveBeenCalledWith(
        'onboarding.otp_verify_failed',
        expect.objectContaining({ status: 500 }),
        expect.objectContaining({ reason: 'unknown', status: 500 }),
      ),
    )
    expect(logWarn).not.toHaveBeenCalled()
  })
})

describe('EmailStep — user_logged_in funnel event', () => {
  it('fires user_logged_in on a successful verify and calls onVerified', async () => {
    const onVerified = vi.fn()
    signInEmailOtp.mockResolvedValue({ error: null })
    render(<EmailStep onVerified={onVerified} />)
    await submitOtp('123456')

    await waitFor(() => expect(onVerified).toHaveBeenCalledTimes(1))
    expect(track).toHaveBeenCalledWith(
      'user_logged_in',
      expect.objectContaining({ source: 'onboarding' }),
    )
  })

  it('does NOT fire user_logged_in when verify fails', async () => {
    signInEmailOtp.mockResolvedValue({
      error: { code: 'INVALID_OTP', status: 400, message: 'Invalid OTP' },
    })
    render(<EmailStep onVerified={vi.fn()} />)
    await submitOtp('000000')
    await screen.findByText(/code isn't right/i)
    expect(track).not.toHaveBeenCalledWith('user_logged_in', expect.anything())
  })
})
