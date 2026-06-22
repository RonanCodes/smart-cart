import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { usePushSubscription } from './use-push-subscription'

/**
 * State-machine tests for the shared push subscribe hook (#204). We mock the two
 * server fns and the browser-side push helpers, then drive Notification + the
 * service worker registration to walk every branch:
 *   unsupported / unconfigured / denied (browser-blocked) / idle -> subscribing -> subscribed.
 *
 * The onboarding step leans on these states to stay non-blocking, so the test that
 * matters most is "a denied / unsupported / unconfigured browser still lets the
 * user continue" — represented here by the hook settling on a terminal,
 * non-throwing state rather than ever rejecting.
 */

const getPushConfig = vi.fn()
const subscribePush = vi.fn()
const pushSupported = vi.fn()
const registerServiceWorker = vi.fn()

vi.mock('#/lib/push-server', () => ({
  getPushConfig: () => getPushConfig(),
  subscribePush: (...args: Array<unknown>) => subscribePush(...args),
}))

vi.mock('#/lib/push-client', () => ({
  pushSupported: () => pushSupported(),
  registerServiceWorker: () => registerServiceWorker(),
  // A real Uint8Array so the subscribe cast is exercised.
  urlBase64ToUint8Array: () => new Uint8Array([1, 2, 3]),
}))

/** A tiny probe component that surfaces the hook's state + enable() for the DOM. */
function Probe() {
  const { state, enable } = usePushSubscription()
  return (
    <div>
      <span data-testid="state">{state}</span>
      <button type="button" onClick={() => void enable()}>
        enable
      </button>
    </div>
  )
}

function setNotificationPermission(permission: NotificationPermission) {
  const requestPermission = vi.fn().mockResolvedValue('granted')
  // jsdom has no Notification; define a minimal stand-in.
  ;(globalThis as { Notification?: unknown }).Notification = {
    permission,
    requestPermission,
  }
  return requestPermission
}

function setServiceWorker(
  opts: {
    existingSubscription?: unknown
    subscribeResult?: unknown
  } = {},
) {
  const subscribe = vi
    .fn()
    .mockResolvedValue(
      opts.subscribeResult ?? { toJSON: () => ({ endpoint: 'https://x' }) },
    )
  const reg = {
    pushManager: {
      getSubscription: vi
        .fn()
        .mockResolvedValue(opts.existingSubscription ?? null),
      subscribe,
    },
  }
  ;(navigator as unknown as { serviceWorker: unknown }).serviceWorker = {
    getRegistration: vi.fn().mockResolvedValue(reg),
    register: vi.fn().mockResolvedValue(reg),
    ready: Promise.resolve(reg),
  }
  // The hook registers via the push-client helper, not navigator directly.
  registerServiceWorker.mockResolvedValue(reg)
  return { reg, subscribe }
}

beforeEach(() => {
  vi.clearAllMocks()
  pushSupported.mockReturnValue(true)
  getPushConfig.mockResolvedValue({ publicKey: 'KEY', configured: true })
  subscribePush.mockResolvedValue({ ok: true })
})

afterEach(() => {
  delete (globalThis as { Notification?: unknown }).Notification
})

describe('usePushSubscription', () => {
  it('settles on unsupported when the browser has no push', async () => {
    pushSupported.mockReturnValue(false)
    render(<Probe />)
    await waitFor(() =>
      expect(screen.getByTestId('state').textContent).toBe('unsupported'),
    )
    expect(getPushConfig).not.toHaveBeenCalled()
  })

  it('settles on unconfigured when the server has no VAPID key', async () => {
    getPushConfig.mockResolvedValue({ publicKey: null, configured: false })
    setServiceWorker()
    setNotificationPermission('default')
    render(<Probe />)
    await waitFor(() =>
      expect(screen.getByTestId('state').textContent).toBe('unconfigured'),
    )
  })

  it('settles on unconfigured (never throws) when getPushConfig resolves null (SOUSO-Z)', async () => {
    // On sign-in / page teardown the getPushConfig RPC can resolve to
    // null/undefined. Destructuring/reading `.publicKey` off that threw a
    // TypeError. The hook must degrade to a quiet terminal state, never throw.
    getPushConfig.mockResolvedValue(null)
    setServiceWorker()
    setNotificationPermission('default')
    render(<Probe />)
    await waitFor(() =>
      expect(screen.getByTestId('state').textContent).toBe('unconfigured'),
    )
  })

  it('settles on denied when notifications are browser-blocked', async () => {
    setServiceWorker()
    setNotificationPermission('denied')
    render(<Probe />)
    await waitFor(() =>
      expect(screen.getByTestId('state').textContent).toBe('denied'),
    )
  })

  it('reflects an existing subscription as subscribed without prompting', async () => {
    setServiceWorker({ existingSubscription: { endpoint: 'https://old' } })
    const requestPermission = setNotificationPermission('default')
    render(<Probe />)
    await waitFor(() =>
      expect(screen.getByTestId('state').textContent).toBe('subscribed'),
    )
    expect(requestPermission).not.toHaveBeenCalled()
  })

  it('walks idle -> subscribing -> subscribed on enable()', async () => {
    const { subscribe } = setServiceWorker()
    const requestPermission = setNotificationPermission('default')
    render(<Probe />)
    await waitFor(() =>
      expect(screen.getByTestId('state').textContent).toBe('idle'),
    )

    fireEvent.click(screen.getByText('enable'))

    await waitFor(() =>
      expect(screen.getByTestId('state').textContent).toBe('subscribed'),
    )
    expect(requestPermission).toHaveBeenCalledTimes(1)
    expect(subscribe).toHaveBeenCalledTimes(1)
    expect(subscribePush).toHaveBeenCalledTimes(1)
  })

  it('lands on denied (never throws) when enable() is refused', async () => {
    setServiceWorker()
    const requestPermission = setNotificationPermission('default')
    requestPermission.mockResolvedValue('denied')
    render(<Probe />)
    await waitFor(() =>
      expect(screen.getByTestId('state').textContent).toBe('idle'),
    )

    fireEvent.click(screen.getByText('enable'))

    await waitFor(() =>
      expect(screen.getByTestId('state').textContent).toBe('denied'),
    )
    // Never reached the server: a refusal short-circuits before subscribe.
    expect(subscribePush).not.toHaveBeenCalled()
  })

  it('lands on error (never throws) when the server store fails', async () => {
    setServiceWorker()
    setNotificationPermission('default')
    subscribePush.mockRejectedValue(new Error('boom'))
    render(<Probe />)
    await waitFor(() =>
      expect(screen.getByTestId('state').textContent).toBe('idle'),
    )

    fireEvent.click(screen.getByText('enable'))

    await waitFor(() =>
      expect(screen.getByTestId('state').textContent).toBe('error'),
    )
  })
})
