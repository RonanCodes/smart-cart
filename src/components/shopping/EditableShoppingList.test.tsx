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
const addShoppingItem = vi.fn()
const updateShoppingItem = vi.fn()
const removeShoppingItem = vi.fn()
const setAllChecked = vi.fn()
const track = vi.fn()

vi.mock('#/lib/shopping-list-server', () => ({
  addShoppingItem: (...args: Array<unknown>) => addShoppingItem(...args),
  updateShoppingItem: (...args: Array<unknown>) => updateShoppingItem(...args),
  removeShoppingItem: (...args: Array<unknown>) => removeShoppingItem(...args),
  setAllChecked: (...args: Array<unknown>) => setAllChecked(...args),
  clearShoppingList: (...args: Array<unknown>) => clearShoppingList(...args),
}))
vi.mock('#/lib/analytics', () => ({
  track: (...args: Array<unknown>) => track(...args),
  FUNNEL_EVENTS: {
    addedToCart: 'added_to_cart',
    cartUpdated: 'cart_updated',
  },
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
  addShoppingItem.mockReset()
  updateShoppingItem.mockReset()
  removeShoppingItem.mockReset()
  setAllChecked.mockReset()
  track.mockReset()
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

describe('EditableShoppingList — cart_updated funnel events', () => {
  it('fires cart_updated select when an unchecked row is ticked in', async () => {
    const row = item({ name: 'tomaten', checked: false })
    updateShoppingItem.mockResolvedValue({
      items: [{ ...row, checked: true }],
    })

    render(<EditableShoppingList initialItems={[row]} />)
    fireEvent.click(
      screen.getByRole('checkbox', { name: /add tomaten to your order/i }),
    )

    await waitFor(() =>
      expect(track).toHaveBeenCalledWith('cart_updated', { action: 'select' }),
    )
  })

  it('fires cart_updated deselect when a checked row is ticked out', async () => {
    const row = item({ name: 'tomaten', checked: true })
    updateShoppingItem.mockResolvedValue({
      items: [{ ...row, checked: false }],
    })

    render(<EditableShoppingList initialItems={[row]} />)
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: /remove tomaten from your order/i,
      }),
    )

    await waitFor(() =>
      expect(track).toHaveBeenCalledWith('cart_updated', {
        action: 'deselect',
      }),
    )
  })

  it('fires cart_updated remove when a row is deleted', async () => {
    const row = item({ name: 'tomaten' })
    removeShoppingItem.mockResolvedValue({ items: [] })

    render(<EditableShoppingList initialItems={[row]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove tomaten' }))

    await waitFor(() =>
      expect(track).toHaveBeenCalledWith('cart_updated', { action: 'remove' }),
    )
  })

  it('fires added_to_cart (source manual) when a manual item is added', async () => {
    addShoppingItem.mockResolvedValue({ items: [item({ name: 'milk' })] })

    render(<EditableShoppingList initialItems={[item({ name: 'tomaten' })]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add an item' }))
    fireEvent.change(screen.getByLabelText('New item name'), {
      target: { value: 'milk' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add item' }))

    await waitFor(() =>
      expect(track).toHaveBeenCalledWith('added_to_cart', {
        source: 'manual',
      }),
    )
  })

  it('fires cart_updated select_all on the bulk select toggle', async () => {
    setAllChecked.mockResolvedValue({
      items: [item({ name: 'tomaten', checked: true })],
    })

    // Start with an unchecked row so the button reads "Select all".
    render(
      <EditableShoppingList
        initialItems={[item({ name: 'tomaten', checked: false })]}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Select all' }))

    await waitFor(() =>
      expect(track).toHaveBeenCalledWith('cart_updated', {
        action: 'select_all',
        checked: true,
      }),
    )
  })

  it('fires cart_updated clear_all on a successful clear', async () => {
    clearShoppingList.mockResolvedValue({ items: [] })

    render(<EditableShoppingList initialItems={[item({ name: 'tomaten' })]} />)
    clearAll()

    await waitFor(() =>
      expect(track).toHaveBeenCalledWith('cart_updated', {
        action: 'clear_all',
      }),
    )
  })

  it('fires nothing when a toggle FAILS (no event on the error path)', async () => {
    const row = item({ name: 'tomaten', checked: false })
    updateShoppingItem.mockRejectedValue(new Error('network'))

    render(<EditableShoppingList initialItems={[row]} />)
    fireEvent.click(
      screen.getByRole('checkbox', { name: /add tomaten to your order/i }),
    )

    await waitFor(() => expect(updateShoppingItem).toHaveBeenCalledTimes(1))
    expect(track).not.toHaveBeenCalled()
  })
})
