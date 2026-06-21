import { describe, it, expect } from 'vitest'
import {
  isIgnorableNetworkError,
  shouldDropSentryEvent,
} from './ignorable-error'

/**
 * SOUSO-A/Y/X (#417): a TanStack `createServerFn` fetch rejects with
 * `TypeError: Load failed` (iOS Safari) / `TypeError: Failed to fetch`
 * (Chromium) when the user navigates away mid-flight, backgrounds the tab, or
 * loses connectivity. Same story for an `AbortError` from an aborted fetch.
 *
 * These are expected network/abort blips, not actionable app crashes, so they
 * were burying the real Sentry signal. `isIgnorableNetworkError` is the pure
 * predicate both the client `beforeSend` and the server forward use to drop
 * them. It must be PRECISE: only the known-benign patterns, never a real error.
 */
describe('isIgnorableNetworkError', () => {
  it('drops "Load failed" (iOS Safari aborted fetch)', () => {
    expect(isIgnorableNetworkError(new TypeError('Load failed'))).toBe(true)
  })

  it('drops "Failed to fetch" (Chromium network drop / navigation abort)', () => {
    expect(isIgnorableNetworkError(new TypeError('Failed to fetch'))).toBe(true)
  })

  it('drops a DOMException-style AbortError', () => {
    const err = new Error('The operation was aborted.')
    err.name = 'AbortError'
    expect(isIgnorableNetworkError(err)).toBe(true)
  })

  it('drops a value that explicitly signals an aborted request', () => {
    const err = new Error('The user aborted a request.')
    err.name = 'AbortError'
    expect(isIgnorableNetworkError(err)).toBe(true)
  })

  it('drops the serialised { name, message } shape log.ts ships', () => {
    expect(
      isIgnorableNetworkError({ name: 'TypeError', message: 'Load failed' }),
    ).toBe(true)
    expect(
      isIgnorableNetworkError({ name: 'AbortError', message: 'aborted' }),
    ).toBe(true)
  })

  it('drops "NetworkError when attempting to fetch resource" (Firefox)', () => {
    expect(
      isIgnorableNetworkError(
        new TypeError('NetworkError when attempting to fetch resource.'),
      ),
    ).toBe(true)
  })

  it('KEEPS a genuine application error', () => {
    expect(
      isIgnorableNetworkError(new Error('Cannot read properties of undefined')),
    ).toBe(false)
    expect(isIgnorableNetworkError(new TypeError('week is not iterable'))).toBe(
      false,
    )
  })

  it('KEEPS an error whose message merely mentions "load" elsewhere', () => {
    expect(
      isIgnorableNetworkError(new Error('Failed to load week plan from D1')),
    ).toBe(false)
  })

  it('never throws on awkward / non-error input, and treats it as a real error', () => {
    expect(() => isIgnorableNetworkError(null)).not.toThrow()
    expect(() => isIgnorableNetworkError(undefined)).not.toThrow()
    expect(() => isIgnorableNetworkError(42)).not.toThrow()
    expect(isIgnorableNetworkError(null)).toBe(false)
    expect(isIgnorableNetworkError('Load failed')).toBe(true)
  })
})

/**
 * `shouldDropSentryEvent` is the `beforeSend` predicate: it maps a Sentry
 * event's exception `{ type, value }` onto the benign-network check, so the
 * SDK's auto-captured `TypeError: Load failed` from a createServerFn fetch is
 * dropped while a real error event still reports.
 */
describe('shouldDropSentryEvent', () => {
  it('drops a Load failed / Failed to fetch exception event', () => {
    expect(
      shouldDropSentryEvent({
        exception: { values: [{ type: 'TypeError', value: 'Load failed' }] },
      }),
    ).toBe(true)
    expect(
      shouldDropSentryEvent({
        exception: {
          values: [{ type: 'TypeError', value: 'Failed to fetch' }],
        },
      }),
    ).toBe(true)
  })

  it('drops an AbortError exception event', () => {
    expect(
      shouldDropSentryEvent({
        exception: {
          values: [{ type: 'AbortError', value: 'The operation was aborted.' }],
        },
      }),
    ).toBe(true)
  })

  it('KEEPS a real exception event', () => {
    expect(
      shouldDropSentryEvent({
        exception: {
          values: [{ type: 'TypeError', value: 'week is not iterable' }],
        },
      }),
    ).toBe(false)
  })

  it('KEEPS an event with no exception (e.g. a message / transaction)', () => {
    expect(shouldDropSentryEvent({})).toBe(false)
    expect(shouldDropSentryEvent(undefined)).toBe(false)
    expect(shouldDropSentryEvent({ exception: { values: [] } })).toBe(false)
  })

  it('KEEPS a multi-exception event where one is a real error', () => {
    expect(
      shouldDropSentryEvent({
        exception: {
          values: [
            { type: 'TypeError', value: 'Load failed' },
            { type: 'TypeError', value: 'week is not iterable' },
          ],
        },
      }),
    ).toBe(false)
  })

  it('never throws on awkward input', () => {
    expect(() =>
      shouldDropSentryEvent({ exception: { values: undefined } }),
    ).not.toThrow()
  })
})
