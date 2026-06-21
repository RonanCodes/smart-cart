import { describe, it, expect } from 'vitest'
import { dedupeEmails } from './launch'

// Note: the launch short-circuit in isApproved (access.ts) is verified manually,
// not here — access.ts pulls in env.ts whose `cloudflare:workers` import can't be
// transformed under vitest, which is why the access suite only covers the pure
// access-rules module. dedupeEmails is pure, so it is fully unit-tested below.

describe('dedupeEmails', () => {
  it('returns an empty list for no input / empty lists', () => {
    expect(dedupeEmails()).toEqual([])
    expect(dedupeEmails([], [])).toEqual([])
  })

  it('trims, lowercases, and drops blanks', () => {
    expect(dedupeEmails([' A@x.com ', '', '   ', 'B@X.COM'])).toEqual([
      'a@x.com',
      'b@x.com',
    ])
  })

  it('de-dupes across lists, keeping first-seen order', () => {
    expect(
      dedupeEmails(
        ['alice@x.com', 'bob@x.com'],
        ['BOB@x.com', 'carol@x.com', 'alice@x.com'],
      ),
    ).toEqual(['alice@x.com', 'bob@x.com', 'carol@x.com'])
  })
})
