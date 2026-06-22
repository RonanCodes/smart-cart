import { createFileRoute } from '@tanstack/react-router'

/**
 * POST /api/mollie/webhook, Mollie's payment-status notification.
 *
 * The body is form-encoded and carries ONLY `id=tr_...`, no status. This is the
 * security boundary: we MUST re-fetch the payment from Mollie's API to read its
 * real status (a forged webhook can never mark a tip paid). The handler is
 * idempotent: Mollie retries and may fire the same id multiple times, so a
 * repeat with an unchanged status is a no-op. We always answer 200 fast so
 * Mollie stops retrying; 400 only when the id is missing.
 *
 * Server-only by nature (the Mollie key is read from env here). See `/ro:mollie`.
 */
export const Route = createFileRoute('/api/mollie/webhook')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const form = await request.formData().catch(() => null)
        const id = form ? String(form.get('id') ?? '') : ''
        const { getPayment, isMolliePaymentId } =
          await import('../../../lib/mollie')
        if (!id) return new Response('missing id', { status: 400 })
        if (!isMolliePaymentId(id)) {
          return new Response('invalid id', { status: 400 })
        }

        const { getDb } = await import('../../../db/client')
        const { tipPayment } = await import('../../../db/tip-schema')
        const { eq } = await import('drizzle-orm')
        const { applyMolliePaymentUpdate } =
          await import('../../../lib/tip-server')
        const { asPaymentMode } = await import('../../../lib/payment-mode')
        const { mollieKeyForMode } =
          await import('../../../lib/payment-mode-resolve')
        const { log } = await import('../../../lib/log')
        const db = await getDb()

        // The mode the payment was created under decides which Mollie key can
        // re-fetch it (a live payment can't be read with the test key). Look it
        // up on the stored row; fall back to 'test' (+ a warn) if no row matches.
        const row = (
          await db
            .select({ mode: tipPayment.mode })
            .from(tipPayment)
            .where(eq(tipPayment.molliePaymentId, id))
            .limit(1)
        )[0]
        if (!row) {
          log.warn('mollie.webhook_no_row', { molliePaymentId: id })
        }
        const mode = asPaymentMode(row?.mode) ?? 'test'

        let apiKey: string
        try {
          apiKey = await mollieKeyForMode(mode)
        } catch {
          // 200 fast so Mollie stops retrying; the key is a config problem, not
          // a transient one a retry would fix.
          log.warn('mollie.webhook_key_unconfigured', {
            molliePaymentId: id,
            mode,
          })
          return new Response('not configured', { status: 200 })
        }

        // Re-fetch status (source of truth) and write it to the matching row.
        // Idempotent: a retry with the same status rewrites the same value.
        try {
          await applyMolliePaymentUpdate(
            apiKey,
            { getPayment },
            {
              updateStatus: (molliePaymentId, status) =>
                db
                  .update(tipPayment)
                  .set({ status })
                  .where(eq(tipPayment.molliePaymentId, molliePaymentId)),
            },
            id,
          )
        } catch (err) {
          // Make the webhook-side getPayment / status-update failure diagnosable
          // (#307): carry the payment id + mode. We still answer 200 so Mollie
          // stops retrying a failure a retry won't fix.
          log.error('tip.mollie.webhook_failed', err, {
            molliePaymentId: id,
            mode,
          })
        }

        return new Response('ok', { status: 200 }) // 200 fast; Mollie retries on failure
      },
    },
  },
})
