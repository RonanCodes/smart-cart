import { createServerFn } from '@tanstack/react-start'

/**
 * DEMO SKIP-LOGIN (Resend outage workaround).
 *
 * Generates a sign-in code server-side and returns it to the caller, so the client can
 * complete the normal Better Auth verify step without the email being delivered. This
 * exists because Resend is down and we need to onboard people live at the demo.
 *
 * It preserves the user's email identity (each person still gets their own household),
 * it just skips the inbox round-trip. Admin stays email-gated, so this grants no extra
 * privilege. REMOVE THIS (and the skip button + the OTP stash in auth.ts) after the
 * demo. Tracked as a follow-up issue.
 */
export const requestDemoCode = createServerFn({ method: 'POST' })
  .inputValidator((d: { email: string }) => d)
  .handler(async ({ data }): Promise<{ otp: string }> => {
    const email = data.email.trim().toLowerCase()
    if (!email) throw new Error('Email is required.')

    // Gated access: the demo skip-login must honour the same approval rule as
    // the email-OTP flow, so a waitlisted email can't bypass the inbox round-trip.
    const { isApproved, NOT_APPROVED_MESSAGE } = await import('./access')
    if (!(await isApproved(email))) throw new Error(NOT_APPROVED_MESSAGE)

    const { getAuth, consumeOtp } = await import('./auth')
    const auth = await getAuth()

    // Triggers Better Auth to generate + persist the OTP and call our
    // sendVerificationOTP callback (which stashes it, and tries Resend non-fatally).
    await auth.api.sendVerificationOTP({
      body: { email, type: 'sign-in' },
    })

    // Read back the OTP we stashed during the send call above (same request, same
    // isolate, so the in-memory stash is reliable here).
    const otp = consumeOtp(email)
    if (!otp) throw new Error('Could not generate a sign-in code.')
    return { otp }
  })
