import * as React from 'react'
import {
  Heart,
  ThumbsDown,
  Plus,
  X,
  Check,
  Salad,
  PiggyBank,
  ChefHat,
  ShoppingCart,
  Sprout,
  Loader2,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Sheet } from '#/components/ui/sheet'
import { Input } from '#/components/ui/input'
import { cn } from '#/lib/utils'
import { suggestDislikes } from '#/lib/onboarding/common-dislikes'
import { updateHouseholdProfile } from '#/lib/profile-edit-server'
import type { EditableProfile, ProfilePatch } from '#/lib/profile-edit-server'

/**
 * PreferencesSheet — the Profile-tab editor for the household's STATED data
 * points (#data-points): liked / disliked cuisines, ingredients to avoid, diet,
 * and goals. Mirrors the onboarding steps' inputs (cuisine cycle tiles, dislikes
 * autocomplete, diet + goals multi-selects) but operates on a LOCAL draft and
 * persists through `updateHouseholdProfile`, the same way StoreSheet persists
 * through setStore. Saving merges into household.profile, so the next generated
 * week honours the edit (the planner reads household.profile).
 *
 * Mobile-first at 390px: iOS sheet styling, big tap targets, calm copy. Edits
 * AUTOSAVE: every change schedules a single debounced patch round-trip (#376),
 * so the user never has to hunt for a buried Save button or risk losing a
 * change. A small status line in the sheet header reflects saving / saved /
 * couldn't-save so the persistence state is always visible.
 */

/** How long after the last change before the coalesced patch is sent. */
const AUTOSAVE_DEBOUNCE_MS = 600

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

const CUISINES: ReadonlyArray<string> = [
  'Italian',
  'Mexican',
  'Thai',
  'Indian',
  'Chinese',
  'Japanese',
  'French',
  'Greek',
  'Dutch',
  'Spanish',
  'Turkish',
  'Moroccan',
  'American',
  'Vietnamese',
]

const SUGGESTED_DISLIKES: ReadonlyArray<string> = [
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
]

const DIET_OPTIONS: ReadonlyArray<string> = [
  'Dairy free',
  'Gluten free',
  'Porkless',
  'Vegan',
  'Vegetarian',
  'Pescatarian',
]

// Lucide icons (no emoji), matching the onboarding goals-step so the profile
// editor and onboarding read identically.
const GOAL_OPTIONS: ReadonlyArray<{ label: string; icon: LucideIcon }> = [
  { label: 'Eat a more balanced diet', icon: Salad },
  { label: 'Pay less for my groceries', icon: PiggyBank },
  { label: 'Cook and discover new recipes', icon: ChefHat },
  { label: 'Avoid unnecessary purchases', icon: ShoppingCart },
  { label: 'Eat less meat', icon: Sprout },
]

function includesCI(list: ReadonlyArray<string>, value: string): boolean {
  const v = value.trim().toLowerCase()
  return list.some((item) => item.toLowerCase() === v)
}

function withoutCI(list: ReadonlyArray<string>, value: string): Array<string> {
  const v = value.trim().toLowerCase()
  return list.filter((item) => item.toLowerCase() !== v)
}

type CuisineState = 'neutral' | 'like' | 'hate'

export function PreferencesSheet({
  open,
  onOpenChange,
  current,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  current: EditableProfile
  onSaved: (next: EditableProfile) => void
}) {
  // A local draft so edits feel instant; autosave persists them in the
  // background (#376).
  const [liked, setLiked] = React.useState(current.cuisinesLiked)
  const [disliked, setDisliked] = React.useState(current.cuisinesDisliked)
  const [dislikes, setDislikes] = React.useState(current.dislikes)
  const [diet, setDiet] = React.useState(current.diet)
  const [goals, setGoals] = React.useState(current.goals)
  const [query, setQuery] = React.useState('')
  const [status, setStatus] = React.useState<SaveStatus>('idle')

  // Re-seed the draft whenever the sheet (re)opens with fresh server values.
  React.useEffect(() => {
    if (open) {
      setLiked(current.cuisinesLiked)
      setDisliked(current.cuisinesDisliked)
      setDislikes(current.dislikes)
      setDiet(current.diet)
      setGoals(current.goals)
      setQuery('')
      setStatus('idle')
    }
  }, [open, current])

  function cuisineState(cuisine: string): CuisineState {
    if (includesCI(liked, cuisine)) return 'like'
    if (includesCI(disliked, cuisine)) return 'hate'
    return 'neutral'
  }

  function cycleCuisine(cuisine: string) {
    const state = cuisineState(cuisine)
    if (state === 'neutral') {
      setLiked((l) => [...l, cuisine])
      setDisliked((d) => withoutCI(d, cuisine))
    } else if (state === 'like') {
      setLiked((l) => withoutCI(l, cuisine))
      setDisliked((d) => [...withoutCI(d, cuisine), cuisine])
    } else {
      setLiked((l) => withoutCI(l, cuisine))
      setDisliked((d) => withoutCI(d, cuisine))
    }
  }

  const dislikePills = React.useMemo(() => {
    const extras = dislikes.filter((d) => !includesCI(SUGGESTED_DISLIKES, d))
    return [...SUGGESTED_DISLIKES, ...extras]
  }, [dislikes])

  function toggleDislike(label: string) {
    setDislikes((d) =>
      includesCI(d, label) ? withoutCI(d, label) : [...d, label],
    )
  }

  function addDislike(label: string) {
    const value = label.trim()
    if (value && !includesCI(dislikes, value)) {
      setDislikes((d) => [...d, value])
    }
    setQuery('')
  }

  const suggestions = React.useMemo(
    () =>
      suggestDislikes(query, { shown: SUGGESTED_DISLIKES, selected: dislikes }),
    [query, dislikes],
  )

  function toggleDiet(label: string) {
    setDiet((d) =>
      d.includes(label) ? d.filter((x) => x !== label) : [...d, label],
    )
  }

  function toggleGoal(label: string) {
    setGoals((g) =>
      g.includes(label) ? g.filter((x) => x !== label) : [...g, label],
    )
  }

  // Keep the latest onSaved handler in a ref so the autosave effect doesn't
  // re-subscribe (and re-fire) every render when the parent passes a fresh fn.
  const onSavedRef = React.useRef(onSaved)
  onSavedRef.current = onSaved

  // Autosave: debounce a single patch round-trip after the draft settles.
  // `baselineRef` holds the last-known-persisted draft (a JSON snapshot); we
  // only save when the current draft actually differs from it. This makes
  // opening the sheet, the re-seed effect above, and a server echo all no-ops,
  // so there's never a spurious save (#376), while a real edit always persists.
  // Both the baseline and the live draft go through `serialise` so the same
  // ordering + shape compares equal.
  const serialise = (p: ProfilePatch) =>
    JSON.stringify({
      cuisinesLiked: p.cuisinesLiked,
      cuisinesDisliked: p.cuisinesDisliked,
      dislikes: p.dislikes,
      diet: p.diet,
      goals: p.goals,
    })

  const baselineRef = React.useRef('')
  // When the sheet (re)opens with fresh values, reset the baseline so the seeded
  // draft is the "nothing to save" starting point.
  React.useEffect(() => {
    if (open) baselineRef.current = serialise(current)
    // serialise is a pure local helper; `current` is the only meaningful input.
  }, [open, current])

  const patchKey = serialise({
    cuisinesLiked: liked,
    cuisinesDisliked: disliked,
    dislikes,
    diet,
    goals,
  })
  React.useEffect(() => {
    if (!open) return
    if (patchKey === baselineRef.current) return

    const patch: ProfilePatch = {
      cuisinesLiked: liked,
      cuisinesDisliked: disliked,
      dislikes,
      diet,
      goals,
    }
    const timer = setTimeout(() => {
      setStatus('saving')
      void updateHouseholdProfile({ data: { patch } })
        .then((next) => {
          baselineRef.current = patchKey
          onSavedRef.current(next)
          setStatus('saved')
        })
        .catch(() => {
          setStatus('error')
        })
    }, AUTOSAVE_DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [patchKey, open, liked, disliked, dislikes, diet, goals])

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Your preferences">
      <div className="flex flex-col gap-6 pt-2 pb-2">
        {/* Autosave status: always visible so the user knows their changes are
            being persisted without hunting for a Save button (#376). */}
        <SaveStatusLine status={status} />

        <section className="flex flex-col gap-3">
          <div>
            <h3 className="text-sm font-semibold">Cuisines</h3>
            <p className="text-muted-foreground text-xs">
              Tap once to love it, twice to skip it. We lean your week toward
              the ones you love.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            {CUISINES.map((cuisine) => {
              const state = cuisineState(cuisine)
              return (
                <button
                  key={cuisine}
                  type="button"
                  aria-pressed={state !== 'neutral'}
                  onClick={() => cycleCuisine(cuisine)}
                  className={cn(
                    'flex h-12 touch-manipulation items-center justify-between rounded-2xl border px-4 text-sm font-medium transition active:scale-95',
                    state === 'like' &&
                      'border-primary bg-primary text-primary-foreground',
                    state === 'hate' &&
                      'border-destructive bg-destructive/10 text-destructive',
                    state === 'neutral' &&
                      'border-border bg-card text-foreground',
                  )}
                >
                  <span>{cuisine}</span>
                  {state === 'like' && (
                    <Heart aria-hidden className="h-4 w-4 fill-current" />
                  )}
                  {state === 'hate' && (
                    <ThumbsDown aria-hidden className="h-4 w-4" />
                  )}
                </button>
              )
            })}
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <div>
            <h3 className="text-sm font-semibold">Ingredients to avoid</h3>
            <p className="text-muted-foreground text-xs">
              We never put these in your week.
            </p>
          </div>
          <div
            className="flex flex-wrap gap-2"
            aria-label="Ingredients to avoid"
          >
            {dislikePills.map((label) => {
              const isOn = includesCI(dislikes, label)
              return (
                <button
                  key={label}
                  type="button"
                  aria-pressed={isOn}
                  onClick={() => toggleDislike(label)}
                  className={cn(
                    'inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition active:scale-95',
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
          <div className="flex items-center gap-2">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addDislike(query)
                }
              }}
              placeholder="Add an ingredient"
              aria-label="Add an ingredient"
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              className="h-11"
            />
            <button
              type="button"
              onClick={() => addDislike(query)}
              disabled={!query.trim()}
              aria-label="Add ingredient"
              className="border-border bg-card flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border transition active:scale-95 disabled:opacity-40"
            >
              <Plus className="h-5 w-5" />
            </button>
          </div>
          {suggestions.length > 0 && (
            <ul className="border-border bg-card flex flex-col overflow-hidden rounded-lg border">
              {suggestions.map((label) => (
                <li key={label}>
                  <button
                    type="button"
                    onClick={() => addDislike(label)}
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
        </section>

        <section className="flex flex-col gap-3">
          <div>
            <h3 className="text-sm font-semibold">Diet</h3>
            <p className="text-muted-foreground text-xs">
              Always honoured — we never suggest a meal that breaks one.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            {DIET_OPTIONS.map((label) => {
              const isOn = diet.includes(label)
              return (
                <button
                  key={label}
                  type="button"
                  aria-pressed={isOn}
                  onClick={() => toggleDiet(label)}
                  className={cn(
                    'flex h-12 items-center justify-center rounded-[var(--radius-ios)] border px-3 text-sm font-medium transition active:scale-95',
                    isOn
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-card text-foreground',
                  )}
                >
                  {label}
                </button>
              )
            })}
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <div>
            <h3 className="text-sm font-semibold">Goals</h3>
            <p className="text-muted-foreground text-xs">
              We gently weight your week toward these.
            </p>
          </div>
          <div className="flex flex-col gap-2.5">
            {GOAL_OPTIONS.map(({ label, icon: Icon }) => {
              const isOn = goals.includes(label)
              return (
                <button
                  key={label}
                  type="button"
                  aria-pressed={isOn}
                  onClick={() => toggleGoal(label)}
                  className={cn(
                    'flex h-14 w-full items-center gap-3 rounded-[var(--radius-ios)] border px-4 text-left text-sm font-medium transition active:scale-[0.98]',
                    isOn
                      ? 'border-primary bg-primary/5 text-foreground'
                      : 'border-border bg-card text-foreground',
                  )}
                >
                  <span
                    aria-hidden
                    className="bg-secondary text-primary flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
                  >
                    <Icon className="h-[1.15rem] w-[1.15rem]" />
                  </span>
                  <span className="flex-1">{label}</span>
                  <span
                    aria-hidden
                    className={cn(
                      'flex h-6 w-6 shrink-0 items-center justify-center rounded-md border transition',
                      isOn
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border bg-background',
                    )}
                  >
                    {isOn && <Check className="h-4 w-4" />}
                  </span>
                </button>
              )
            })}
          </div>
        </section>
      </div>
    </Sheet>
  )
}

/**
 * The autosave status line shown at the top of the sheet. It reflects the four
 * states of the background patch round-trip so the user always knows whether
 * their changes are persisted (#376): idle (nothing yet), saving, saved, and a
 * quiet retry-on-next-change error. role="status" announces changes to AT.
 */
function SaveStatusLine({ status }: { status: SaveStatus }) {
  return (
    <p
      role="status"
      aria-live="polite"
      className={cn(
        'flex items-center gap-1.5 text-xs',
        status === 'error' ? 'text-destructive' : 'text-muted-foreground',
      )}
    >
      {status === 'saving' && (
        <>
          <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />
          Saving…
        </>
      )}
      {status === 'saved' && (
        <>
          <Check aria-hidden className="h-3.5 w-3.5" />
          Saved
        </>
      )}
      {status === 'error' && 'Couldn’t save that. Change anything to retry.'}
      {status === 'idle' &&
        'Changes save automatically as you tweak your preferences.'}
    </p>
  )
}
