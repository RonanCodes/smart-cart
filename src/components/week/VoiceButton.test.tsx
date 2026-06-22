import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { createRef } from 'react'
import { VoiceButton } from './VoiceButton'
import type { VoiceButtonHandle } from './VoiceButton'

/**
 * Regression for #415 (Sentry SOUSO-W): a VAPI `start()` whose underlying Daily
 * call handle is `null` throws "Cannot read properties of null (reading 'join')"
 * from inside the SDK. We don't control the SDK internals, but the start path
 * MUST NOT let that crash the page: a failed/cancelled start has to degrade to a
 * handled "voice unavailable" error state, release the live lock, and never
 * surface as an unhandled error.
 */

// A controllable fake Vapi instance. `start` behaviour is swapped per test.
let startImpl: () => Promise<void>
const handlers = new Map<string, (arg?: unknown) => void>()

// Must be a real class — VoiceButton constructs it with `new`, and a vi.fn()
// arrow implementation cannot be used as a constructor.
const FakeVapi = vi.fn(function FakeVapiCtor(this: Record<string, unknown>) {
  this.on = (evt: string, cb: (arg?: unknown) => void) => {
    handlers.set(evt, cb)
  }
  this.start = vi.fn(() => startImpl())
  this.stop = vi.fn()
})

vi.mock('@vapi-ai/web', () => ({ default: FakeVapi }))

// Mint always succeeds — the bug is in the SDK start, not the token route.
function mockTokenOk() {
  globalThis.fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ ok: true, token: 'tok_test', assistantOverrides: {} }),
  })) as unknown as typeof fetch
}

describe('VoiceButton start() with a null Daily call handle (#415)', () => {
  beforeEach(() => {
    handlers.clear()
    FakeVapi.mockClear()
    mockTokenOk()
  })
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('does NOT throw an unhandled error when start() rejects with the null .join error', async () => {
    startImpl = () =>
      Promise.reject(
        new TypeError("Cannot read properties of null (reading 'join')"),
      )

    const onLiveChange = vi.fn()
    const ref = createRef<VoiceButtonHandle>()
    render(
      <VoiceButton ref={ref} planId="plan_1" onLiveChange={onLiveChange} />,
    )
    await waitFor(() => expect(FakeVapi).toHaveBeenCalled())

    // Driving start() must not throw, and must resolve to a handled error state.
    await act(async () => {
      ref.current?.start()
    })

    await waitFor(() =>
      expect(screen.getByText(/voice unavailable|try again/i)).toBeTruthy(),
    )
    // The live lock must be released so the rest of the week UI is usable again.
    expect(onLiveChange).toHaveBeenLastCalledWith(false)
  })

  it('handles a SYNCHRONOUS throw from start() (SDK throws before returning a promise)', async () => {
    startImpl = () => {
      throw new TypeError("Cannot read properties of null (reading 'join')")
    }

    const onLiveChange = vi.fn()
    const ref = createRef<VoiceButtonHandle>()
    render(
      <VoiceButton ref={ref} planId="plan_1" onLiveChange={onLiveChange} />,
    )
    await waitFor(() => expect(FakeVapi).toHaveBeenCalled())

    await act(async () => {
      ref.current?.start()
    })

    await waitFor(() =>
      expect(screen.getByText(/voice unavailable|try again/i)).toBeTruthy(),
    )
    expect(onLiveChange).toHaveBeenLastCalledWith(false)
  })

  it("the SDK 'error' event during connect releases the live lock (does not leave the week frozen)", async () => {
    // start() never resolves (connecting), then the SDK fires its async error
    // event carrying the daily-call-join-error.
    startImpl = () => new Promise<void>(() => {})

    const onLiveChange = vi.fn()
    const ref = createRef<VoiceButtonHandle>()
    render(
      <VoiceButton ref={ref} planId="plan_1" onLiveChange={onLiveChange} />,
    )
    await waitFor(() => expect(FakeVapi).toHaveBeenCalled())

    await act(async () => {
      ref.current?.start()
    })

    // SDK fires its error event (the null .join path surfaces here too).
    await act(async () => {
      handlers.get('error')?.({
        type: 'daily-call-join-error',
        error: { message: "Cannot read properties of null (reading 'join')" },
      })
    })

    await waitFor(() => expect(onLiveChange).toHaveBeenLastCalledWith(false))
  })
})
