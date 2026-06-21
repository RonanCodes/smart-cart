import { describe, it, expect } from 'vitest'
import {
  describeWeekForVoice,
  buildPersonaSystemPrompt,
  buildPersonaFirstMessage,
  buildPersonaOverrides,
} from './vapi-persona'

const days = [
  { day: 'Monday', meal: 'Spaghetti Bolognese' },
  { day: 'Tuesday', meal: 'Chicken Curry' },
  { day: 'Wednesday', meal: '' },
]

describe('describeWeekForVoice', () => {
  it('lists each day with its dish, marking empty days as eating out', () => {
    expect(describeWeekForVoice(days)).toBe(
      'Monday: Spaghetti Bolognese\nTuesday: Chicken Curry\nWednesday: (eating out)',
    )
  })

  it('handles an empty week', () => {
    expect(describeWeekForVoice([])).toBe('(no week planned yet)')
  })
})

describe('buildPersonaSystemPrompt', () => {
  it('grounds the prompt in the open week so it defaults to this week', () => {
    const prompt = buildPersonaSystemPrompt({ weekLabel: 'This week', days })
    expect(prompt).toContain('You are Souso')
    expect(prompt).toContain('Open week: This week')
    expect(prompt).toContain('Monday: Spaghetti Bolognese')
    // Persona instructs short, act-first replies.
    expect(prompt).toMatch(/SHORT/)
    expect(prompt).toMatch(/Act first/i)
  })
})

describe('buildPersonaFirstMessage', () => {
  it('greets with the week when dinners are planned', () => {
    const msg = buildPersonaFirstMessage({ weekLabel: 'This week', days })
    expect(msg).toContain('Souso')
    expect(msg.toLowerCase()).toContain('this week')
  })

  it('offers to set up the week when nothing is planned', () => {
    const msg = buildPersonaFirstMessage({
      weekLabel: 'This week',
      days: [{ day: 'Monday', meal: '' }],
    })
    expect(msg.toLowerCase()).toContain('set up')
  })
})

describe('buildPersonaOverrides', () => {
  it('assembles a VAPI-shaped override object (safe fields only, no model)', () => {
    const o = buildPersonaOverrides({ weekLabel: 'Next week', days })
    expect(o.firstMessage).toContain('Souso')
    expect(o.variableValues.weekLabel).toBe('Next week')
    expect(o.variableValues.weekPlan).toContain('Tuesday: Chicken Curry')
    // No partial `model` override: VAPI hangs on `{ messages }` without a
    // provider, which broke the connection. The system prompt lives in the
    // dashboard; we only send the mergeable firstMessage + variableValues.
    expect('model' in o).toBe(false)
  })
})
