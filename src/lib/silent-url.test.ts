import { afterEach, describe, expect, it, vi } from 'vitest'
import { replaceUrlSilently } from './silent-url'

/**
 * Reproduces #week-swap-skeleton: TanStack Router's browser history patches
 * `window.history.replaceState` on the instance to observe URL changes and
 * notify its subscribers (which re-runs the route loader → full-page skeleton).
 * `replaceUrlSilently` must bypass that patch by calling the native prototype
 * method, so an in-place swap updates the URL without waking the router.
 */
describe('replaceUrlSilently', () => {
  const nativeProto = Object.getPrototypeOf(window.history) as History

  afterEach(() => {
    // Restore the instance method after each test (we shadow it to mimic the
    // router patch).
    delete (window.history as unknown as Record<string, unknown>).replaceState
    window.history.replaceState(window.history.state, '', '/')
  })

  it('updates the address bar', () => {
    replaceUrlSilently('/week?plan=p123')
    expect(window.location.search).toBe('?plan=p123')
  })

  it('does NOT trigger the router-style instance patch (the skeleton bug)', () => {
    // Mimic exactly what @tanstack/history does: replace the OWN property on
    // window.history with a wrapper that notifies subscribers on every call.
    const subscriber = vi.fn()
    const original = nativeProto.replaceState
    Object.defineProperty(window.history, 'replaceState', {
      configurable: true,
      writable: true,
      value: function patched(
        this: History,
        ...args: Parameters<History['replaceState']>
      ) {
        original.apply(this, args)
        subscriber('REPLACE')
      },
    })

    // A naive raw call would notify (the bug we are fixing) ...
    window.history.replaceState(window.history.state, '', '/week?plan=raw')
    expect(subscriber).toHaveBeenCalledTimes(1)

    // ... but replaceUrlSilently goes around the patch via the prototype, so the
    // router subscriber is NOT fired and the loader never re-runs.
    subscriber.mockClear()
    replaceUrlSilently('/week?plan=silent')
    expect(subscriber).not.toHaveBeenCalled()
    expect(window.location.search).toBe('?plan=silent')
  })
})
