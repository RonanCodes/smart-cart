import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { log } from './log'
import { TRACE_STORAGE_KEY, isTraceId } from './trace'

/**
 * The trace id propagation (diagnose canon): every CLIENT log line must carry the
 * per-session `traceId`, so the line, its `/api/log` re-emit, the Sentry event,
 * and the PostHog event for one flow all share it. An explicit per-call traceId
 * still wins. Logging must never throw into the app.
 */
describe('log trace propagation (client)', () => {
  let infoSpy: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    window.sessionStorage.clear()
    infoSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })
  afterEach(() => {
    infoSpy.mockRestore()
  })

  function lastEmitted(): Record<string, unknown> {
    const line = infoSpy.mock.calls.at(-1)?.[0] as string
    return JSON.parse(line) as Record<string, unknown>
  }

  it('attaches a valid session traceId to a client log line', () => {
    log.info('test.event')
    const entry = lastEmitted()
    expect(isTraceId(entry.traceId)).toBe(true)
    expect(window.sessionStorage.getItem(TRACE_STORAGE_KEY)).toBe(entry.traceId)
  })

  it('reuses the same traceId across calls', () => {
    log.info('a')
    const first = lastEmitted().traceId
    log.info('b')
    const second = lastEmitted().traceId
    expect(first).toBe(second)
  })

  it('lets an explicit per-call traceId win', () => {
    log.info('c', { traceId: 'explicit-trace' })
    expect(lastEmitted().traceId).toBe('explicit-trace')
  })

  it('never throws when sessionStorage is blocked', () => {
    const getItem = vi
      .spyOn(Storage.prototype, 'getItem')
      .mockImplementation(() => {
        throw new Error('blocked')
      })
    try {
      expect(() => log.info('d')).not.toThrow()
    } finally {
      getItem.mockRestore()
    }
  })
})
