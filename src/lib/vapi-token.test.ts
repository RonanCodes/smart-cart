import { describe, it, expect } from 'vitest'
import { mintVapiToken, verifyVapiToken } from './vapi-token'

const SECRET = 'test-signing-secret-do-not-use-in-prod'

describe('vapi token mint -> verify', () => {
  it('round-trips: a freshly minted token verifies to its household', async () => {
    const token = await mintVapiToken('hh_123', SECRET)
    const claims = await verifyVapiToken(token, SECRET)
    expect(claims).toEqual({ householdId: 'hh_123' })
  })

  it('returns null for an expired token', async () => {
    // Mint at t=0 with a 60s TTL, verify at t=120s.
    const token = await mintVapiToken('hh_123', SECRET, 60, 0)
    expect(await verifyVapiToken(token, SECRET, 120)).toBeNull()
  })

  it('returns null for a token signed with a different secret (forged)', async () => {
    const token = await mintVapiToken('hh_123', 'attacker-secret')
    expect(await verifyVapiToken(token, SECRET)).toBeNull()
  })

  it('returns null for a tampered payload (signature mismatch)', async () => {
    const token = await mintVapiToken('hh_123', SECRET)
    const [, sig] = token.split('.')
    // Swap the payload for a different household, keep the old signature.
    const forgedPayload = await mintVapiToken('hh_evil', SECRET)
    const [evilPayload] = forgedPayload.split('.')
    const tampered = `${evilPayload}.${sig}`
    expect(await verifyVapiToken(tampered, SECRET)).toBeNull()
  })

  it('returns null for missing / malformed tokens, never throwing', async () => {
    expect(await verifyVapiToken(undefined, SECRET)).toBeNull()
    expect(await verifyVapiToken(null, SECRET)).toBeNull()
    expect(await verifyVapiToken('', SECRET)).toBeNull()
    expect(await verifyVapiToken('not-a-token', SECRET)).toBeNull()
    expect(await verifyVapiToken('a.b.c', SECRET)).toBeNull()
  })

  it('returns null when no secret is configured', async () => {
    const token = await mintVapiToken('hh_123', SECRET)
    expect(await verifyVapiToken(token, '')).toBeNull()
  })
})
