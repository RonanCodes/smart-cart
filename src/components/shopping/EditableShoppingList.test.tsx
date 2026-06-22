import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { EditableShoppingList } from './EditableShoppingList'
import type { ShoppingItem } from '#/lib/shopping'

/**
 * Stale-after-clear regression (user repro on /shopping):
 *
 *   tap "Clear all" -> navigate away -> navigate back within the route's 30s
 *   staleTime (#251) -> the cleared items REAPPEAR (the loader cache served the
 *   stale pre-clear bootstrap), and the first tap snaps the view to empty.
 *
 * The fix is for the route to invalidate its loader cache after a successful
 * clear (see _authed.shopping route test below). The component's contract is the
 * signal that lets it: a successful "Clear all" MUST fire `onCleared`, and a
 * FAILED clear must NOT (or we'd invalidate a still-valid cache for nothing).
 */

const clearShoppingList = vi.fn()

vi.mock('#/lib/shopping-list-server', () => ({
  addShoppingItem: vi.fn(),
  updateShoppingItem: vi.fn(),
  removeShoppingItem: vi.fn(),
  setAllChecked: vi.fn(),
  clearShoppingList: (...args: Array<unknown>) => clearShoppingList(...args),
}))

function item(over: Partial<ShoppingItem> = {}): ShoppingItem {
  return {
    id: over.id ?? crypto.randomUUID(),
    name: over.name ?? 'tomaten',
    amount: over.amount ?? '500 g',
    unit: over.unit ?? null,
    checked: over.checked ?? true,
    source: over.source ?? 'recipe',
    createdAt: over.createdAt ?? Date.now(),
  }
}

function clearAll() {
  fireEvent.click(screen.getByRole('button', { name: 'Clear all items' }))
  fireEvent.click(
    screen.getByRole('button', { name: 'Confirm clear all items' }),
  )
}

beforeEach(() => {
  clearShoppingList.mockReset()
})

describe('EditableShoppingList — clear-all invalidation contract', () => {
  it('fires onCleared after a SUCCESSFUL clear so the route can invalidate its loader cache', async () => {
    clearShoppingList.mockResolvedValue({ items: [] })
    const onCleared = vi.fn()

    render(
      <EditableShoppingList
        initialItems={[item({ name: 'tomaten' }), item({ name: 'ui' })]}
        onCleared={onCleared}
      />,
    )

    clearAll()

    await waitFor(() => expect(clearShoppingList).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(onCleared).toHaveBeenCalledTimes(1))
  })

  it('does NOT fire onCleared when the clear FAILS (cache must not be invalidated for a no-op)', async () => {
    clearShoppingList.mockRejectedValue(new Error('network'))
    const onCleared = vi.fn()

    render(
      <EditableShoppingList
        initialItems={[item({ name: 'tomaten' })]}
        onCleared={onCleared}
      />,
    )

    clearAll()

    await waitFor(() => expect(clearShoppingList).toHaveBeenCalledTimes(1))
    await screen.findByRole('alert')
    expect(onCleared).not.toHaveBeenCalled()
  })
})
