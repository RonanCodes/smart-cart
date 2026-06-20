import { describe, it, expect, vi, beforeEach } from 'vitest'
import { addUnapprovedEmailToWaitlist } from './waitlist-gate'

// A stand-in for the real D1-backed waitlist table. upsertWaitlistEmail now
// decides new-vs-existing by a SELECT-before-insert (it no longer trusts
// .returning(), which is why this fake's .returning() always resolves [], the
// way real D1 behaves on a genuine insert). Each gate call upserts exactly one
// email and beforeEach clears the store, so presence == "store already holds an
// email", which the SELECT reports.
const fakeStore = new Set<string>()
function buildFakeDb() {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          // SELECT-before-insert: a non-empty store means the email under test
          // was already inserted by an earlier call => existing, not new.
          limit: async () => (fakeStore.size > 0 ? [{ id: 'existing' }] : []),
        }),
      }),
    }),
    insert: () => ({
      values: (row: { id: string; email: string }) => ({
        onConflictDoNothing: () => ({
          returning: async () => {
            // Real D1 often returns [] even on a genuine insert , model that so
            // the new flag can never accidentally lean on .returning().
            fakeStore.add(row.email)
            return []
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

// Spy on the admin-notify path so we can assert the gate fires it on a new row
// (and NOT on a duplicate) without touching Resend.
const notifyAdminsOfSignup = vi.fn().mockResolvedValue(undefined)
vi.mock('./waitlist-notify', () => ({
  notifyAdminsOfSignup: (email: string) => notifyAdminsOfSignup(email),
}))

describe('addUnapprovedEmailToWaitlist (sign-in gate side-write)', () => {
  beforeEach(() => {
    fakeStore.clear()
    notifyAdminsOfSignup.mockClear()
  })

  it('inserts an unapproved email on first sign-in attempt', async () => {
    const result = await addUnapprovedEmailToWaitlist('new@user.com')
    expect(result).toEqual({ ok: true, inserted: true })
    expect(fakeStore.has('new@user.com')).toBe(true)
  })

  it('notifies admins on a genuinely new row (login-gate path)', async () => {
    await addUnapprovedEmailToWaitlist('new@user.com')
    expect(notifyAdminsOfSignup).toHaveBeenCalledTimes(1)
    expect(notifyAdminsOfSignup).toHaveBeenCalledWith('new@user.com')
  })

  it('does NOT notify admins on a duplicate sign-in attempt', async () => {
    await addUnapprovedEmailToWaitlist('new@user.com')
    notifyAdminsOfSignup.mockClear()
    await addUnapprovedEmailToWaitlist('new@user.com')
    expect(notifyAdminsOfSignup).not.toHaveBeenCalled()
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
