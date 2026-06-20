import { describe, it, expect, vi, beforeEach } from 'vitest'
import { addUnapprovedEmailToWaitlist } from './waitlist-gate'

// A stand-in for the real D1-backed waitlist table that enforces the unique
// email constraint the way onConflictDoNothing does: the FIRST insert of an
// email returns the new row; a repeat insert is a no-op that returns []. This
// lets the idempotency test mirror real DB behaviour instead of asserting on a
// hand-fed return value.
const fakeStore = new Set<string>()
function buildFakeDb() {
  return {
    insert: () => ({
      values: (row: { id: string; email: string }) => ({
        onConflictDoNothing: () => ({
          returning: async () => {
            if (fakeStore.has(row.email)) return []
            fakeStore.add(row.email)
            return [{ id: row.id }]
          },
        }),
      }),
    }),
  }
}

// Mock the server-only DB client that addUnapprovedEmailToWaitlist imports
// dynamically, so the test never touches a real D1 binding.
vi.mock('../db/client', () => ({
  getDb: async () => buildFakeDb(),
}))

describe('addUnapprovedEmailToWaitlist (sign-in gate side-write)', () => {
  beforeEach(() => {
    fakeStore.clear()
  })

  it('inserts an unapproved email on first sign-in attempt', async () => {
    const result = await addUnapprovedEmailToWaitlist('new@user.com')
    expect(result).toEqual({ ok: true, inserted: true })
    expect(fakeStore.has('new@user.com')).toBe(true)
  })

  it('normalises (trim + lowercase) so dupes do not pile up', async () => {
    await addUnapprovedEmailToWaitlist('  New@User.COM ')
    expect(fakeStore.has('new@user.com')).toBe(true)
    expect(fakeStore.size).toBe(1)
  })

  it('is idempotent: a second attempt by the same email does not duplicate', async () => {
    const first = await addUnapprovedEmailToWaitlist('new@user.com')
    const second = await addUnapprovedEmailToWaitlist('new@user.com')
    expect(first.inserted).toBe(true)
    expect(second.inserted).toBe(false)
    expect(fakeStore.size).toBe(1)
  })

  it('is non-fatal: a bad email is swallowed, never thrown', async () => {
    const result = await addUnapprovedEmailToWaitlist('not-an-email')
    expect(result).toEqual({ ok: false, inserted: false })
    expect(fakeStore.size).toBe(0)
  })
})
