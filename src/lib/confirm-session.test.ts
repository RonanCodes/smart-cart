import { describe, it, expect, vi, beforeEach } from 'vitest'
import { confirmSession } from './confirm-session'

// #414: the cookie commit races the navigation on iOS Safari. confirmSession
// polls authClient.getSession() until a user resolves, so the caller only
// navigates once the session cookie is readable.

const getSession = vi.fn()
vi.mock('#/lib/auth-client', () => ({
  authClient: {
    getSession: (...args: Array<unknown>) => getSession(...args),
  },
}))

beforeEach(() => {
  getSession.mockReset()
})

describe('confirmSession (#414 Set-Cookie race)', () => {
  it('returns true immediately when the session already has a user', async () => {
    getSession.mockResolvedValue({ data: { user: { id: 'u1' } } })
    const ok = await confirmSession()
    expect(ok).toBe(true)
    expect(getSession).toHaveBeenCalledTimes(1)
  })

  it('polls until getSession resolves a user (cookie commits a tick late)', async () => {
    getSession
      .mockResolvedValueOnce({ data: null })
      .mockResolvedValueOnce({ data: { user: null } })
      .mockResolvedValueOnce({ data: { user: { id: 'u1' } } })
    const ok = await confirmSession({ intervalMs: 1 })
    expect(ok).toBe(true)
    expect(getSession).toHaveBeenCalledTimes(3)
  })

  it('treats a getSession error as "not yet" and keeps polling (never throws)', async () => {
    getSession
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ data: { user: { id: 'u1' } } })
    const ok = await confirmSession({ intervalMs: 1 })
    expect(ok).toBe(true)
  })

  it('gives up (returns false) after the timeout so the UI never hangs', async () => {
    getSession.mockResolvedValue({ data: { user: null } })
    const ok = await confirmSession({ timeoutMs: 20, intervalMs: 5 })
    expect(ok).toBe(false)
  })
})
