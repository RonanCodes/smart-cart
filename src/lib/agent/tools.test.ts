import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AGENT_TOOLS, buildAiTools, dispatchAgentTool } from './tools'
import type { AgentToolContext } from './tools'

const buildMemoryContext = vi.fn()
const getWeekText = vi.fn()
const rememberFact = vi.fn()
const replanForHousehold = vi.fn()

vi.mock('../memory/memory-server', () => ({
  buildMemoryContext: (id: string) => buildMemoryContext(id),
  getWeekText: (id: string) => getWeekText(id),
  rememberFact: (id: string, input: unknown) => rememberFact(id, input),
}))

vi.mock('../replan-internal-server', () => ({
  replanForHousehold: (id: string, instruction: string) =>
    replanForHousehold(id, instruction),
}))

function ctx(over: Partial<AgentToolContext> = {}): AgentToolContext {
  return { householdId: 'hh1', source: 'chat', ...over }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('dispatchAgentTool', () => {
  it('recall_memory returns the grounding text', async () => {
    buildMemoryContext.mockResolvedValue({ text: 'MEMORY', memories: [] })
    const out = await dispatchAgentTool('recall_memory', {}, ctx())
    expect(out).toBe('MEMORY')
    expect(buildMemoryContext).toHaveBeenCalledWith('hh1')
  })

  it('get_week returns the current-week text', async () => {
    getWeekText.mockResolvedValue('This week: ...')
    const out = await dispatchAgentTool('get_week', {}, ctx())
    expect(out).toContain('This week')
  })

  it('remember writes with the context source and confirms', async () => {
    rememberFact.mockResolvedValue({ content: 'not pizza every week' })
    const out = await dispatchAgentTool(
      'remember',
      { content: 'not pizza every week', kind: 'variety', cuisine: 'pizza' },
      ctx({ source: 'voice' }),
    )
    expect(rememberFact).toHaveBeenCalledWith(
      'hh1',
      expect.objectContaining({
        source: 'voice',
        kind: 'variety',
        cuisine: 'pizza',
      }),
    )
    expect(out).toContain('not pizza every week')
  })

  it('replan_week reports the change and fires onReplan', async () => {
    replanForHousehold.mockResolvedValue({
      planId: 'p2',
      weekStart: '2026-06-15',
      changed: true,
      message: 'Swapped Friday.',
    })
    const onReplan = vi.fn()
    const out = await dispatchAgentTool(
      'replan_week',
      { instruction: 'swap friday' },
      ctx({ onReplan }),
    )
    expect(out).toBe('Swapped Friday.')
    expect(onReplan).toHaveBeenCalledWith({
      planId: 'p2',
      weekStart: '2026-06-15',
      changed: true,
    })
  })

  it('replan_week handles no week planned', async () => {
    replanForHousehold.mockResolvedValue(null)
    const out = await dispatchAgentTool(
      'replan_week',
      { instruction: 'swap friday' },
      ctx(),
    )
    expect(out).toContain('no week planned')
  })

  it('declines an unknown tool without throwing', async () => {
    const out = await dispatchAgentTool('frobnicate', {}, ctx())
    expect(out).toContain("don't know how")
  })

  it('declines bad arguments without throwing', async () => {
    const out = await dispatchAgentTool('remember', { kind: 'variety' }, ctx())
    expect(out).toContain("couldn't use remember")
  })
})

describe('buildAiTools', () => {
  it('exposes every agent tool to the AI SDK', () => {
    const tools = buildAiTools(ctx())
    for (const d of AGENT_TOOLS) {
      expect(tools[d.name]).toBeDefined()
    }
    expect(Object.keys(tools)).toHaveLength(AGENT_TOOLS.length)
  })
})
