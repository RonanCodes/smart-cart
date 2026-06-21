import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { LoginForm } from './LoginForm'

// Better Auth client + the logger are the two collaborators we assert on: the
// form should ALWAYS log the entered email when an OTP is requested (not only on
// failure), so an OTP delivery issue (e.g. Android autofill) is traceable.
const sendVerificationOtp = vi.fn()
vi.mock('#/lib/auth-client', () => ({
  authClient: {
    emailOtp: {
      sendVerificationOtp: (...args: Array<unknown>) =>
        sendVerificationOtp(...args),
    },
    signIn: { emailOtp: vi.fn() },
  },
}))

const logInfo = vi.fn()
const logError = vi.fn()
vi.mock('#/lib/log', () => ({
  log: {
    info: (...args: Array<unknown>) => logInfo(...args),
    error: (...args: Array<unknown>) => logError(...args),
  },
}))

vi.mock('#/lib/push-client', () => ({ promptForNotifications: vi.fn() }))

beforeEach(() => {
  sendVerificationOtp.mockReset().mockResolvedValue({ error: null })
  logInfo.mockReset()
  logError.mockReset()
})

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
