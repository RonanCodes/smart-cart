import * as React from 'react'
import { Plus, X, Search, UtensilsCrossed } from 'lucide-react'
import { Input } from '#/components/ui/input'
import { cn } from '#/lib/utils'
import { suggestDislikes } from '#/lib/onboarding/common-dislikes'
import {
  canonicalDislikeKey,
  dedupeSynonyms,
} from '#/lib/onboarding/dislike-synonyms'
import { useOnboardingForm } from '../form-state'

/**
 * DislikesStep — the 'ingredients to avoid' screen of the Jow-style onboarding.
 * Souso / Julienne styling: one centred focus (a die-cut hero mark), generous
 * whitespace, and airy outline pills. Default pill = paper + hairline + plus;
 * selected pill = olive fill + struck-through label + x. The user can search any
 * ingredient to add it. Everything selected becomes a HARD filter in the planner.
 *
 * Reads + writes `draft.dislikes` via useOnboardingForm. No emoji: the hero is a
 * Lucide mark and the chips are text, in line with the Souso icon set.
 */

/**
 * The default pill set, the common avoid-list from the Jow reference. Deduped of
 * synonym pairs (#370) so the user never sees two names for one ingredient —
 * e.g. the raw list carries both 'Cilantro' and 'Coriander', the same herb, and
 * only the first survives.
 */
const SUGGESTED: ReadonlyArray<string> = dedupeSynonyms([
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
])

/** Avoid-chips that ship with a cut-out product sticker (public/stickers). */
const STICKER_SLUGS = new Set([
  'shellfish',
  'nuts',
  'egg',
  'soy',
  'mushroom',
  'cilantro',
  'fish',
  'tomato',
  'dairy',
  'onion',
  'garlic',
  'pepper',
  'coriander',
])
function stickerSrc(label: string): string | null {
  const slug = label.trim().toLowerCase()
  return STICKER_SLUGS.has(slug) ? `/stickers/ingredients/${slug}.png` : null
}

/**
 * Synonym-aware membership: 'Egg' and 'egg' never double up, and neither do
 * synonym pairs like 'Cilantro' / 'Coriander' (#370) — both canonicalise to the
 * same key, so selecting one counts as selecting the other.
 */
function includesCI(list: ReadonlyArray<string>, value: string): boolean {
  const key = canonicalDislikeKey(value)
  return list.some((item) => canonicalDislikeKey(item) === key)
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
      const key = canonicalDislikeKey(label)
      patch({
        dislikes: selected.filter((d) => canonicalDislikeKey(d) !== key),
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
    <div
      className="flex flex-col items-center gap-5 pt-2"
      data-testid="dislikes-step"
    >
      {/* Centred hero — a die-cut mark with an olive "avoid" badge. */}
      <div className="relative">
        <div className="bg-secondary flex h-20 w-20 items-center justify-center rounded-full border-4 border-white shadow-md">
          <UtensilsCrossed className="text-primary h-8 w-8" />
        </div>
        <span className="bg-primary border-background absolute right-0 bottom-0 flex h-7 w-7 items-center justify-center rounded-full border-[3px] text-white">
          <X className="h-3.5 w-3.5" strokeWidth={2.6} />
        </span>
      </div>

      <div className="px-2 text-center">
        <h1
          className="text-[1.7rem] leading-tight font-bold"
          style={{ letterSpacing: '-0.03em' }}
        >
          Dislikes
        </h1>
        <p className="text-muted-foreground mx-auto mt-1.5 max-w-[20rem] text-sm">
          Choose what we leave out. We tune your week around it.
        </p>
      </div>

      <div
        className="flex flex-wrap justify-center gap-2"
        role="group"
        aria-label="Ingredients to avoid"
      >
        {pills.map((label) => {
          const isOn = includesCI(selected, label)
          const src = stickerSrc(label)
          return (
            <button
              key={label}
              type="button"
              aria-pressed={isOn}
              onClick={() => toggle(label)}
              className={cn(
                'inline-flex h-10 items-center gap-1.5 rounded-full border text-sm font-medium shadow-sm transition active:scale-95',
                src ? 'py-1 pr-4 pl-1.5' : 'px-4',
                isOn
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-card text-foreground',
              )}
            >
              {src && (
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white shadow-sm">
                  <img
                    src={src}
                    alt=""
                    aria-hidden
                    className="h-5 w-5 object-contain"
                  />
                </span>
              )}
              <span className={cn(isOn && 'line-through')}>{label}</span>
              {isOn ? (
                <X aria-hidden className="h-3.5 w-3.5" />
              ) : (
                <Plus aria-hidden className="h-3.5 w-3.5 opacity-50" />
              )}
            </button>
          )
        })}
      </div>

      <div className="flex w-full max-w-sm flex-col gap-2">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search
              aria-hidden
              className="text-muted-foreground pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2"
            />
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
              className="h-11 rounded-full pl-10"
            />
          </div>
          <button
            type="button"
            onClick={addCustom}
            disabled={!query.trim()}
            aria-label="Add ingredient"
            className="border-border bg-card flex h-11 w-11 shrink-0 items-center justify-center rounded-full border transition active:scale-95 disabled:opacity-40"
          >
            <Plus className="h-5 w-5" />
          </button>
        </div>

        {suggestions.length > 0 && (
          <ul
            id="dislikes-suggestions"
            role="listbox"
            aria-label="Suggested ingredients"
            className="border-border bg-card flex flex-col overflow-hidden rounded-2xl border"
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
