import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// #414 (CRITICAL): on iOS Safari an existing user enters the correct OTP and is
// bounced back to /sign-in. Root cause: verify() synchronously hard-navigates to
// /week in the SAME tick as the verify success, before the session Set-Cookie has
// committed, so the _authed guard sees no cookie and redirects to /sign-in.
//
// These tests lock the fix: verify() must NOT navigate until the session is
// confirmed (getSession resolves a user), and promptForNotifications must NOT run
// before the navigation (it raced the cookie commit and threw SOUSO-Z).

const signInEmailOtp = vi.fn()
const getSession = vi.fn()
vi.mock('#/lib/auth-client', () => ({
  authClient: {
    emailOtp: {
      sendVerificationOtp: vi.fn().mockResolvedValue({ error: null }),
    },
    signIn: { emailOtp: (...a: Array<unknown>) => signInEmailOtp(...a) },
    getSession: (...a: Array<unknown>) => getSession(...a),
  },
}))

vi.mock('#/lib/log', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const promptForNotifications = vi.fn()
vi.mock('#/lib/push-client', () => ({
  promptForNotifications: (...a: Array<unknown>) =>
    promptForNotifications(...a),
}))

// Avoid TanStack router needing a real route tree at import time.
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (opts: unknown) => opts,
}))

// eslint-disable-next-line import/first -- must import after the vi.mock calls above
import { SignIn } from '#/routes/sign-in'

let assign: ReturnType<typeof vi.fn>

beforeEach(() => {
  signInEmailOtp.mockReset().mockResolvedValue({ error: null })
  getSession.mockReset()
  promptForNotifications.mockReset()
  assign = vi.fn()
  // The component hard-navigates via window.location. Replace it with a spy so the
  // jsdom "Not implemented: navigation" noise is gone and we can assert ordering.
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { origin: 'https://souso.app', href: '', assign },
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

async function submitOtp() {
  fireEvent.change(screen.getByPlaceholderText('you@example.com'), {
    target: { value: 'ada@example.com' },
  })
  fireEvent.click(screen.getByRole('button', { name: /email me a code/i }))
  const code = await screen.findByPlaceholderText('123456')
  fireEvent.change(code, { target: { value: '145284' } })
  fireEvent.click(screen.getByRole('button', { name: /sign in/i }))
}

function navigated() {
  return assign.mock.calls.length > 0 || window.location.href === '/week'
}

describe('sign-in verify() waits for the session before navigating (#414)', () => {
  it('does NOT navigate to /week until getSession resolves a user', async () => {
    // getSession returns no user the first time (cookie not committed yet), then a
    // user (cookie committed). Navigation must hold for the second.
    getSession
      .mockResolvedValueOnce({ data: { user: null } })
      .mockResolvedValue({ data: { user: { id: 'u1' } } })

    render(<SignIn />)
    await submitOtp()

    // Verify resolved, but the FIRST getSession had no user — must not navigate yet.
    await waitFor(() => expect(signInEmailOtp).toHaveBeenCalled())
    expect(navigated()).toBe(false)

    // Once getSession resolves a user, navigation proceeds.
    await waitFor(() => expect(navigated()).toBe(true))
  })

  it('does NOT call promptForNotifications before the navigation is decided', async () => {
    // Hold the session unconfirmed so we can observe ordering: prompt must not have
    // fired while navigation is still pending on the cookie.
    getSession.mockResolvedValue({ data: { user: null } })

    render(<SignIn />)
    await submitOtp()

    await waitFor(() => expect(signInEmailOtp).toHaveBeenCalled())
    // The bug fired `void promptForNotifications()` synchronously before the
    // redirect. The fix moves it off the verify tick (after the session is
    // confirmed), so with an unconfirmed session it must NOT have run yet.
    expect(promptForNotifications).not.toHaveBeenCalled()
    expect(navigated()).toBe(false)
  })

  it('navigates to /week after a confirmed session (happy path)', async () => {
    getSession.mockResolvedValue({ data: { user: { id: 'u1' } } })
    render(<SignIn />)
    await submitOtp()
    await waitFor(() => expect(navigated()).toBe(true))
  })

  it('does not navigate when the OTP verify fails', async () => {
    signInEmailOtp.mockResolvedValue({
      error: { code: 'INVALID_OTP', status: 400, message: 'Invalid OTP' },
    })
    render(<SignIn />)
    await submitOtp()
    await waitFor(() => expect(signInEmailOtp).toHaveBeenCalled())
    // A failed verify returns early: no session confirm, no navigation.
    expect(navigated()).toBe(false)
  })
})
