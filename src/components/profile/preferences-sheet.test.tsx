import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { PreferencesSheet } from './preferences-sheet'
import type { EditableProfile } from '#/lib/profile-edit-server'

/**
 * #376 — the preferences drawer must reliably persist a changed setting WITHOUT
 * the user hunting for a buried Save button at the bottom. The fix is debounced
 * autosave: a change schedules a single patch round-trip, and the sheet shows a
 * clear saved/unsaved status. These tests lock that behaviour — they fail
 * against the old "buried Save button, no autosave" implementation.
 */

// The sheet statically imports updateHouseholdProfile (a createServerFn). Mock
// the whole module so the test stays unit-level (no DB, no network) and we can
// assert exactly what patch the autosave sends.
const updateHouseholdProfile = vi.fn()
vi.mock('#/lib/profile-edit-server', () => ({
  updateHouseholdProfile: (...args: Array<unknown>) =>
    updateHouseholdProfile(...args),
}))

const BASE: EditableProfile = {
  cuisinesLiked: [],
  cuisinesDisliked: [],
  dislikes: [],
  diet: [],
  goals: [],
  skipDays: null,
}

/** The shape updateHouseholdProfile resolves to (the re-projected profile). */
function resolved(over: Partial<EditableProfile> = {}): EditableProfile {
  return { ...BASE, ...over }
}

beforeEach(() => {
  vi.useFakeTimers()
  updateHouseholdProfile.mockReset().mockResolvedValue(resolved())
})

afterEach(() => {
  vi.runOnlyPendingTimers()
  vi.useRealTimers()
})

/** Advance past the autosave debounce window and flush the resolved promise. */
async function flushAutosave() {
  await act(async () => {
    vi.advanceTimersByTime(2000)
  })
}

describe('PreferencesSheet autosave (#376)', () => {
  it('persists a toggled diet without any explicit Save tap', async () => {
    const onSaved = vi.fn()
    render(
      <PreferencesSheet
        open
        onOpenChange={() => {}}
        current={BASE}
        onSaved={onSaved}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Vegan' }))
    await flushAutosave()

    expect(updateHouseholdProfile).toHaveBeenCalledTimes(1)
    const arg = updateHouseholdProfile.mock.calls[0]?.[0] as {
      data: { patch: Partial<EditableProfile> }
    }
    expect(arg.data.patch.diet).toContain('Vegan')
    expect(onSaved).toHaveBeenCalledTimes(1)
  })

  it('debounces a burst of changes into a single round-trip', async () => {
    render(
      <PreferencesSheet
        open
        onOpenChange={() => {}}
        current={BASE}
        onSaved={() => {}}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Vegan' }))
    fireEvent.click(screen.getByRole('button', { name: 'Gluten free' }))
    fireEvent.click(screen.getByRole('button', { name: 'Italian' }))
    await flushAutosave()

    expect(updateHouseholdProfile).toHaveBeenCalledTimes(1)
    const arg = updateHouseholdProfile.mock.calls[0]?.[0] as {
      data: { patch: Partial<EditableProfile> }
    }
    // The single coalesced patch carries every change.
    expect(arg.data.patch.diet).toEqual(
      expect.arrayContaining(['Vegan', 'Gluten free']),
    )
    expect(arg.data.patch.cuisinesLiked).toContain('Italian')
  })

  it('does not save just from opening (no spurious round-trip)', async () => {
    render(
      <PreferencesSheet
        open
        onOpenChange={() => {}}
        current={BASE}
        onSaved={() => {}}
      />,
    )
    await flushAutosave()
    expect(updateHouseholdProfile).not.toHaveBeenCalled()
  })

  it('shows a clear saved status after an autosave settles', async () => {
    render(
      <PreferencesSheet
        open
        onOpenChange={() => {}}
        current={BASE}
        onSaved={() => {}}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Vegan' }))
    await flushAutosave()
    expect(screen.getByText(/saved/i)).toBeTruthy()
  })
})
