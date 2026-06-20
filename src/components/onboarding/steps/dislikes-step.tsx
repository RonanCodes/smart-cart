import * as React from 'react'
import { Plus, X } from 'lucide-react'
import { Input } from '#/components/ui/input'
import { cn } from '#/lib/utils'
import { suggestDislikes } from '#/lib/onboarding/common-dislikes'
import { useOnboardingForm } from '../form-state'

/**
 * DislikesStep — the 'ingredients to avoid' screen of the Jow-style onboarding
 * (parent PRD #104, slice #107). The user toggles a grid of common-allergen and
 * disliked-ingredient pills, and can type any other ingredient into the search
 * box to add it. Everything selected becomes a HARD filter in the planner, so
 * the wording is deliberately about avoidance, not preference.
 *
 * Reads + writes `draft.dislikes` (a string array) via useOnboardingForm. Labels
 * are stored verbatim; matching against recipes is the planner's job.
 *
 * Mobile first at 390px: pills are tap-sized, wrap freely, and a tapped pill
 * shows a remove affordance so the whole interaction stays thumb-driven.
 */

/** The default pill set, the common avoid-list from the Jow reference. */
const SUGGESTED: ReadonlyArray<string> = [
  'Shellfish',
  'Nuts',
  'Egg',
  'Soy',
  'Mushroom',
  'Cilantro',
  'Olives',
  'Fish',
  'Tomato',
  'Dairy',
  'Onion',
  'Garlic',
  'Pepper',
  'Coriander',
]

/** Case-insensitive membership so 'Egg' and 'egg' never double up. */
function includesCI(list: ReadonlyArray<string>, value: string): boolean {
  const v = value.trim().toLowerCase()
  return list.some((item) => item.toLowerCase() === v)
}

export function DislikesStep() {
  const { draft, patch } = useOnboardingForm()
  const [query, setQuery] = React.useState('')

  const selected = draft.dislikes

  /** The pills to show: the suggested set plus any custom additions the user
   * made that are not already in the suggested list. */
  const pills = React.useMemo(() => {
    const extras = selected.filter((d) => !includesCI(SUGGESTED, d))
    return [...SUGGESTED, ...extras]
  }, [selected])

  function toggle(label: string) {
    if (includesCI(selected, label)) {
      patch({
        dislikes: selected.filter(
          (d) => d.toLowerCase() !== label.toLowerCase(),
        ),
      })
    } else {
      patch({ dislikes: [...selected, label] })
    }
  }

  /** Add a specific label (from a suggestion tap) and clear the search box. */
  function add(label: string) {
    const value = label.trim()
    if (!value) return
    if (!includesCI(selected, value)) {
      patch({ dislikes: [...selected, value] })
    }
    setQuery('')
  }

  function addCustom() {
    add(query)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      addCustom()
    }
  }

  /** Autocomplete suggestions from the curated catalogue: matches `query`,
   * minus the preset chips on screen and anything already selected. */
  const suggestions = React.useMemo(
    () => suggestDislikes(query, { shown: SUGGESTED, selected }),
    [query, selected],
  )

  return (
    <div className="flex flex-col gap-5" data-testid="dislikes-step">
      <div
        className="flex flex-wrap gap-2"
        role="group"
        aria-label="Ingredients to avoid"
      >
        {pills.map((label) => {
          const isOn = includesCI(selected, label)
          return (
            <button
              key={label}
              type="button"
              aria-pressed={isOn}
              onClick={() => toggle(label)}
              className={cn(
                'inline-flex h-10 items-center gap-1.5 rounded-full border px-4 text-sm font-medium transition active:scale-95',
                isOn
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-card text-foreground',
              )}
            >
              {label}
              {isOn && <X aria-hidden className="h-3.5 w-3.5" />}
            </button>
          )
        })}
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search an ingredient"
            aria-label="Search an ingredient"
            role="combobox"
            aria-expanded={suggestions.length > 0}
            aria-autocomplete="list"
            aria-controls="dislikes-suggestions"
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            className="h-11"
          />
          <button
            type="button"
            onClick={addCustom}
            disabled={!query.trim()}
            aria-label="Add ingredient"
            className="border-border bg-card flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border transition active:scale-95 disabled:opacity-40"
          >
            <Plus className="h-5 w-5" />
          </button>
        </div>

        {suggestions.length > 0 && (
          <ul
            id="dislikes-suggestions"
            role="listbox"
            aria-label="Suggested ingredients"
            className="border-border bg-card flex flex-col overflow-hidden rounded-lg border"
          >
            {suggestions.map((label) => (
              <li key={label} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={false}
                  onClick={() => add(label)}
                  className="border-border/60 hover:bg-muted active:bg-muted flex w-full items-center gap-2 border-b px-4 py-3 text-left text-sm transition last:border-b-0"
                >
                  <Plus
                    aria-hidden
                    className="text-muted-foreground h-4 w-4 shrink-0"
                  />
                  {label}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
