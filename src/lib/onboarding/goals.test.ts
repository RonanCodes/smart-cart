import { describe, it, expect } from 'vitest'
import { Drumstick, Timer, Feather } from 'lucide-react'
import { GOAL_OPTIONS } from './goals'

describe('GOAL_OPTIONS', () => {
  it('keeps the original five goals', () => {
    const labels = GOAL_OPTIONS.map((g) => g.label)
    for (const label of [
      'Eat a more balanced diet',
      'Pay less for my groceries',
      'Cook and discover new recipes',
      'Avoid unnecessary purchases',
      'Eat less meat',
    ]) {
      expect(labels).toContain(label)
    }
  })

  it('adds More protein / Quick meals / Low-cal meals with their icons', () => {
    const byLabel = new Map(GOAL_OPTIONS.map((g) => [g.label, g.icon]))
    expect(byLabel.get('More protein')).toBe(Drumstick)
    expect(byLabel.get('Quick meals')).toBe(Timer)
    expect(byLabel.get('Low-cal meals')).toBe(Feather)
  })

  it('has no duplicate labels', () => {
    const labels = GOAL_OPTIONS.map((g) => g.label)
    expect(new Set(labels).size).toBe(labels.length)
  })
})
