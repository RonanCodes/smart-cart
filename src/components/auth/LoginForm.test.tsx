import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { LoginForm } from './LoginForm'

// Better Auth client + the logger are the two collaborators we assert on: the
// form should ALWAYS log the entered email when an OTP is requested (not only on
// failure), so an OTP delivery issue (e.g. Android autofill) is traceable.
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
    // #414: verify() confirms the session before navigating; resolve a user so
    // confirmSession() returns immediately.
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

beforeEach(() => {
  sendVerificationOtp.mockReset().mockResolvedValue({ error: null })
  signInEmailOtp.mockReset().mockResolvedValue({ error: null })
  logInfo.mockReset()
  logWarn.mockReset()
  logError.mockReset()
})

/** Drive the form to the code substep and submit `otp`. */
async function submitOtp(otp: string) {
  fireEvent.change(screen.getByPlaceholderText('you@example.com'), {
    target: { value: 'torben@example.com' },
  })
  fireEvent.click(screen.getByRole('button', { name: /Email me a code/i }))
  const codeInput = await screen.findByPlaceholderText('123456')
  fireEvent.change(codeInput, { target: { value: otp } })
  fireEvent.click(screen.getByRole('button', { name: /^Sign in$/i }))
}

describe('LoginForm OTP request logging', () => {
  it('logs the entered email on a successful OTP request', async () => {
    render(<LoginForm />)
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), {
      target: { value: 'torben@example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Email me a code/i }))

    await waitFor(() =>
      expect(logInfo).toHaveBeenCalledWith(
        'auth.otp_requested',
        expect.objectContaining({ email: 'torben@example.com' }),
      ),
    )
    // The send itself still fired with the same email.
    expect(sendVerificationOtp).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'torben@example.com' }),
    )
  })
})

describe('LoginForm verify-error classification (#387)', () => {
  it('logs a WRONG OTP (INVALID_OTP 400) as a warn breadcrumb, NOT a Sentry error', async () => {
    signInEmailOtp.mockResolvedValue({
      error: { code: 'INVALID_OTP', status: 400, message: 'Invalid OTP' },
    })
    render(<LoginForm />)
    await submitOtp('000000')

    await waitFor(() =>
      expect(logWarn).toHaveBeenCalledWith(
        'auth.client_verify_failed',
        expect.objectContaining({ reason: 'invalid', status: 400 }),
      ),
    )
    // A handled 400 must NOT reach Sentry as an exception.
    expect(logError).not.toHaveBeenCalled()
    // Still surfaced inline to the user.
    expect(await screen.findByText(/code isn't right/i)).toBeTruthy()
  })

  it('logs an unexpected 5xx verify failure as a Sentry error', async () => {
    signInEmailOtp.mockResolvedValue({
      error: { status: 500, message: 'Internal Server Error' },
    })
    render(<LoginForm />)
    await submitOtp('123456')

    await waitFor(() =>
      expect(logError).toHaveBeenCalledWith(
        'auth.client_verify_failed',
        expect.objectContaining({ status: 500 }),
        expect.objectContaining({ reason: 'unknown', status: 500 }),
      ),
    )
    expect(logWarn).not.toHaveBeenCalled()
  })
})
