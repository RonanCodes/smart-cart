import { useEffect, useState } from 'react'
import { Check, Plus, Trash2, ShoppingBasket } from 'lucide-react'
import { Input } from '#/components/ui/input'
import { Button } from '#/components/ui/button'
import { Badge } from '#/components/ui/badge'
import { ingredientSticker } from '#/lib/ingredient-sticker'
import {
  addShoppingItem,
  updateShoppingItem,
  removeShoppingItem,
  setAllChecked,
  clearShoppingList,
} from '#/lib/shopping-list-server'
import type { ShoppingItem } from '#/lib/shopping'

/**
 * The editable, PERSISTED shopping list on the Shopping tab (#146).
 *
 * Everything here survives a reload because it is backed by the
 * `shopping_list_item` table, not derived from the week each load. The list is
 * owned as local state seeded from the loader, then kept in sync from each
 * server-fn response (no full-page reload), exactly like StaplesSection.
 *
 * Per row the household can:
 *  - tick it off (a tap on the round checkbox),
 *  - rename it (tap the name, edit inline, blur / Enter to save),
 *  - re-amount it (tap the amount, edit inline),
 *  - remove it (the trash button).
 * Plus add a fresh manual item at the bottom and tick / untick the whole list.
 *
 * Mobile-first (390px), iOS card styling consistent with the rest of the app.
 */
export function EditableShoppingList({
  initialItems,
  onCleared,
}: {
  initialItems: Array<ShoppingItem>
  /**
   * Fired after the list is wiped via "Clear all". The route uses it to mark the
   * empty list as a deliberate choice (so the loader does not re-seed it from
   * the week on the next visit / reload).
   */
  onCleared?: () => void
}) {
  const [items, setItems] = useState<Array<ShoppingItem>>(initialItems)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [newAmount, setNewAmount] = useState('')
  const [adding, setAdding] = useState(false)
  /** Two-tap guard for "Clear all": first tap arms it, second confirms. */
  const [confirmingClear, setConfirmingClear] = useState(false)

  const remaining = items.filter((i) => !i.checked).length
  const allChecked = items.length > 0 && remaining === 0
  // Light grouping: still-to-buy first, ticked-off collapsed beneath. Order
  // within each group is preserved (the loader returns oldest-first).
  const unchecked = items.filter((i) => !i.checked)
  const checked = items.filter((i) => i.checked)

  async function toggle(item: ShoppingItem) {
    setBusyId(item.id)
    try {
      const { items: next } = await updateShoppingItem({
        data: { id: item.id, checked: !item.checked },
      })
      setItems(next)
    } catch {
      // no-op; the row simply does not change.
    } finally {
      setBusyId(null)
    }
  }

  async function saveField(
    id: string,
    field: 'name' | 'amount',
    value: string,
  ) {
    setBusyId(id)
    try {
      const { items: next } = await updateShoppingItem({
        data: { id, [field]: value },
      })
      setItems(next)
    } catch {
      // no-op
    } finally {
      setBusyId(null)
    }
  }

  async function remove(id: string) {
    setBusyId(id)
    try {
      const { items: next } = await removeShoppingItem({ data: { id } })
      setItems(next)
    } catch {
      // no-op
    } finally {
      setBusyId(null)
    }
  }

  async function add() {
    const name = newName.trim()
    if (!name) return
    setAdding(true)
    try {
      const { items: next } = await addShoppingItem({
        data: { name, amount: newAmount.trim() || null },
      })
      setItems(next)
      setNewName('')
      setNewAmount('')
    } catch {
      // no-op
    } finally {
      setAdding(false)
    }
  }

  async function toggleAll() {
    setBusyId('__all__')
    try {
      const { items: next } = await setAllChecked({
        data: { checked: !allChecked },
      })
      setItems(next)
    } catch {
      // no-op
    } finally {
      setBusyId(null)
    }
  }

  // First tap on "Clear all" arms a confirm; if the user does not confirm within
  // 2s the button reverts, so the list is never wiped on a single stray tap.
  useEffect(() => {
    if (!confirmingClear) return
    const t = setTimeout(() => setConfirmingClear(false), 2000)
    return () => clearTimeout(t)
  }, [confirmingClear])

  async function clearAll() {
    if (!confirmingClear) {
      setConfirmingClear(true)
      return
    }
    setConfirmingClear(false)
    setBusyId('__clear__')
    try {
      const { items: next } = await clearShoppingList()
      setItems(next)
      // Tell the route the empty list is deliberate, so it does not re-seed.
      onCleared?.()
    } catch {
      // no-op; the list simply stays as it was.
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section aria-labelledby="list-heading" className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2
            id="list-heading"
            className="text-sm font-semibold tracking-tight"
          >
            Your list
          </h2>
          {items.length > 0 && (
            <Badge variant="primary">{remaining} left</Badge>
          )}
        </div>
        {items.length > 0 && (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              disabled={busyId === '__all__'}
              onClick={toggleAll}
            >
              {allChecked ? 'Uncheck all' : 'Check all'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={busyId === '__clear__'}
              aria-label={
                confirmingClear ? 'Confirm clear all items' : 'Clear all items'
              }
              onClick={() => void clearAll()}
              className={
                confirmingClear ? 'text-destructive' : 'text-muted-foreground'
              }
            >
              {confirmingClear ? 'Clear all?' : 'Clear all'}
            </Button>
          </div>
        )}
      </div>

      {unchecked.length > 0 && (
        <div className="bg-card border-border divide-border divide-y overflow-hidden rounded-[var(--radius-ios)] border">
          {unchecked.map((item) => (
            <ItemRow
              key={item.id}
              item={item}
              busy={busyId === item.id}
              onToggle={() => toggle(item)}
              onSaveName={(v) => saveField(item.id, 'name', v)}
              onSaveAmount={(v) => saveField(item.id, 'amount', v)}
              onRemove={() => remove(item.id)}
            />
          ))}
        </div>
      )}

      {checked.length > 0 && (
        <div className="space-y-2">
          <p className="text-muted-foreground/80 px-1 text-xs font-medium">
            In the trolley ({checked.length})
          </p>
          <div className="bg-card/60 border-border divide-border divide-y overflow-hidden rounded-[var(--radius-ios)] border">
            {checked.map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                busy={busyId === item.id}
                onToggle={() => toggle(item)}
                onSaveName={(v) => saveField(item.id, 'name', v)}
                onSaveAmount={(v) => saveField(item.id, 'amount', v)}
                onRemove={() => remove(item.id)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Add a manual item */}
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <Input
            aria-label="New item name"
            placeholder="Add an item..."
            value={newName}
            enterKeyHint="done"
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void add()
            }}
            className="h-12 text-base"
          />
        </div>
        <div className="w-24 shrink-0">
          <Input
            aria-label="New item amount"
            placeholder="Amount"
            value={newAmount}
            enterKeyHint="done"
            onChange={(e) => setNewAmount(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void add()
            }}
            className="h-12 text-base"
          />
        </div>
        <Button
          size="icon"
          className="h-12 w-12 shrink-0"
          aria-label="Add item"
          disabled={adding || !newName.trim()}
          onClick={() => void add()}
        >
          <Plus className="h-5 w-5" aria-hidden />
        </Button>
      </div>
    </section>
  )
}

/** One editable row. Name + amount edit inline; the round box ticks it off. */
function ItemRow({
  item,
  busy,
  onToggle,
  onSaveName,
  onSaveAmount,
  onRemove,
}: {
  item: ShoppingItem
  busy: boolean
  onToggle: () => void
  onSaveName: (value: string) => void
  onSaveAmount: (value: string) => void
  onRemove: () => void
}) {
  const sticker = ingredientSticker(item.name)
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <button
        type="button"
        role="checkbox"
        aria-checked={item.checked}
        aria-label={`Tick off ${item.name}`}
        disabled={busy}
        onClick={onToggle}
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border transition-colors ${
          item.checked
            ? 'bg-primary border-primary text-primary-foreground'
            : 'border-border bg-transparent'
        }`}
      >
        {item.checked && <Check className="h-4 w-4" aria-hidden />}
      </button>

      {/* Cut-out product sticker (or a neutral tile when we have no match). */}
      <div
        className={`bg-secondary flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${
          item.checked ? 'opacity-50' : ''
        }`}
      >
        {sticker ? (
          <img
            src={sticker}
            alt=""
            aria-hidden
            className="souso-sticker h-8 w-8 object-contain"
            style={{ transform: 'rotate(-3deg)' }}
          />
        ) : (
          <ShoppingBasket
            className="text-muted-foreground/50 h-5 w-5"
            aria-hidden
          />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <InlineEdit
          value={item.name}
          ariaLabel={`Edit name of ${item.name}`}
          placeholder="Item name"
          onSave={onSaveName}
          className={
            item.checked
              ? 'text-muted-foreground font-medium line-through'
              : 'font-medium'
          }
        />
      </div>

      <div className="w-20 shrink-0 text-right">
        <InlineEdit
          value={item.amount ?? ''}
          ariaLabel={
            item.amount
              ? `Edit amount of ${item.name}`
              : `Add an amount for ${item.name}`
          }
          // Empty amounts read as a quiet "+" affordance, not the word
          // "Amount", so most rows are just a clean name (#178 de-noise).
          placeholder="+"
          onSave={onSaveAmount}
          className={`text-sm font-semibold tabular-nums ${
            item.checked ? 'text-muted-foreground' : 'text-foreground'
          }`}
          emptyClassName="text-muted-foreground/35 text-base font-normal"
          align="right"
        />
      </div>

      <Button
        variant="ghost"
        size="icon"
        className="h-9 w-9 shrink-0"
        disabled={busy}
        aria-label={`Remove ${item.name}`}
        onClick={onRemove}
      >
        <Trash2 className="text-muted-foreground h-4 w-4" aria-hidden />
      </Button>
    </div>
  )
}

/**
 * An inline-editable text field: shows the value as a tappable button; tapping
 * swaps to an input. Saves on blur or Enter, cancels on Escape. Keeps the
 * persisted edit cheap and touch-friendly (no separate edit mode for the row).
 */
function InlineEdit({
  value,
  ariaLabel,
  placeholder,
  onSave,
  className = '',
  emptyClassName = 'text-muted-foreground/60 italic',
  align = 'left',
}: {
  value: string
  ariaLabel: string
  placeholder: string
  onSave: (value: string) => void
  className?: string
  /** Styling for the placeholder shown when the value is empty. */
  emptyClassName?: string
  align?: 'left' | 'right'
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)

  function start() {
    setDraft(value)
    setEditing(true)
  }

  function commit() {
    setEditing(false)
    if (draft.trim() !== value.trim()) onSave(draft.trim())
  }

  if (editing) {
    return (
      <Input
        autoFocus
        aria-label={ariaLabel}
        placeholder={placeholder}
        value={draft}
        enterKeyHint="done"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit()
          } else if (e.key === 'Escape') {
            setEditing(false)
            setDraft(value)
          }
        }}
        className={`h-9 ${align === 'right' ? 'text-right' : ''} text-base`}
      />
    )
  }

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={start}
      className={`block w-full truncate ${
        align === 'right' ? 'text-right' : 'text-left'
      } ${className}`}
    >
      {value || <span className={emptyClassName}>{placeholder}</span>}
    </button>
  )
}
