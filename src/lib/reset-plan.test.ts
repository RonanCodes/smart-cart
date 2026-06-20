import { describe, it, expect, vi } from 'vitest'
import {
  HOUSEHOLD_SCOPED_TABLES,
  PRESERVED_TABLES,
  resetPlan,
  executeReset,
} from './reset-plan'
import type { ResetExecutor } from './reset-plan'

describe('resetPlan', () => {
  it('clears every household-scoped child table, then the household row, in order', () => {
    const plan = resetPlan()
    // Children first, household last.
    const childTables = plan.flatMap((s) =>
      s.kind === 'clear-child' ? [s.table] : [],
    )
    const last = plan[plan.length - 1]!
    expect(childTables).toHaveLength(HOUSEHOLD_SCOPED_TABLES.length)
    expect(last).toEqual({ kind: 'delete-household' })
    // Only ONE household delete, and it is the final step (parent after children).
    expect(plan.filter((s) => s.kind === 'delete-household')).toHaveLength(1)
    // Child order matches the documented table order.
    expect(childTables).toEqual([...HOUSEHOLD_SCOPED_TABLES])
  })

  it('targets exactly the six household-scoped tables (no auth / admin-config tables)', () => {
    expect([...HOUSEHOLD_SCOPED_TABLES].sort()).toEqual(
      [
        'meal_feedback',
        'meal_plan',
        'push_subscription',
        'recipe_swipe',
        'shopping_list_item',
        'staple',
      ].sort(),
    )
  })

  it('never names an auth or admin-config table among the wiped tables', () => {
    for (const preserved of PRESERVED_TABLES) {
      expect(HOUSEHOLD_SCOPED_TABLES).not.toContain(preserved)
    }
    // Sanity: the preserved set names the auth + admin-config tables explicitly.
    expect(PRESERVED_TABLES).toContain('user')
    expect(PRESERVED_TABLES).toContain('session')
    expect(PRESERVED_TABLES).toContain('access_grant')
    expect(PRESERVED_TABLES).toContain('admin_notification_pref')
  })
})

describe('executeReset (one household, mock executor)', () => {
  function spyExecutor() {
    const calls: Array<string> = []
    const exec: ResetExecutor = {
      clearChild: vi.fn(async (table, hid) => {
        calls.push(`clear:${table}:${hid}`)
      }),
      deleteHousehold: vi.fn(async (hid) => {
        calls.push(`household:${hid}`)
      }),
    }
    return { exec, calls }
  }

  it('clears each child table for the household, then deletes the household, in plan order', async () => {
    const { exec, calls } = spyExecutor()
    await executeReset(exec, 'hh-1')

    expect(calls).toEqual([
      'clear:recipe_swipe:hh-1',
      'clear:meal_feedback:hh-1',
      'clear:meal_plan:hh-1',
      'clear:shopping_list_item:hh-1',
      'clear:staple:hh-1',
      'clear:push_subscription:hh-1',
      'household:hh-1',
    ])
    // The household delete is the LAST call (parent after every child).
    expect(calls[calls.length - 1]).toBe('household:hh-1')
    expect(exec.clearChild).toHaveBeenCalledTimes(
      HOUSEHOLD_SCOPED_TABLES.length,
    )
    expect(exec.deleteHousehold).toHaveBeenCalledTimes(1)
  })

  it('only touches the wiped tables — never an auth or admin-config table', async () => {
    const { exec, calls } = spyExecutor()
    await executeReset(exec, 'hh-2')
    const touched = calls
      .filter((c) => c.startsWith('clear:'))
      .map((c) => c.split(':')[1]!)
    for (const preserved of PRESERVED_TABLES) {
      expect(touched).not.toContain(preserved)
    }
  })

  it('reset-all style: walking the plan per household clears all of them', async () => {
    const { exec, calls } = spyExecutor()
    const households = ['a', 'b', 'c']
    for (const hid of households) {
      await executeReset(exec, hid)
    }
    // Each household got the full plan run once: a household delete per household.
    expect(calls.filter((c) => c.startsWith('household:'))).toEqual([
      'household:a',
      'household:b',
      'household:c',
    ])
    expect(exec.deleteHousehold).toHaveBeenCalledTimes(households.length)
    expect(exec.clearChild).toHaveBeenCalledTimes(
      HOUSEHOLD_SCOPED_TABLES.length * households.length,
    )
  })
})
