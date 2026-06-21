import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  isChunkLoadError,
  reloadOnceForChunkError,
  CHUNK_RELOAD_KEY,
} from './ErrorBoundary'

/**
 * #372: "OTP verify -> 'something went wrong'; a refresh fixes it." That symptom
 * (the generic ErrorBoundary "Something went wrong." copy + a manual refresh
 * recovering) is the STALE-CHUNK self-heal already fixed in #369: during the
 * launch-day deploy cadence the open tab's dynamic import() of the /week route
 * chunk fails after the build re-hashed, the boundary catches it, and a reload
 * picks up the new build.
 *
 * A GENUINE post-verify failure would NOT look like this: onboarding's
 * handleComplete wraps completeOnboarding + navigate in try/catch and surfaces
 * an INLINE "Could not build your week" retry, never the boundary, and a refresh
 * would re-fail rather than fix it. So #372 is fixed-by-#369; these tests lock
 * the self-heal that resolves it.
 */
beforeEach(() => {
  sessionStorage.clear()
  vi.restoreAllMocks()
})

describe('isChunkLoadError — the #372 "refresh fixes it" signature', () => {
  it('matches the cross-browser stale-chunk messages', () => {
    expect(
      isChunkLoadError(new Error('Importing a module script failed')),
    ).toBe(true) // iOS Safari
    expect(
      isChunkLoadError(
        new Error(
          'Failed to fetch dynamically imported module: /assets/week.js',
        ),
      ),
    ).toBe(true) // Chrome
    expect(isChunkLoadError(new Error('ChunkLoadError'))).toBe(true) // webpack
  })

  it('does NOT match a genuine app error (so a real bug still shows the boundary)', () => {
    expect(isChunkLoadError(new Error('Invalid OTP'))).toBe(false)
    expect(isChunkLoadError(new Error('Could not build your week'))).toBe(false)
    expect(isChunkLoadError(new Error('Load failed'))).toBe(false)
  })
})

describe('reloadOnceForChunkError — self-heal (#369) that fixes #372', () => {
  it('hard-reloads ONCE on a stale-chunk error, then is guarded against a loop', () => {
    const reload = vi.fn()
    vi.spyOn(window, 'location', 'get').mockReturnValue({
      ...window.location,
      reload,
    })

    const chunkErr = new Error('Importing a module script failed')
    // First crash post-verify: reload to the new build (the "refresh" the user
    // did manually pre-#369 now happens automatically).
    expect(reloadOnceForChunkError(chunkErr)).toBe(true)
    expect(reload).toHaveBeenCalledTimes(1)
    expect(sessionStorage.getItem(CHUNK_RELOAD_KEY)).toBe('1')

    // A second identical crash in the same episode must NOT loop.
    expect(reloadOnceForChunkError(chunkErr)).toBe(false)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('does NOT reload for a genuine (non-chunk) error', () => {
    const reload = vi.fn()
    vi.spyOn(window, 'location', 'get').mockReturnValue({
      ...window.location,
      reload,
    })

    expect(reloadOnceForChunkError(new Error('Invalid OTP'))).toBe(false)
    expect(reload).not.toHaveBeenCalled()
  })
})
