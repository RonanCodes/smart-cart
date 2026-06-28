import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Plus, Trash2, ShoppingBasket } from 'lucide-react'
import { Input } from '#/components/ui/input'
import { Button } from '#/components/ui/button'
import { Badge } from '#/components/ui/badge'
import { ingredientSticker } from '#/lib/ingredient-sticker'
import { groupByCategory } from '#/lib/ingredient-category'
import { CartPriceSlot } from '#/components/shopping/CartPriceSlot'
import {
  addShoppingItem,
  updateShoppingItem,
  removeShoppingItem,
  setAllChecked,
  clearShoppingList,
} from '#/lib/shopping-list-server'
import { cleanRows, isPantryStaple } from '#/lib/shopping'
import type { ShoppingItem } from '#/lib/shopping'
import { lineKey } from '#/lib/use-price-comparison'
import { track, FUNNEL_EVENTS } from '#/lib/analytics'

/**
 * The editable, PERSISTED shopping list on the Shopping tab (#146).
 *
 * Everything here survives a reload because it is backed by the
 * `shopping_list_item` table, not derived from the week each load. The list is
 * owned as local state seeded from the loader, then kept in sync from each
 * server-fn response (no full-page reload), exactly like StaplesSection.
 *
 * The checkbox is an INCLUSION model (matches the design prototype): a CHECKED
 * row is IN the order, so the order / price / cart are built from the checked
 * set. Per row the household can:
 *  - select it into the order (a tap on the round checkbox),
 *  - rename it (tap the name, edit inline, blur / Enter to save),
 *  - re-amount it (tap the amount, edit inline),
 *  - remove it (the trash button).
 * Plus add a fresh manual item at the bottom and select all / clear the list.
 *
 * Mobile-first (390px), iOS card styling consistent with the rest of the app.
 */
export function EditableShoppingList({
  initialItems,
  onCleared,
  onItemsChange,
  priceMap,
  priceLoading = false,
  pendingLineKeys,
}: {
  initialItems: Array<ShoppingItem>
  /**
   * Fired after a SUCCESSFUL "Clear all". The route wires it to
   * `router.invalidate()` so its 30s loader cache (#251) is dropped and a
   * back-nav within that window re-reads the now-empty list instead of serving
   * the stale pre-clear bootstrap.
   */
  onCleared?: () => void
  /**
   * Fired whenever the items change (tick, edit, add, remove, clear). The route
   * lifts this up so the price comparison + the single cart action recompute
   * from the live SELECTED (in-order) set as the user ticks rows in (#311), with
   * no full reload. The list still owns its own server round-trips; this is a
   * read-only mirror for the siblings below it.
   */
  onItemsChange?: (items: Array<ShoppingItem>) => void
  /**
   * Per-item price for the SELECTED store, keyed on the item name, in cents
   * (#cart-align). When supplied a row shows its line price; a name with no
   * entry shows no price (no match at this store). Undefined = no pricing yet
   * (still loading, or no comparison available), so rows show name + amount only.
   */
  priceMap?: Map<string, number>
  /** True while the matcher is still running for the live cart. */
  priceLoading?: boolean
  /**
   * Line keys still being priced (#cart-incremental-price). Checked rows in this
   * set show a quiet "pricing…" affordance until their price lands.
   */
  pendingLineKeys?: ReadonlySet<string>
}) {
  // Clean the persisted rows before anything renders or flows up to the route
  // (#cart-clean): drop cooking water ("tap water 1200 ml"), blank zero amounts
  // ("chilli flakes 0 tsp"), and merge spelling-variant duplicates ("chili
  // flakes" + "chilli flakes") into one row. Applied here so it also fixes rows
  // saved BEFORE this shipped, not just freshly derived ones. Every server
  // response is re-cleaned via `commit` below so the list never drifts back.
  const [items, setItems] = useState<Array<ShoppingItem>>(() =>
    cleanRows(initialItems),
  )

  /** Apply a server response: clean it, then store it. The single write path. */
  const commit = (next: Array<ShoppingItem>) => setItems(cleanRows(next))

  // Mirror every items change up to the route (#311). An effect (not a call in
  // each setItems site) keeps the single source of truth here and fires once per
  // committed render, including the initial mount so the siblings start in sync.
  const onItemsChangeRef = useRef(onItemsChange)
  onItemsChangeRef.current = onItemsChange
  useEffect(() => {
    onItemsChangeRef.current?.(items)
  }, [items])
  const [busyId, setBusyId] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [newAmount, setNewAmount] = useState('')
  const [adding, setAdding] = useState(false)
  /**
   * The inline "Add an item" composer is collapsed by default so the main view
   * stays clean like the design; a small affordance at the bottom opens it. The
   * functionality is unchanged, just de-emphasised.
   */
  const [addOpen, setAddOpen] = useState(false)
  /** Two-tap guard for "Clear all": first tap arms it, second confirms. */
  const [confirmingClear, setConfirmingClear] = useState(false)
  /** A failed bulk action (clear / check-all) , shown instead of failing silently. */
  const [actionError, setActionError] = useState<string | null>(null)

  const selectedCount = items.filter((i) => i.checked).length
  const allChecked = items.length > 0 && selectedCount === items.length
  // Aisle grouping is the PRIMARY structure (matches TJ's design): selected AND
  // unselected rows live TOGETHER inside each aisle (Produce, Dairy & cheese,
  // ...), each carrying its own checkbox state (checked = in your order). No
  // separate "Not in your order" dump. A checked row reads as in-order; an
  // unchecked one is dimmed in place. Order within each aisle is preserved
  // (oldest-first from the loader).
  const aisleGroups = useMemo(
    () => groupByCategory(items, (i) => i.name),
    [items],
  )

  async function toggle(item: ShoppingItem) {
    setBusyId(item.id)
    try {
      const { items: next } = await updateShoppingItem({
        data: { id: item.id, checked: !item.checked },
      })
      commit(next)
      // Ticking a row in/out of the order. `!item.checked` is the NEW state, so a
      // previously-unchecked row reads as a select, a checked one as a deselect.
      track(FUNNEL_EVENTS.cartUpdated, {
        action: !item.checked ? 'select' : 'deselect',
      })
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
      commit(next)
      // A rename or re-amount of a row. Only the amount edit maps to a quantity
      // change in the funnel; a rename is still an edit of the line.
      track(FUNNEL_EVENTS.cartUpdated, { action: 'edit_qty', field })
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
      commit(next)
      track(FUNNEL_EVENTS.cartUpdated, { action: 'remove' })
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
      commit(next)
      // A manually-typed item joined the list. Source separates this single add
      // from the week's bulk "add to list" so the two entries stay distinct.
      track(FUNNEL_EVENTS.addedToCart, { source: 'manual' })
      setNewName('')
      setNewAmount('')
      setAddOpen(false)
    } catch {
      // no-op
    } finally {
      setAdding(false)
    }
  }

  async function toggleAll() {
    setBusyId('__all__')
    setActionError(null)
    try {
      const { items: next } = await setAllChecked({
        data: { checked: !allChecked },
      })
      commit(next)
      // The bulk select/clear-selection toggle. `checked` (the new state) keeps the
      // single select_all action splittable into "selected all" vs "cleared all".
      track(FUNNEL_EVENTS.cartUpdated, {
        action: 'select_all',
        checked: !allChecked,
      })
    } catch {
      setActionError(
        'Could not update the list. Check your connection and try again.',
      )
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
    setActionError(null)
    try {
      const { items: next } = await clearShoppingList()
      commit(next)
      // The whole list was wiped (a real clear, not just a selection toggle).
      track(FUNNEL_EVENTS.cartUpdated, { action: 'clear_all' })
      // Signal the route so it can invalidate its 30s loader cache (#251). The
      // empty list already persists server-side, but without this the route
      // served the stale pre-clear bootstrap on back-nav within 30s, then
      // snapped to empty on the first tap. Only fired on a SUCCESSFUL clear, so
      // a failed clear leaves the still-valid cache (and the visible list) alone.
      onCleared?.()
    } catch {
      setActionError(
        'Could not clear the list. Check your connection and try again.',
      )
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
            <Badge variant="primary">{selectedCount} selected</Badge>
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
              {allChecked ? 'Clear' : 'Select all'}
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

      {actionError && (
        <p role="alert" className="text-destructive px-1 text-sm">
          {actionError}
        </p>
      )}

      {/* Aisle sections are the primary structure (matches the design). Each
          aisle is a quiet uppercase heading over hairline-separated rows: die-cut
          sticker, name + amount, per-store price, checkbox. Selected (checked,
          in-order) and unselected rows sit TOGETHER in each aisle; an unchecked
          row reads dimmed in place via the row's own checked styling. */}
      {aisleGroups.map((group) => (
        <section key={group.category} className="mb-4">
          <h3 className="text-muted-foreground mb-1 px-1 text-[0.7rem] font-bold tracking-[0.16em] uppercase">
            {group.category}
          </h3>
          <div>
            {group.items.map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                price={priceMap?.get(item.name)}
                pricePending={
                  item.checked &&
                  (pendingLineKeys?.has(
                    lineKey({ name: item.name, amount: item.amount }),
                  ) === true ||
                    (priceLoading &&
                      priceMap?.get(item.name) === undefined &&
                      (pendingLineKeys?.size ?? 0) > 0))
                }
                busy={busyId === item.id}
                onToggle={() => toggle(item)}
                onSaveName={(v) => saveField(item.id, 'name', v)}
                onSaveAmount={(v) => saveField(item.id, 'amount', v)}
                onRemove={() => remove(item.id)}
              />
            ))}
          </div>
        </section>
      ))}

      {/* Add a manual item — collapsed behind a small affordance so the default
          view stays clean (the design has no inline composer). Tapping it reveals
          the same name + amount inputs; the functionality is unchanged. */}
      {addOpen ? (
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <Input
              autoFocus
              aria-label="New item name"
              placeholder="Add an item..."
              value={newName}
              enterKeyHint="done"
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void add()
                else if (e.key === 'Escape') setAddOpen(false)
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
                else if (e.key === 'Escape') setAddOpen(false)
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
      ) : (
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="text-muted-foreground hover:text-foreground flex items-center gap-1.5 px-1 text-sm font-medium transition-colors"
        >
          <Plus className="h-4 w-4" aria-hidden />
          Add an item
        </button>
      )}
    </section>
  )
}

/**
 * One editable hairline row (#cart-align): die-cut sticker, inline-editable name
 * + amount, the selected store's per-item price, and the round tick box. Name +
 * amount still edit inline; the round box selects it INTO the order (checked =
 * in your order, filled + active); the trash button removes it. A bottom hairline
 * (last:border-b-0) gives the airy grouped look.
 */
function ItemRow({
  item,
  price,
  pricePending,
  busy,
  onToggle,
  onSaveName,
  onSaveAmount,
  onRemove,
}: {
  item: ShoppingItem
  /** Line price in cents for the selected store, or undefined when no match. */
  price?: number
  /** True while the matcher is still resolving this row's price. */
  pricePending?: boolean
  busy: boolean
  onToggle: () => void
  onSaveName: (value: string) => void
  onSaveAmount: (value: string) => void
  onRemove: () => void
}) {
  const sticker = ingredientSticker(item.name)
  // A recognised pantry staple (salt, oil, vanilla, ...) is added UNticked so it
  // does not inflate the basket (#cart-staples). Show a quiet hint while it is
  // out of the order so the user understands why and can tick it in; once
  // ticked the hint drops away (they have decided to buy it).
  const showStapleHint = !item.checked && isPantryStaple(item.name)
  return (
    <div className="border-hairline flex items-center gap-3 border-b py-3 last:border-b-0">
      {/* Cut-out product sticker (or a neutral tile when we have no match). */}
      <div
        className={`bg-secondary flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${
          item.checked ? '' : 'opacity-50'
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
              ? 'text-[0.95rem] font-semibold'
              : 'text-muted-foreground text-[0.95rem] font-semibold'
          }
        />
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
          className="text-muted-foreground text-xs"
          emptyClassName="text-muted-foreground/35 text-sm font-normal"
        />
        {showStapleHint && (
          <p className="text-muted-foreground/70 text-[0.7rem] italic">
            you likely have this
          </p>
        )}
      </div>

      {/* The selected store's per-item price (#cart-align). */}
      <CartPriceSlot
        priceCents={price}
        pending={pricePending}
        reserve={item.checked}
        checked={item.checked}
      />

      <button
        type="button"
        role="checkbox"
        aria-checked={item.checked}
        aria-label={
          item.checked
            ? `Remove ${item.name} from your order`
            : `Add ${item.name} to your order`
        }
        disabled={busy}
        onClick={onToggle}
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border transition active:scale-90 ${
          item.checked
            ? 'bg-primary border-primary text-primary-foreground'
            : 'border-border bg-card'
        }`}
      >
        {item.checked && (
          <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden />
        )}
      </button>

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
