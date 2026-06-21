import * as React from 'react'
import {
  Heart,
  ThumbsDown,
  Plus,
  X,
  Check,
  Salad,
  PiggyBank,
  Brain,
  ChefHat,
  ShoppingCart,
  Sprout,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Sheet } from '#/components/ui/sheet'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { cn } from '#/lib/utils'
import { suggestDislikes } from '#/lib/onboarding/common-dislikes'
import { updateHouseholdProfile } from '#/lib/profile-edit-server'
import type { EditableProfile } from '#/lib/profile-edit-server'

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
 * are held locally until "Save", then one round-trip persists the whole patch.
 */

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
  { label: 'Lighten the mental load', icon: Brain },
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
  // A local draft so edits feel instant and a single Save persists them all.
  const [liked, setLiked] = React.useState(current.cuisinesLiked)
  const [disliked, setDisliked] = React.useState(current.cuisinesDisliked)
  const [dislikes, setDislikes] = React.useState(current.dislikes)
  const [diet, setDiet] = React.useState(current.diet)
  const [goals, setGoals] = React.useState(current.goals)
  const [query, setQuery] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState(false)

  // Re-seed the draft whenever the sheet (re)opens with fresh server values.
  React.useEffect(() => {
    if (open) {
      setLiked(current.cuisinesLiked)
      setDisliked(current.cuisinesDisliked)
      setDislikes(current.dislikes)
      setDiet(current.diet)
      setGoals(current.goals)
      setQuery('')
      setError(false)
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

  async function save() {
    setError(false)
    setSaving(true)
    try {
      const next = await updateHouseholdProfile({
        data: {
          patch: {
            cuisinesLiked: liked,
            cuisinesDisliked: disliked,
            dislikes,
            diet,
            goals,
          },
        },
      })
      onSaved(next)
      onOpenChange(false)
    } catch {
      setError(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Your preferences">
      <div className="flex flex-col gap-6 pt-2 pb-2">
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

        {error && (
          <p role="status" className="text-muted-foreground text-xs">
            Couldn&apos;t save that just now. Tap Save to try again.
          </p>
        )}

        <Button
          size="pill"
          className="w-full"
          disabled={saving}
          onClick={() => void save()}
          data-testid="preferences-save"
        >
          {saving ? 'Saving…' : 'Save preferences'}
        </Button>
      </div>
    </Sheet>
  )
}
