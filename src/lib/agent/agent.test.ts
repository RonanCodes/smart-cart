import { describe, it, expect, vi } from 'vitest'
import { runAgent, AGENT_SYSTEM_PROMPT } from './agent'
import type { GenerateTextFn } from './agent'

describe('runAgent', () => {
  it('declines (returns null) with no model, so the caller can fall back', async () => {
    const res = await runAgent(
      { instruction: 'no fish', memoryContext: 'ctx', tools: {} },
      { model: null },
    )
    expect(res).toBeNull()
  })

  it('passes the system prompt, grounded prompt, and tools to generateText', async () => {
    const gen = vi.fn<GenerateTextFn>(async () => ({
      text: 'Updated your week.',
    }))
    const res = await runAgent(
      {
        instruction: 'no fish',
        memoryContext: 'MEMORY-BLOCK',
        tools: {},
      },
      { model: {} as never, generateText: gen },
    )

    expect(res?.text).toBe('Updated your week.')
    const call = gen.mock.calls[0]![0]
    expect(call.system).toBe(AGENT_SYSTEM_PROMPT)
    expect(call.prompt).toContain('no fish')
    expect(call.prompt).toContain('MEMORY-BLOCK')
    expect(call.stopWhen).toBeDefined()
  })
})
