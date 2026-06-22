import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  isChunkLoadError,
  isRouteResolveRaceError,
  isRecoverableLoadError,
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

describe('isRouteResolveRaceError — the #416 SOUSO-T /week race signature', () => {
  it('matches the undefined route/match component reads on /week', () => {
    // Chrome's exact message in SOUSO-T: a TanStack Router match resolved before
    // its lazy route entry's options chunk was ready, so `route.options.component`
    // read `.component` off undefined inside the router's Match render.
    expect(
      isRouteResolveRaceError(
        new TypeError(
          "Cannot read properties of undefined (reading 'component')",
        ),
      ),
    ).toBe(true)
    // The same race one frame earlier reads `.options` off an undefined route.
    expect(
      isRouteResolveRaceError(
        new TypeError(
          "Cannot read properties of undefined (reading 'options')",
        ),
      ),
    ).toBe(true)
    // Safari/Firefox phrasings of the same undefined property read.
    expect(
      isRouteResolveRaceError(
        new TypeError(
          "undefined is not an object (evaluating 'route.options.component')",
        ),
      ),
    ).toBe(true)
    expect(
      isRouteResolveRaceError(new TypeError('route.options is undefined')),
    ).toBe(true)
  })

  it('does NOT match an unrelated "reading X" TypeError on some other property', () => {
    // A genuine app bug reading a different undefined property must still surface
    // the boundary, not silently reload-loop.
    expect(
      isRouteResolveRaceError(
        new TypeError("Cannot read properties of undefined (reading 'planId')"),
      ),
    ).toBe(false)
    expect(isRouteResolveRaceError(new Error('Invalid OTP'))).toBe(false)
  })
})

describe('isRecoverableLoadError — chunk family ∪ route-resolve race', () => {
  it('treats both the stale-chunk and the route-resolve race as recoverable', () => {
    expect(
      isRecoverableLoadError(new Error('Importing a module script failed')),
    ).toBe(true)
    expect(
      isRecoverableLoadError(
        new TypeError(
          "Cannot read properties of undefined (reading 'component')",
        ),
      ),
    ).toBe(true)
  })

  it('leaves a genuine app error non-recoverable', () => {
    expect(isRecoverableLoadError(new Error('Invalid OTP'))).toBe(false)
  })
})

describe('reloadOnceForChunkError — self-heal (#369, extended for #416)', () => {
  it('hard-reloads ONCE on the #416 route-resolve race, then is guarded', () => {
    const reload = vi.fn()
    vi.spyOn(window, 'location', 'get').mockReturnValue({
      ...window.location,
      reload,
    })

    const raceErr = new TypeError(
      "Cannot read properties of undefined (reading 'component')",
    )
    expect(reloadOnceForChunkError(raceErr)).toBe(true)
    expect(reload).toHaveBeenCalledTimes(1)
    // A second identical crash in the same episode must NOT loop.
    expect(reloadOnceForChunkError(raceErr)).toBe(false)
    expect(reload).toHaveBeenCalledTimes(1)
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
