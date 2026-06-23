import { count } from 'drizzle-orm'
import { waitlist } from '../db/waitlist-schema'

/**
 * SERVER-ONLY: email every admin who has waitlist notifications enabled
 * (default-on) that a new email just joined, with the running total.
 *
 * This lives in its own module , NOT in waitlist-server.ts , because
 * waitlist-server.ts is pulled into the CLIENT bundle (the landing imports
 * joinWaitlist). The dynamic `import('../db/client')` here carries the
 * `cloudflare:workers` binding, so it must never be reachable from the client
 * build. Only server paths (joinWaitlist's handler, the sign-in gate) import
 * this, and they do so dynamically.
 *
 * Best-effort by contract: a failed count, prefs read, or send must NEVER break
 * the signup or the sign-in gate, so every error is swallowed here. Callers can
 * therefore `await notifyAdminsOfSignup(email)` without their own try/catch.
 *
 * Each recipient is sent individually so admins never see each other's
 * addresses, and one recipient's send failure must not stop the rest.
 */
export async function notifyAdminsOfSignup(newEmail: string): Promise<void> {
  try {
    const { getDb } = await import('../db/client')
    const db = await getDb()

    const total = (await db.select({ n: count() }).from(waitlist))[0]?.n ?? 0

    const { adminNotificationPref } = await import('../db/admin-prefs-schema')
    const prefs = await db
      .select({
        email: adminNotificationPref.email,
        waitlistNotify: adminNotificationPref.waitlistNotify,
      })
      .from(adminNotificationPref)

    const { resolveAdminEmails } = await import('./admin-emails')
    const { recipientsForWaitlist } = await import('./admin-prefs')
    const recipients = recipientsForWaitlist(await resolveAdminEmails(), prefs)

    const { sendWaitlistSignupNotice } = await import('./email')
    for (const to of recipients) {
      try {
        await sendWaitlistSignupNotice(newEmail, total, to)
      } catch {
        // one admin's send failing must not block the others
      }
    }
  } catch {
    // swallow: admin notify is non-fatal; the signup / gate already succeeded
  }
}

/** Attribution threaded into the new-user admin email ("How did you find us?"). */
export interface NewUserAttribution {
  source?: string | null
  sourceOther?: string | null
  referrer?: string | null
}

/**
 * Atomically claim the single admin notice for a user. Returns true if THIS call
 * won the claim (so it should send), false if the notice was already claimed by
 * an earlier call. INSERT-or-ignore on the `signup_notice` PRIMARY KEY makes the
 * claim race-free, so the admin email fires exactly once per signup even though
 * two paths (the user.create hook + completeOnboarding) both try to send.
 *
 * No userId (e.g. the hook only had an email) means "cannot dedup" → we let the
 * caller send (return true); the realistic double-send case always has a userId.
 * Best-effort: any DB error returns true so a claim failure never SILENCES the
 * notice (better a rare duplicate than a missed signup email).
 */
async function claimSignupNotice(userId: string | null): Promise<boolean> {
  if (!userId) return true
  try {
    const { getDb } = await import('../db/client')
    const { signupNotice } = await import('../db/signup-notice-schema')
    const db = await getDb()
    const inserted = await db
      .insert(signupNotice)
      .values({ userId, notifiedAt: new Date() })
      .onConflictDoNothing()
      .returning({ userId: signupNotice.userId })
    return inserted.length > 0
  } catch {
    return true
  }
}

/**
 * SERVER-ONLY: email every opted-in admin that a REAL account was just created,
 * INCLUDING the signup attribution ("How did you find us?" + referrer).
 *
 * `completeOnboarding` is the AUTHORITATIVE sender. A brand-new account is always
 * created via the onboarding email step, so completeOnboarding always runs right
 * after account creation, HAS the userId + the attribution, and sends the single
 * attributed admin email (claiming the `signup_notice` row as it does).
 *
 * Better Auth's `user.create.after` hook also fires (synchronously, FIRST, before
 * the client round-trips to completeOnboarding), but it has NO attribution. If it
 * sent eagerly it would win the claim-once row and suppress the attributed send,
 * leaving admins with "Source: not provided" for every onboarding signup (#521).
 * So the hook passes `fromHook: true`: a non-pre-empting fallback that does NOT
 * claim and does NOT send the new-user notice. The attributed onboarding send is
 * therefore always the one that goes out. (The hook still fires for the genuine
 * non-onboarding edge — an approved first-time email signing in directly — but we
 * deliberately do not send an un-attributed notice there; it would otherwise race
 * and pre-empt onboarding. See #521.)
 *
 * The claim-once row keyed on `userId` remains the belt-and-braces dedup: if two
 * authoritative-style sends ever raced, only the first claim would send.
 *
 * Same default-on admin pref + best-effort contract as notifyAdminsOfSignup:
 * every error is swallowed so account creation is never broken by a count, prefs
 * read, claim, or send. Absent attribution reads as "Source: not provided".
 */
export async function notifyAdminsOfNewUser(opts: {
  email: string
  userId?: string | null
  attribution?: NewUserAttribution | null
  /** When true (the user.create.after hook), this call is a non-pre-empting
   * no-op for the new-signup notice: it neither claims nor sends, so it can never
   * win the claim ahead of completeOnboarding's attributed send (#521). */
  fromHook?: boolean
}): Promise<void> {
  try {
    // The hook must never pre-empt the attributed onboarding send: do nothing.
    if (opts.fromHook) return

    // Claim first: if another path already sent this user's notice, do nothing.
    const won = await claimSignupNotice(opts.userId ?? null)
    if (!won) return

    const { getDb } = await import('../db/client')
    const db = await getDb()

    const { user } = await import('../db/auth-schema')
    const total = (await db.select({ n: count() }).from(user))[0]?.n ?? 0

    const { adminNotificationPref } = await import('../db/admin-prefs-schema')
    const prefs = await db
      .select({
        email: adminNotificationPref.email,
        waitlistNotify: adminNotificationPref.waitlistNotify,
      })
      .from(adminNotificationPref)

    const { resolveAdminEmails } = await import('./admin-emails')
    const { recipientsForWaitlist } = await import('./admin-prefs')
    const recipients = recipientsForWaitlist(await resolveAdminEmails(), prefs)

    const { sendNewUserNotice, sendMilestoneEmail } = await import('./email')
    for (const to of recipients) {
      try {
        await sendNewUserNotice(opts.email, total, to, opts.attribution ?? null)
      } catch {
        // one admin's send failing must not block the others
      }
    }

    // Milestone celebration: when this new account lands the total exactly on a
    // milestone (150, then every 25: 175, 200, ...), also send a fun on-brand
    // email to the same opted-in admins. Count rises one per signup, so each
    // milestone count happens once and the celebration fires once, no state to
    // track. Best-effort: a send failing must never break the signup.
    const { isUserCountMilestone } = await import('./user-milestone')
    if (isUserCountMilestone(total)) {
      for (const to of recipients) {
        try {
          await sendMilestoneEmail(total, to)
        } catch {
          // one admin's send failing must not block the others
        }
      }
    }
  } catch {
    // swallow: admin notify is non-fatal; the account was already created
  }
}

/**
 * SERVER-ONLY: email every opted-in admin that a new piece of in-app feedback
 * came through, just like a signup ping (#444 follow-up). Same default-on admin
 * pref + best-effort contract as the signup notifier: a count, prefs read, or
 * send failure never affects the feedback submission (the row is already saved).
 */
export async function notifyAdminsOfFeedback(feedback: {
  message: string
  email?: string | null
  phone?: string | null
  source?: string | null
  /** The Sentry event id from captureSentryFeedback, threaded through for the
   * email's deep-link. Absent when Sentry was skipped (dev) or the capture
   * failed; the email degrades to no Sentry line. */
  sentryEventId?: string | null
  /** When the feedback was submitted, for the email's timestamp line. */
  submittedAt?: Date | null
  /** An optional attached screenshot, forwarded as a Resend email attachment. */
  attachment?: {
    filename: string
    base64: string
  } | null
}): Promise<void> {
  try {
    const { getDb } = await import('../db/client')
    const db = await getDb()

    const { adminNotificationPref } = await import('../db/admin-prefs-schema')
    const prefs = await db
      .select({
        email: adminNotificationPref.email,
        waitlistNotify: adminNotificationPref.waitlistNotify,
      })
      .from(adminNotificationPref)

    const { resolveAdminEmails } = await import('./admin-emails')
    const { recipientsForWaitlist } = await import('./admin-prefs')
    const recipients = recipientsForWaitlist(await resolveAdminEmails(), prefs)

    const { sendFeedbackNotice } = await import('./email')
    for (const to of recipients) {
      try {
        await sendFeedbackNotice(feedback, to)
      } catch {
        // one admin's send failing must not block the others
      }
    }
  } catch {
    // swallow: admin notify is non-fatal; the feedback was already saved
  }
}
