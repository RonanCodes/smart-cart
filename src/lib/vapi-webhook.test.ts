import { describe, it, expect } from 'vitest'
import {
  timingSafeEqual,
  extractToolCalls,
  extractCallToken,
  extractCallPlanId,
} from './vapi-webhook'
import { dispatchVapiTool } from './vapi-dispatch'

describe('timingSafeEqual', () => {
  it('is true for equal strings', () => {
    expect(timingSafeEqual('s3cret', 's3cret')).toBe(true)
  })
  it('is false for a mismatch (the 401 path)', () => {
    expect(timingSafeEqual('s3cret', 'wrong')).toBe(false)
  })
  it('is false for a length mismatch', () => {
    expect(timingSafeEqual('s3cret', 's3cretX')).toBe(false)
  })
  it('is false when one side is empty (missing header)', () => {
    expect(timingSafeEqual('', 's3cret')).toBe(false)
  })
})

describe('extractToolCalls (defensive across VAPI versions)', () => {
  it('reads message.toolCallList with flat name/arguments', () => {
    const body = {
      message: {
        toolCallList: [{ id: 'c1', name: 'ping', arguments: { x: 1 } }],
      },
    }
    expect(extractToolCalls(body)).toEqual([
      { id: 'c1', name: 'ping', args: { x: 1 } },
    ])
  })

  it('reads message.toolCalls with nested function.name/arguments', () => {
    const body = {
      message: {
        toolCalls: [
          {
            id: 'c2',
            function: {
              name: 'replan_week',
              arguments: { instruction: 'no fish' },
            },
          },
        ],
      },
    }
    expect(extractToolCalls(body)).toEqual([
      { id: 'c2', name: 'replan_week', args: { instruction: 'no fish' } },
    ])
  })

  it('parses stringified arguments', () => {
    const body = {
      message: {
        toolCalls: [
          {
            id: 'c3',
            name: 'replan_week',
            arguments: '{"instruction":"no fish"}',
          },
        ],
      },
    }
    expect(extractToolCalls(body)[0]).toEqual({
      id: 'c3',
      name: 'replan_week',
      args: { instruction: 'no fish' },
    })
  })

  it('skips entries with no id or no name, returns [] for malformed bodies', () => {
    expect(
      extractToolCalls({
        message: { toolCalls: [{ name: 'ping' }, { id: 'x' }] },
      }),
    ).toEqual([])
    expect(extractToolCalls({})).toEqual([])
    expect(extractToolCalls(null)).toEqual([])
  })
})

describe('extractCallToken', () => {
  it('reads message.call.metadata.token', () => {
    expect(
      extractCallToken({ message: { call: { metadata: { token: 'tok' } } } }),
    ).toBe('tok')
  })
  it('reads top-level call.metadata.token', () => {
    expect(extractCallToken({ call: { metadata: { token: 'tok2' } } })).toBe(
      'tok2',
    )
  })
  it('reads call.assistantOverrides.metadata.token (vapi.start overrides path)', () => {
    expect(
      extractCallToken({
        message: {
          call: {
            assistantOverrides: {
              metadata: { token: 'from_overrides', planId: 'p1' },
            },
          },
        },
      }),
    ).toBe('from_overrides')
    expect(
      extractCallToken({
        call: { assistantOverrides: { metadata: { token: 'tok4' } } },
      }),
    ).toBe('tok4')
  })
  it('prefers call.metadata over assistantOverrides on conflict', () => {
    expect(
      extractCallToken({
        message: {
          call: {
            metadata: { token: 'direct' },
            assistantOverrides: { metadata: { token: 'overrides' } },
          },
        },
      }),
    ).toBe('direct')
  })
  it('deep-scans for metadata.token anywhere in the payload', () => {
    expect(
      extractCallToken({ a: { b: { c: { metadata: { token: 'deep' } } } } }),
    ).toBe('deep')
  })
  it('is undefined when absent', () => {
    expect(extractCallToken({ message: {} })).toBeUndefined()
    expect(extractCallToken(null)).toBeUndefined()
    expect(extractCallToken({ metadata: { token: 123 } })).toBeUndefined()
  })
})

describe('extractCallPlanId', () => {
  it('reads planId from call metadata', () => {
    expect(
      extractCallPlanId({
        message: { call: { metadata: { token: 't', planId: 'plan_1' } } },
      }),
    ).toBe('plan_1')
  })
  it('reads planId from assistantOverrides.metadata', () => {
    expect(
      extractCallPlanId({
        message: {
          call: {
            assistantOverrides: {
              metadata: { token: 't', planId: 'plan_2' },
            },
          },
        },
      }),
    ).toBe('plan_2')
  })
  it('is undefined when absent', () => {
    expect(
      extractCallPlanId({ call: { metadata: { token: 't' } } }),
    ).toBeUndefined()
  })
})

describe('dispatchVapiTool', () => {
  it('ping returns pong (no server deps touched)', async () => {
    expect(await dispatchVapiTool('ping', {}, 'hh_1')).toBe('pong')
  })
  it('unknown tools return an honest string, never throw', async () => {
    expect(await dispatchVapiTool('does_not_exist', {}, 'hh_1')).toContain(
      'does_not_exist',
    )
  })
  it('not-yet-wired tools say so', async () => {
    expect(await dispatchVapiTool('add_items', {}, 'hh_1')).toMatch(/wired/i)
    expect(await dispatchVapiTool('generate_cart', {}, 'hh_1')).toMatch(
      /wired/i,
    )
  })
})
