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
const MOLLIE_PAYMENT_ID_RE = /^tr_[A-Za-z0-9]+$/

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

/** Mollie payment ids are path params; accept only the documented `tr_...` shape. */
export function isMolliePaymentId(id: string): boolean {
  return id.length <= 64 && MOLLIE_PAYMENT_ID_RE.test(id)
}

/**
 * A structured Mollie API failure. The old code threw a bare string
 * (`Mollie create failed: 422 {json blob}`), which landed in Workers Logs as an
 * opaque trace with no queryable fields. This carries the parsed pieces so a
 * caller can log `{ status, detail, field }` and branch on them (e.g. the 422
 * "method not activated" case gets a user-friendly message). `.message` stays
 * readable for any code that just logs the error text.
 */
export class MollieError extends Error {
  /** HTTP status from Mollie (e.g. 422, 401). */
  readonly status: number
  /** Mollie's `title` (e.g. "Unprocessable Entity"), if present. */
  readonly title?: string
  /** Mollie's human `detail` (e.g. "The payment method is not activated..."). */
  readonly detail?: string
  /** The offending field, from Mollie's `field` or `_links`/`extra`, if present. */
  readonly field?: string

  constructor(args: {
    status: number
    title?: string
    detail?: string
    field?: string
    operation: string
  }) {
    const { status, title, detail, field, operation } = args
    const parts = [`${operation} failed: ${status}`]
    if (title) parts.push(title)
    if (detail) parts.push(detail)
    super(parts.join(' '))
    this.name = 'MollieError'
    this.status = status
    this.title = title
    this.detail = detail
    this.field = field
  }
}

/**
 * Build a {@link MollieError} from a failed response. Mollie returns a JSON error
 * body shaped `{ status, title, detail, field?, extra? }`; we parse what we can
 * and fall back to the raw text when the body is not JSON. Never throws while
 * building the error (a parse failure must not mask the original failure).
 */
async function mollieErrorFromResponse(
  res: Response,
  operation: string,
): Promise<MollieError> {
  const text = await res.text().catch(() => '')
  let title: string | undefined
  let detail: string | undefined
  let field: string | undefined
  if (text) {
    try {
      const body = JSON.parse(text) as {
        title?: unknown
        detail?: unknown
        field?: unknown
      }
      if (typeof body.title === 'string') title = body.title
      if (typeof body.detail === 'string') detail = body.detail
      if (typeof body.field === 'string') field = body.field
    } catch {
      // Body was not JSON (rare); keep the raw text as the detail.
      detail = text
    }
  }
  return new MollieError({
    status: res.status,
    title,
    detail,
    field,
    operation,
  })
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
    throw await mollieErrorFromResponse(res, 'Mollie create')
  }
  return res.json()
}

/** Get a payment by id. The webhook calls this to read status (source of truth). */
export async function getPayment(
  apiKey: string,
  id: string,
): Promise<MolliePayment> {
  if (!isMolliePaymentId(id)) {
    throw new MollieError({
      status: 400,
      title: 'Invalid payment id',
      operation: 'Mollie get',
    })
  }

  const res = await fetch(`${BASE}/payments/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  if (!res.ok) throw await mollieErrorFromResponse(res, 'Mollie get')
  return res.json()
}
