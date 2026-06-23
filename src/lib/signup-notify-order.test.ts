import { describe, it, expect, vi, beforeEach } from 'vitest'
import { notifyAdminsOfNewUser } from './waitlist-notify'

// Reproduce-first (#521 follow-up): the admin new-signup email showed
// "Source: not provided" even when the user picked a source + referrer in the
// onboarding attribution step.
//
// ROOT CAUSE: notifyAdminsOfNewUser was called from TWO paths, both claiming the
// same claim-once `signup_notice` row:
//   (a) Better Auth's user.create.after hook — fires FIRST, synchronously at
//       account creation, WITHOUT attribution.
//   (b) completeOnboarding — fires just after, WITH attribution.
// The design assumed (b) claimed first, but (a) actually runs first, so the
// NO-attribution send won the claim and the attributed send was suppressed.
//
// This test simulates the REAL order: the hook path runs first (no attribution),
// THEN completeOnboarding runs with attribution. It asserts the admin email body
// shows the chosen source + referrer (NOT "not provided"), and that EXACTLY ONE
// admin email is sent across both paths.
//
// The hook path is modelled by calling notifyAdminsOfNewUser the way the
// user.create.after hook does (email + userId, no attribution); the onboarding
// path by the way completeOnboarding does (email + userId + attribution).

// A real `sendNewUserNotice` would build the body from the attribution, so the
// fake mirrors that: it records the body text it would send, derived from the
// pure newUserNoticeText (the same builder the real sender uses).
const sentEmails: Array<{ to: string; body: string }> = []

const resolveAdminEmails = vi.fn()
let storedPrefs: Array<{ email: string; waitlistNotify: boolean }> = []
let userCount = 0
// A single shared claim-once store, keyed by userId, shared across BOTH
// notifyAdminsOfNewUser calls so the second call sees the first's claim. This is
// the whole point: it models the real `signup_notice` table that dedups the two
// paths. A row present means the notice was already claimed.
let claimedUserIds: Set<string>

function buildFakeDb() {
  return {
    select: (cols: Record<string, unknown>) => ({
      from: async () => ('n' in cols ? [{ n: userCount }] : storedPrefs),
    }),
    // The claim-once insert chain: insert().values(row).onConflictDoNothing()
    // .returning(). It "wins" (returns the row) only if the userId is not yet
    // claimed; a second attempt on the same userId returns [] (conflict).
    insert: () => {
      let pendingUserId: string | null = null
      const chain = {
        values: (row: { userId?: string }) => {
          pendingUserId = row.userId ?? null
          return chain
        },
        onConflictDoNothing: () => chain,
        returning: async () => {
          if (!pendingUserId) return [{ userId: 'unkeyed' }]
          if (claimedUserIds.has(pendingUserId)) return []
          claimedUserIds.add(pendingUserId)
          return [{ userId: pendingUserId }]
        },
      }
      return chain
    },
  }
}

vi.mock('../db/client', () => ({ getDb: async () => buildFakeDb() }))
vi.mock('../db/auth-schema', () => ({
  user: { id: 'id-col', email: 'email-col' },
}))
vi.mock('../db/signup-notice-schema', () => ({
  signupNotice: { userId: 'user-id-col' },
}))
vi.mock('../db/admin-prefs-schema', () => ({
  adminNotificationPref: { email: 'email-col', waitlistNotify: 'notify-col' },
}))
vi.mock('./admin-emails', () => ({
  resolveAdminEmails: () => resolveAdminEmails(),
}))
vi.mock('./email', async () => {
  // Use the REAL body builder so the assertion exercises the attribution
  // threading end-to-end (not a hand-faked string).
  const { newUserNoticeText } = await import('./signup-attribution')
  return {
    sendNewUserNotice: (
      email: string,
      total: number,
      to: string,
      attribution?: Parameters<typeof newUserNoticeText>[2],
    ) => {
      sentEmails.push({
        to,
        body: newUserNoticeText(email, total, attribution),
      })
      return Promise.resolve({ sent: true })
    },
    sendMilestoneEmail: vi.fn().mockResolvedValue({ sent: true }),
  }
})

describe('new-signup admin email — real two-path order (#521)', () => {
  beforeEach(() => {
    sentEmails.length = 0
    resolveAdminEmails.mockReset().mockResolvedValue(['admin@souso.app'])
    storedPrefs = []
    userCount = 7
    claimedUserIds = new Set()
  })

  it('shows the chosen source + referrer and sends exactly ONE email, even though the no-attribution hook path runs first', async () => {
    const userId = 'user-abc'

    // (a) The user.create.after hook fires FIRST, with NO attribution. It passes
    // fromHook: true (a non-pre-empting fallback) exactly as src/lib/auth.ts does.
    await notifyAdminsOfNewUser({
      email: 'cook@example.com',
      userId,
      fromHook: true,
    })

    // (b) completeOnboarding fires just after, WITH the chosen attribution.
    await notifyAdminsOfNewUser({
      email: 'cook@example.com',
      userId,
      attribution: { source: 'linkedin', sourceOther: null, referrer: 'SPOCK' },
    })

    // Exactly one admin email across both paths.
    expect(sentEmails).toHaveLength(1)

    // And that one email carries the chosen source + referrer, not the default.
    const body = sentEmails[0]!.body
    expect(body).toContain('LinkedIn')
    expect(body).toContain('SPOCK')
    expect(body).not.toContain('not provided')
  })
})
