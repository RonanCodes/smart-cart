import { describe, expect, it } from 'vitest'
import { mergeWeekPreservingIdentity } from './week-merge'
import type { WeekView, WeekDayView } from './week-server'

function day(over: Partial<WeekDayView> & { day: string }): WeekDayView {
  return {
    day: over.day,
    meal: over.meal ?? `${over.day} dinner`,
    recipeRef: over.recipeRef ?? `r-${over.day}`,
    cuisine: over.cuisine ?? 'Italian',
    prepMinutes: over.prepMinutes ?? 20,
    calories: over.calories ?? 500,
    protein: over.protein ?? 30,
    imageUrl: over.imageUrl ?? null,
    videoUrl: over.videoUrl ?? null,
    alternatives: over.alternatives ?? [],
  }
}

function week(days: Array<WeekDayView>, planId = 'p1'): WeekView {
  return { planId, weekStart: '2026-06-15', days, adults: 2, children: 0 }
}

describe('mergeWeekPreservingIdentity', () => {
  it('keeps the SAME object reference for an unchanged day', () => {
    const mon = day({ day: 'Monday' })
    const tue = day({ day: 'Tuesday' })
    const prev = week([mon, tue])
    // `next` is a fresh load: brand-new objects, identical rendered fields.
    const next = week([day({ day: 'Monday' }), day({ day: 'Tuesday' })], 'p2')

    const merged = mergeWeekPreservingIdentity(prev, next)

    expect(merged.days[0]).toBe(mon)
    expect(merged.days[1]).toBe(tue)
    // The week meta (planId) still comes from `next`.
    expect(merged.planId).toBe('p2')
  })

  it('carries the household composition through (#373 portions label)', () => {
    const prev: WeekView = {
      ...week([day({ day: 'Monday' })]),
      adults: 1,
      children: 0,
    }
    const next: WeekView = {
      ...week([day({ day: 'Monday' })], 'p2'),
      adults: 2,
      children: 2,
    }
    const merged = mergeWeekPreservingIdentity(prev, next)
    // The portions label is derived from these, so a replan must not lose them.
    expect(merged.adults).toBe(2)
    expect(merged.children).toBe(2)
  })

  it('replaces ONLY the changed day, keeping siblings stable', () => {
    const mon = day({ day: 'Monday' })
    const tue = day({ day: 'Tuesday' })
    const wed = day({ day: 'Wednesday' })
    const prev = week([mon, tue, wed])

    const newTue = day({ day: 'Tuesday', recipeRef: 'r-NEW', meal: 'New dish' })
    const next = week(
      [day({ day: 'Monday' }), newTue, day({ day: 'Wednesday' })],
      'p2',
    )

    const merged = mergeWeekPreservingIdentity(prev, next)

    expect(merged.days[0]).toBe(mon) // unchanged: same ref
    expect(merged.days[2]).toBe(wed) // unchanged: same ref
    expect(merged.days[1]).not.toBe(tue) // changed: replaced
    expect(merged.days[1]?.recipeRef).toBe('r-NEW')
  })

  it('detects a change in any rendered field (e.g. image only)', () => {
    const mon = day({ day: 'Monday', imageUrl: null })
    const prev = week([mon])
    const next = week([day({ day: 'Monday', imageUrl: 'https://x/img.jpg' })])

    const merged = mergeWeekPreservingIdentity(prev, next)

    expect(merged.days[0]).not.toBe(mon)
    expect(merged.days[0]?.imageUrl).toBe('https://x/img.jpg')
  })

  it('ignores alternatives (sheet-only data) so it does not over-replace', () => {
    const mon = day({ day: 'Monday', alternatives: [] })
    const prev = week([mon])
    const next = week([
      day({
        day: 'Monday',
        alternatives: [
          {
            recipeRef: 'alt1',
            meal: 'Alt',
            cuisine: null,
            prepMinutes: null,
            calories: null,
            protein: null,
            imageUrl: null,
          },
        ],
      }),
    ])

    const merged = mergeWeekPreservingIdentity(prev, next)

    expect(merged.days[0]).toBe(mon)
  })

  it('returns the same days array when nothing changed at all', () => {
    const prev = week([day({ day: 'Monday' }), day({ day: 'Tuesday' })])
    const next = week([day({ day: 'Monday' }), day({ day: 'Tuesday' })], 'p2')

    const merged = mergeWeekPreservingIdentity(prev, next)

    expect(merged.days).toBe(prev.days)
  })

  it('handles a day added in next', () => {
    const mon = day({ day: 'Monday' })
    const prev = week([mon])
    const next = week([day({ day: 'Monday' }), day({ day: 'Tuesday' })])

    const merged = mergeWeekPreservingIdentity(prev, next)

    expect(merged.days).toHaveLength(2)
    expect(merged.days[0]).toBe(mon) // existing day keeps identity
    expect(merged.days[1]?.day).toBe('Tuesday')
  })

  it('handles a day removed in next (follows next day list)', () => {
    const mon = day({ day: 'Monday' })
    const tue = day({ day: 'Tuesday' })
    const prev = week([mon, tue])
    const next = week([day({ day: 'Monday' })])

    const merged = mergeWeekPreservingIdentity(prev, next)

    expect(merged.days).toHaveLength(1)
    expect(merged.days[0]).toBe(mon)
  })
})
