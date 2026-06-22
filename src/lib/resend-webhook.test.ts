import { describe, it, expect } from 'vitest'
import {
  verifyResendSignature,
  computeResendSignature,
  parseInboundEmail,
} from './resend-webhook'

// A valid `whsec_` secret: the bytes after the prefix are base64. We build a
// signature with the SAME secret the verifier uses, so a round-trip must pass.
const SECRET = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw'
const SVIX_ID = 'msg_2abc'
const SVIX_TS = '1700000000'
const RAW_BODY = JSON.stringify({
  type: 'email.received',
  data: { from: 'a@b.com', to: 'hello@souso.app', subject: 'Hi', text: 'yo' },
})

async function signatureHeaderFor(
  secret: string,
  id: string,
  ts: string,
  body: string,
): Promise<string> {
  const sig = await computeResendSignature(secret, id, ts, body)
  return `v1,${sig}`
}

describe('verifyResendSignature', () => {
  it('accepts when no secret is configured (works before the secret is wired)', async () => {
    const res = await verifyResendSignature(
      '',
      { svixId: SVIX_ID, svixTimestamp: SVIX_TS, svixSignature: 'v1,whatever' },
      RAW_BODY,
    )
    expect(res).toEqual({ verified: true, reason: 'no_secret' })
  })

  it('verifies a correctly-signed payload (the happy path)', async () => {
    const svixSignature = await signatureHeaderFor(
      SECRET,
      SVIX_ID,
      SVIX_TS,
      RAW_BODY,
    )
    const res = await verifyResendSignature(
      SECRET,
      { svixId: SVIX_ID, svixTimestamp: SVIX_TS, svixSignature },
      RAW_BODY,
    )
    expect(res).toEqual({ verified: true, reason: 'ok' })
  })

  it('verifies when one of several v1 entries matches', async () => {
    const good = await signatureHeaderFor(SECRET, SVIX_ID, SVIX_TS, RAW_BODY)
    const svixSignature = `v1,AAAAbogus ${good}`
    const res = await verifyResendSignature(
      SECRET,
      { svixId: SVIX_ID, svixTimestamp: SVIX_TS, svixSignature },
      RAW_BODY,
    )
    expect(res.verified).toBe(true)
  })

  it('rejects a tampered body (signature no longer matches)', async () => {
    const svixSignature = await signatureHeaderFor(
      SECRET,
      SVIX_ID,
      SVIX_TS,
      RAW_BODY,
    )
    const res = await verifyResendSignature(
      SECRET,
      { svixId: SVIX_ID, svixTimestamp: SVIX_TS, svixSignature },
      RAW_BODY + 'tampered',
    )
    expect(res).toEqual({ verified: false, reason: 'mismatch' })
  })

  it('rejects when signed with a different secret', async () => {
    const otherSecret = 'whsec_Zm9vYmFyYmF6cXV4Y29ycmVjdGhvcnNl'
    const svixSignature = await signatureHeaderFor(
      otherSecret,
      SVIX_ID,
      SVIX_TS,
      RAW_BODY,
    )
    const res = await verifyResendSignature(
      SECRET,
      { svixId: SVIX_ID, svixTimestamp: SVIX_TS, svixSignature },
      RAW_BODY,
    )
    expect(res).toEqual({ verified: false, reason: 'mismatch' })
  })

  it('rejects when the secret is set but headers are missing (fail closed)', async () => {
    const res = await verifyResendSignature(
      SECRET,
      { svixId: null, svixTimestamp: null, svixSignature: null },
      RAW_BODY,
    )
    expect(res).toEqual({ verified: false, reason: 'missing_headers' })
  })
})

describe('parseInboundEmail', () => {
  it('parses an email.received event into a forward payload', () => {
    expect(
      parseInboundEmail({
        type: 'email.received',
        data: {
          from: 'sender@example.com',
          to: 'hello@souso.app',
          subject: 'Question about Souso',
          text: 'Hi there',
          html: '<p>Hi there</p>',
        },
      }),
    ).toEqual({
      from: 'sender@example.com',
      to: ['hello@souso.app'],
      subject: 'Question about Souso',
      text: 'Hi there',
      html: '<p>Hi there</p>',
    })
  })

  it('accepts the inbound.email type name and an array to-field', () => {
    const parsed = parseInboundEmail({
      type: 'inbound.email',
      data: { from: 'x@y.com', to: ['hello@souso.app', 'team@souso.app'] },
    })
    expect(parsed?.from).toBe('x@y.com')
    expect(parsed?.to).toEqual(['hello@souso.app', 'team@souso.app'])
    expect(parsed?.subject).toBe('')
  })

  it('returns null for non-inbound events (no forwarding noise)', () => {
    expect(
      parseInboundEmail({ type: 'email.sent', data: { from: 'a@b.com' } }),
    ).toBeNull()
    expect(
      parseInboundEmail({ type: 'email.delivered', data: { from: 'a@b.com' } }),
    ).toBeNull()
  })

  it('returns null for malformed bodies', () => {
    expect(parseInboundEmail(null)).toBeNull()
    expect(parseInboundEmail({})).toBeNull()
    expect(parseInboundEmail({ type: 'email.received' })).toBeNull()
    expect(
      parseInboundEmail({
        type: 'email.received',
        data: { subject: 'no from' },
      }),
    ).toBeNull()
  })
})
