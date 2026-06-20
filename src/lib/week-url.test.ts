import { describe, expect, it } from 'vitest'
import { weekPlanUrl } from './week-url'

describe('weekPlanUrl', () => {
  it('builds the canonical /week?plan= form', () => {
    expect(weekPlanUrl('p1')).toBe('/week?plan=p1')
  })

  it('encodes plan ids with unsafe characters', () => {
    expect(weekPlanUrl('p 1')).toBe('/week?plan=p%201')
    expect(weekPlanUrl('a/b&c')).toBe('/week?plan=a%2Fb%26c')
  })

  it('round-trips through URLSearchParams back to the raw plan id', () => {
    const id = 'plan-2026-06-21_revision/3'
    const url = weekPlanUrl(id)
    const search = new URLSearchParams(url.split('?')[1])
    expect(search.get('plan')).toBe(id)
  })
})
