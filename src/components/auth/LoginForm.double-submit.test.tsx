import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { LoginForm } from './LoginForm'

/**
 * The "stuck on the login page" bug.
 *
 * `verify()` re-enabled the submit button (`setBusy(false)`) BEFORE awaiting
 * `confirmSession()`, which polls for up to 5 seconds before the hard navigation
 * to /app. On a slow connection the user therefore sees "Checking…" flip back to
 * "Sign in" with the page unchanged, taps Sign in again, and the second verify
 * runs against an OTP the first verify already consumed. Better Auth rejects it,
 * so the form shows "That code isn't right" and the user is left sitting on the
 * login page — while actually being signed in.
 *
 * The fix keeps the form busy until the navigation is issued, so a second submit
 * is impossible during the confirm window.
 */

const sendVerificationOtp = vi.fn()
const signInEmailOtp = vi.fn()
vi.mock('#/lib/auth-client', () => ({
  authClient: {
    emailOtp: {
      sendVerificationOtp: (...args: Array<unknown>) =>
        sendVerificationOtp(...args),
    },
    signIn: { emailOtp: (...args: Array<unknown>) => signInEmailOtp(...args) },
    getSession: () => Promise.resolve({ data: { user: { id: 'u1' } } }),
  },
}))

vi.mock('#/lib/log', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('#/lib/push-client', () => ({ promptForNotifications: vi.fn() }))
vi.mock('#/lib/analytics', () => ({
  track: vi.fn(),
  FUNNEL_EVENTS: { userLoggedIn: 'user_logged_in' },
}))

// A confirmSession we control, standing in for the real 5-second poll window.
let releaseConfirm: (ok: boolean) => void = () => {}
vi.mock('#/lib/confirm-session', () => ({
  confirmSession: () =>
    new Promise<boolean>((resolve) => {
      releaseConfirm = resolve
    }),
}))

beforeEach(() => {
  sendVerificationOtp.mockReset().mockResolvedValue({ error: null })
  signInEmailOtp.mockReset().mockResolvedValue({ error: null })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** Stub window.location so the success-path assignment doesn't throw in jsdom. */
function stubLocation(): { current: () => string } {
  let href = ''
  vi.stubGlobal('location', {
    get href() {
      return href
    },
    set href(v: string) {
      href = v
    },
  })
  return { current: () => href }
}

/** Drive the form to the code substep and submit `otp` once. */
async function reachCodeStepAndSubmit(otp: string) {
  fireEvent.change(screen.getByPlaceholderText('you@example.com'), {
    target: { value: 'torben@example.com' },
  })
  fireEvent.click(screen.getByRole('button', { name: /Email me a code/i }))
  const codeInput = await screen.findByPlaceholderText('123456')
  fireEvent.change(codeInput, { target: { value: otp } })
  fireEvent.click(screen.getByRole('button', { name: /^Sign in$/i }))
}

describe('LoginForm: no double-submit while the session is being confirmed', () => {
  it('keeps the submit button disabled until the navigation is issued', async () => {
    stubLocation()
    render(<LoginForm />)
    await reachCodeStepAndSubmit('123456')

    // The verify call is in flight -> confirmSession is pending (not released).
    await waitFor(() => expect(signInEmailOtp).toHaveBeenCalledTimes(1))

    const submit = await screen.findByRole<HTMLButtonElement>('button', {
      name: /Checking…|^Sign in$/i,
    })
    expect(
      submit.disabled,
      'the submit button must stay disabled while confirmSession is pending, ' +
        'otherwise the user taps again and burns the already-consumed OTP',
    ).toBe(true)

    releaseConfirm(true)
    await waitFor(() => expect(window.location.href).toBe('/app'))
  })

  it('ignores a second submit during the confirm window, so the consumed OTP is never re-sent', async () => {
    stubLocation()
    render(<LoginForm />)
    await reachCodeStepAndSubmit('123456')
    await waitFor(() => expect(signInEmailOtp).toHaveBeenCalledTimes(1))

    // The impatient tap: the user sees nothing happening and submits again.
    fireEvent.click(
      screen.getByRole('button', { name: /Checking…|^Sign in$/i }),
    )
    fireEvent.submit(screen.getByPlaceholderText('123456').closest('form')!)

    expect(
      signInEmailOtp,
      'a second verify would fail against the consumed OTP and strand the user ' +
        'on the login page with "That code isn\'t right"',
    ).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(/code isn't right/i)).toBeNull()

    releaseConfirm(true)
    await waitFor(() => expect(window.location.href).toBe('/app'))
  })
})
