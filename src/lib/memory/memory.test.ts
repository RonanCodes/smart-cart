import { describe, it, expect } from 'vitest'
import {
  findDuplicate,
  formatMemoryContext,
  memoryToPenalties,
  planMemoryWrite,
  resolveDraft,
} from './memory'
import type { MemoryRecord, RecentlyServed } from './memory'

function record(over: Partial<MemoryRecord>): MemoryRecord {
  return {
    id: over.id ?? 'm1',
    householdId: 'hh1',
    kind: over.kind ?? 'preference',
    content: over.content ?? 'note',
    cuisine: over.cuisine ?? null,
    term: over.term ?? null,
    polarity: over.polarity ?? 'neutral',
    scope: over.scope ?? 'persistent',
    salience: over.salience ?? 1,
    source: over.source ?? 'chat',
    expiresAt: over.expiresAt ?? null,
    active: over.active ?? true,
    createdAt: over.createdAt ?? new Date('2026-06-01'),
    updatedAt: over.updatedAt ?? new Date('2026-06-01'),
  }
}

describe('resolveDraft', () => {
  it('keeps the explicit fields the agent/classifier supplied', () => {
    const d = resolveDraft({
      content: 'no pizza every week',
      source: 'voice',
      kind: 'variety',
      cuisine: 'pizza',
      polarity: 'neutral',
    })
    expect(d.kind).toBe('variety')
    expect(d.polarity).toBe('neutral')
    expect(d.cuisine).toBe('pizza')
  })

  it('defaults polarity to neutral and scope to persistent', () => {
    const d = resolveDraft({ content: 'note', source: 'chat', kind: 'context' })
    expect(d.polarity).toBe('neutral')
    expect(d.scope).toBe('persistent')
  })

  it('lowercases an explicit cuisine/term', () => {
    const d = resolveDraft({
      content: 'note',
      source: 'chat',
      kind: 'preference',
      cuisine: 'Italian',
      term: 'Salmon',
    })
    expect(d.cuisine).toBe('italian')
    expect(d.term).toBe('salmon')
  })
})

describe('findDuplicate / planMemoryWrite', () => {
  it('bumps an existing same-cuisine same-polarity memory', () => {
    const existing = [
      record({
        id: 'a',
        kind: 'preference',
        polarity: 'dislike',
        cuisine: 'thai',
      }),
    ]
    const dup = findDuplicate(
      existing,
      {
        kind: 'preference',
        polarity: 'dislike',
        cuisine: 'thai',
        term: null,
        scope: 'persistent',
      },
      'no thai please',
    )
    expect(dup?.id).toBe('a')
  })

  it('plans an insert for a brand-new fact', () => {
    const action = planMemoryWrite([], {
      content: 'we love korean food',
      source: 'chat',
      kind: 'preference',
      cuisine: 'korean',
      polarity: 'like',
    })
    expect(action.kind).toBe('insert')
  })

  it('plans a salience bump (capped at 10) for a restated fact', () => {
    const existing = [
      record({
        id: 'a',
        kind: 'variety',
        polarity: 'neutral',
        cuisine: 'pizza',
        salience: 10,
      }),
    ]
    const action = planMemoryWrite(existing, {
      content: 'pizza every week again is too much',
      source: 'voice',
      kind: 'variety',
      cuisine: 'pizza',
      polarity: 'neutral',
    })
    expect(action.kind).toBe('bump')
    if (action.kind === 'bump') {
      expect(action.id).toBe('a')
      expect(action.salience).toBe(10)
    }
  })

  it('does not collide across different polarities', () => {
    const existing = [
      record({
        id: 'a',
        kind: 'preference',
        polarity: 'like',
        cuisine: 'thai',
      }),
    ]
    const action = planMemoryWrite(existing, {
      content: "we don't like thai anymore",
      source: 'chat',
      kind: 'preference',
      cuisine: 'thai',
      polarity: 'dislike',
    })
    expect(action.kind).toBe('insert')
  })
})

describe('formatMemoryContext', () => {
  it('includes memories, both weeks, and feedback', () => {
    const text = formatMemoryContext({
      memories: [
        record({
          kind: 'variety',
          cuisine: 'pizza',
          content: 'not pizza every week',
          salience: 5,
        }),
      ],
      currentWeek: {
        weekStart: '2026-06-15',
        days: [{ day: 'Monday', meal: 'Pizza Margherita', cuisine: 'pizza' }],
      },
      lastWeek: {
        weekStart: '2026-06-08',
        days: [{ day: 'Monday', meal: 'Pizza Funghi', cuisine: 'pizza' }],
      },
      feedback: [
        { meal: 'Pizza Funghi', rating: 'down', note: 'too much pizza' },
      ],
    })
    expect(text).toContain('not pizza every week')
    expect(text).toContain('2026-06-15')
    expect(text).toContain('2026-06-08')
    expect(text).toContain('too much pizza')
  })

  it('states empty sections explicitly', () => {
    const text = formatMemoryContext({ memories: [] })
    expect(text).toContain('(nothing yet)')
    expect(text).toContain('(none planned)')
    expect(text).toContain('(none yet)')
  })
})

describe('memoryToPenalties', () => {
  const recent: RecentlyServed = {
    recipeCounts: { r1: 2, r2: 1 },
    cuisineCounts: { pizza: 3, thai: 1 },
  }

  it('penalises a variety cuisine in proportion to recent recurrence', () => {
    const p = memoryToPenalties(
      [record({ kind: 'variety', cuisine: 'pizza', polarity: 'neutral' })],
      recent,
    )
    // 3 recent pizza dinners * 0.4 = 1.2
    expect(p.cuisine?.pizza).toBeCloseTo(1.2)
  })

  it('does not penalise a variety cuisine that did not recur recently', () => {
    const p = memoryToPenalties(
      [record({ kind: 'variety', cuisine: 'greek', polarity: 'neutral' })],
      recent,
    )
    expect(p.cuisine?.greek).toBeUndefined()
  })

  it('adds a recency penalty for recently-served recipes', () => {
    const p = memoryToPenalties([], recent)
    expect(p.recipe?.r1).toBeCloseTo(1.0)
    expect(p.recipe?.r2).toBeCloseTo(0.5)
  })

  it('weights a constraint harder than a plain dislike', () => {
    const p = memoryToPenalties(
      [
        record({ kind: 'constraint', term: 'peanut', polarity: 'dislike' }),
        record({ kind: 'preference', term: 'mushroom', polarity: 'dislike' }),
      ],
      { recipeCounts: {}, cuisineCounts: {} },
    )
    expect(p.term?.peanut).toBeCloseTo(1.5)
    expect(p.term?.mushroom).toBeCloseTo(0.6)
  })

  it('ignores likes (they flow through swipes/profile)', () => {
    const p = memoryToPenalties(
      [record({ kind: 'preference', cuisine: 'thai', polarity: 'like' })],
      { recipeCounts: {}, cuisineCounts: {} },
    )
    expect(p.cuisine).toBeUndefined()
  })

  it('returns an empty object when there is nothing to penalise', () => {
    const p = memoryToPenalties([], { recipeCounts: {}, cuisineCounts: {} })
    expect(p).toEqual({})
  })
})
