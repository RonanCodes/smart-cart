import { describe, it, expect, vi, beforeEach } from 'vitest'
import { notifyAdminsOfNewUser } from './waitlist-notify'

// When a new account pushes the total user count onto a milestone (150, then
// every 25: 175, 200, ...), notifyAdminsOfNewUser ALSO sends a celebration email
// to every opted-in admin, on top of the ordinary new-user notice. On a
// non-milestone count, only the ordinary notice goes out. Mocks keep this off D1
// and Resend so we assert exactly when the milestone email fires.

const sendNewUserNotice = vi.fn().mockResolvedValue({ sent: true })
const sendMilestoneEmail = vi.fn().mockResolvedValue({ sent: true })
const resolveAdminEmails = vi.fn()
let storedPrefs: Array<{ email: string; waitlistNotify: boolean }> = []
let userCount = 0

function buildFakeDb() {
  return {
    select: (cols: Record<string, unknown>) => ({
      from: async () => ('n' in cols ? [{ n: userCount }] : storedPrefs),
    }),
  }
}

vi.mock('../db/client', () => ({ getDb: async () => buildFakeDb() }))
vi.mock('../db/auth-schema', () => ({
  user: { id: 'id-col', email: 'email-col' },
}))
vi.mock('../db/admin-prefs-schema', () => ({
  adminNotificationPref: { email: 'email-col', waitlistNotify: 'notify-col' },
}))
vi.mock('./admin-emails', () => ({
  resolveAdminEmails: () => resolveAdminEmails(),
}))
vi.mock('./email', () => ({
  sendNewUserNotice: (email: string, total: number, to: string) =>
    sendNewUserNotice(email, total, to),
  sendMilestoneEmail: (milestone: number, to: string) =>
    sendMilestoneEmail(milestone, to),
}))

describe('notifyAdminsOfNewUser milestone celebration', () => {
  beforeEach(() => {
    sendNewUserNotice.mockClear().mockResolvedValue({ sent: true })
    sendMilestoneEmail.mockClear().mockResolvedValue({ sent: true })
    resolveAdminEmails.mockReset()
    storedPrefs = []
    userCount = 0
  })

  it('sends the milestone email to every opted-in admin when the count hits 150', async () => {
    resolveAdminEmails.mockResolvedValue(['a@admin.com', 'b@admin.com'])
    userCount = 150

    await notifyAdminsOfNewUser('new@user.com')

    // Ordinary notice still goes out to both.
    expect(sendNewUserNotice).toHaveBeenCalledTimes(2)
    // Plus the milestone email to both, carrying the milestone number.
    expect(sendMilestoneEmail).toHaveBeenCalledTimes(2)
    const milestoneRecipients = sendMilestoneEmail.mock.calls.map((c) => c[1])
    expect(milestoneRecipients).toEqual(
      expect.arrayContaining(['a@admin.com', 'b@admin.com']),
    )
    expect(sendMilestoneEmail).toHaveBeenCalledWith(150, expect.any(String))
  })

  it('sends the milestone email at a later milestone (200)', async () => {
    resolveAdminEmails.mockResolvedValue(['a@admin.com'])
    userCount = 200

    await notifyAdminsOfNewUser('new@user.com')

    expect(sendMilestoneEmail).toHaveBeenCalledTimes(1)
    expect(sendMilestoneEmail).toHaveBeenCalledWith(200, 'a@admin.com')
  })

  it('does NOT send the milestone email on a non-milestone count', async () => {
    resolveAdminEmails.mockResolvedValue(['a@admin.com', 'b@admin.com'])
    userCount = 151

    await notifyAdminsOfNewUser('new@user.com')

    expect(sendNewUserNotice).toHaveBeenCalledTimes(2)
    expect(sendMilestoneEmail).not.toHaveBeenCalled()
  })

  it('only sends the milestone email to opted-in admins', async () => {
    resolveAdminEmails.mockResolvedValue(['a@admin.com', 'b@admin.com'])
    storedPrefs = [{ email: 'b@admin.com', waitlistNotify: false }]
    userCount = 175

    await notifyAdminsOfNewUser('new@user.com')

    expect(sendMilestoneEmail).toHaveBeenCalledTimes(1)
    expect(sendMilestoneEmail).toHaveBeenCalledWith(175, 'a@admin.com')
  })

  it('is non-fatal: a milestone send throwing does not stop the rest', async () => {
    resolveAdminEmails.mockResolvedValue(['a@admin.com', 'b@admin.com'])
    userCount = 150
    sendMilestoneEmail
      .mockRejectedValueOnce(new Error('resend down'))
      .mockResolvedValueOnce({ sent: true })

    await expect(notifyAdminsOfNewUser('new@user.com')).resolves.toBeUndefined()
    expect(sendMilestoneEmail).toHaveBeenCalledTimes(2)
  })
})
