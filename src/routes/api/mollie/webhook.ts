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
        if (!id) return new Response('missing id', { status: 400 })

        const { readEnv } = await import('../../../lib/env')
        const apiKey = await readEnv('MOLLIE_API_KEY')
        if (!apiKey) return new Response('not configured', { status: 200 })

        const { getPayment } = await import('../../../lib/mollie')
        const { getDb } = await import('../../../db/client')
        const { tipPayment } = await import('../../../db/tip-schema')
        const { eq } = await import('drizzle-orm')
        const { applyMolliePaymentUpdate } =
          await import('../../../lib/tip-server')
        const db = await getDb()

        // Re-fetch status (source of truth) and write it to the matching row.
        // Idempotent: a retry with the same status rewrites the same value.
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

        return new Response('ok', { status: 200 }) // 200 fast; Mollie retries on failure
      },
    },
  },
})
