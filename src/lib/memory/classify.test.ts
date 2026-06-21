import { describe, it, expect } from 'vitest'
import {
  buildClassifyPrompt,
  classifyNote,
  memoryDraftSchema,
  toMemoryDraft,
} from './classify'
import type { GenerateObjectFn } from './classify'

describe('buildClassifyPrompt', () => {
  it('includes the note and the variety guidance', () => {
    const { system, prompt } = buildClassifyPrompt('not pizza every week')
    expect(prompt).toContain('not pizza every week')
    expect(system).toContain('variety')
    expect(system).toContain('must NOT become a dislike or a ban')
  })
})

describe('toMemoryDraft', () => {
  it('lowercases the free cuisine/term', () => {
    const d = toMemoryDraft({
      kind: 'variety',
      cuisine: 'Pizza',
      term: null,
      polarity: 'neutral',
      scope: 'persistent',
    })
    expect(d.cuisine).toBe('pizza')
  })
})

describe('classifyNote', () => {
  it('returns null with no model (offline degrade)', async () => {
    const d = await classifyNote('not pizza every week', { model: null })
    expect(d).toBeNull()
  })

  it('maps a stubbed model response into a draft', async () => {
    const gen: GenerateObjectFn = async () => ({
      object: memoryDraftSchema.parse({
        kind: 'variety',
        cuisine: 'pizza',
        polarity: 'neutral',
      }),
    })
    const d = await classifyNote('not pizza every week', {
      // The model object is never inspected by the stub.
      model: {} as never,
      generateObject: gen,
    })
    expect(d).toEqual({
      kind: 'variety',
      cuisine: 'pizza',
      term: null,
      polarity: 'neutral',
      scope: 'persistent',
    })
  })

  it('returns null when the model call throws', async () => {
    const gen: GenerateObjectFn = async () => {
      throw new Error('boom')
    }
    const d = await classifyNote('note', {
      model: {} as never,
      generateObject: gen,
    })
    expect(d).toBeNull()
  })
})
