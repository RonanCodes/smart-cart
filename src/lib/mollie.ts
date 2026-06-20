/**
 * Mollie REST client, called directly with `fetch` (Workers-safe, zero deps).
 *
 * We deliberately do NOT use `@mollie/api-client`: the surface we need is tiny
 * (create + get a payment) and the SDK is not officially Workers-supported. See
 * the `/ro:mollie` skill. Server-only: the key is full payment access, never let
 * it reach the client bundle.
 *
 * The flow: createPayment server-side with a redirectUrl (browser returns) and a
 * webhookUrl (Mollie notifies, body carries ONLY the id), redirect the browser to
 * `_links.checkout.href`, then re-fetch status with getPayment inside the webhook.
 * Re-fetching is the security boundary: a forged webhook can never mark a tip paid.
 */

const BASE = 'https://api.mollie.com/v2'

/** Mollie payment status union. `paid` is the only "money in" state. */
export type MolliePaymentStatus =
  | 'open'
  | 'pending'
  | 'authorized'
  | 'paid'
  | 'canceled'
  | 'expired'
  | 'failed'

export interface MolliePayment {
  id: string
  status: MolliePaymentStatus
  amount: { currency: string; value: string }
  _links: { checkout?: { href: string } }
}

export interface CreatePaymentParams {
  /** Amount as a 2-decimal STRING ("0.50", "12.00"). Numbers are rejected. */
  amount: string
  description: string
  redirectUrl: string
  webhookUrl: string
  /** Optional method ('ideal' skips the picker). Omit for the hosted picker. */
  method?: string
}

/** Create a payment. Returns the payment incl. `_links.checkout.href` to redirect to. */
export async function createPayment(
  apiKey: string,
  p: CreatePaymentParams,
): Promise<MolliePayment> {
  const res = await fetch(`${BASE}/payments`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      amount: { currency: 'EUR', value: p.amount },
      description: p.description,
      redirectUrl: p.redirectUrl,
      webhookUrl: p.webhookUrl,
      ...(p.method ? { method: p.method } : {}),
    }),
  })
  if (!res.ok) {
    throw new Error(`Mollie create failed: ${res.status} ${await res.text()}`)
  }
  return res.json()
}

/** Get a payment by id. The webhook calls this to read status (source of truth). */
export async function getPayment(
  apiKey: string,
  id: string,
): Promise<MolliePayment> {
  const res = await fetch(`${BASE}/payments/${id}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  if (!res.ok) throw new Error(`Mollie get failed: ${res.status}`)
  return res.json()
}
