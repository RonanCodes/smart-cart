import { Heart, X } from 'lucide-react'
import { cn } from '#/lib/utils'
import { useOnboardingForm } from '../form-state'

/**
 * CuisineStep — the 'cuisines you like / hate' screen of the Jow-style
 * onboarding (parent PRD #121, slice #122). This replaces the retired swipe
 * taste signal: instead of swiping a deck, the user marks each cuisine as a
 * LIKE (heart), a HATE (cross), or leaves it neutral.
 *
 * Each tile cycles through three states on tap: neutral -> like -> hate ->
 * neutral. Liked cuisines bias the planner UP; hated ones are down-weighted.
 * Both lists feed the planner's cuisine net-preference term (see
 * planner.ts softScore); a cuisine never sits in both lists at once.
 *
 * Reads + writes draft.cuisinesLiked / draft.cuisinesDisliked via
 * useOnboardingForm. Labels are stored verbatim; the planner matches them
 * case-insensitively against each recipe's cuisine.
 *
 * Mobile first at 390px: a 2-column tap-grid, big thumb targets, an iOS-style
 * pressed scale, and a colour + icon cue so the state reads at a glance.
 */

/** The cuisine set, the common world-cuisine spread from the Jow reference. */
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

type CuisineState = 'neutral' | 'like' | 'hate'

/** Case-insensitive membership so 'Italian' and 'italian' never double up. */
function includesCI(list: ReadonlyArray<string>, value: string): boolean {
  const v = value.toLowerCase()
  return list.some((item) => item.toLowerCase() === v)
}

function withoutCI(list: ReadonlyArray<string>, value: string): Array<string> {
  const v = value.toLowerCase()
  return list.filter((item) => item.toLowerCase() !== v)
}

export function CuisineStep() {
  const { draft, patch } = useOnboardingForm()
  const liked = draft.cuisinesLiked
  const disliked = draft.cuisinesDisliked

  function stateOf(cuisine: string): CuisineState {
    if (includesCI(liked, cuisine)) return 'like'
    if (includesCI(disliked, cuisine)) return 'hate'
    return 'neutral'
  }

  /**
   * Cycle one cuisine neutral -> like -> hate -> neutral. A cuisine is never in
   * both lists: moving to a state strips it from the other list first.
   */
  function cycle(cuisine: string) {
    const current = stateOf(cuisine)
    if (current === 'neutral') {
      patch({
        cuisinesLiked: [...liked, cuisine],
        cuisinesDisliked: withoutCI(disliked, cuisine),
      })
    } else if (current === 'like') {
      patch({
        cuisinesLiked: withoutCI(liked, cuisine),
        cuisinesDisliked: [...withoutCI(disliked, cuisine), cuisine],
      })
    } else {
      patch({
        cuisinesLiked: withoutCI(liked, cuisine),
        cuisinesDisliked: withoutCI(disliked, cuisine),
      })
    }
  }

  return (
    <div className="flex flex-col gap-5" data-testid="cuisine-step">
      <div
        className="grid grid-cols-2 gap-2.5"
        role="group"
        aria-label="Cuisines you like or hate"
      >
        {CUISINES.map((cuisine) => {
          const state = stateOf(cuisine)
          return (
            <button
              key={cuisine}
              type="button"
              aria-label={cuisine}
              aria-pressed={state !== 'neutral'}
              data-state={state}
              onClick={() => cycle(cuisine)}
              className={cn(
                'flex h-14 items-center justify-between rounded-2xl border px-4 text-sm font-medium transition active:scale-95',
                state === 'like' &&
                  'border-primary bg-primary text-primary-foreground',
                state === 'hate' &&
                  'border-destructive bg-destructive/10 text-destructive',
                state === 'neutral' && 'border-border bg-card text-foreground',
              )}
            >
              <span>{cuisine}</span>
              {state === 'like' && (
                <Heart aria-hidden className="h-4 w-4 fill-current" />
              )}
              {state === 'hate' && <X aria-hidden className="h-4 w-4" />}
            </button>
          )
        })}
      </div>

      <p className="text-muted-foreground text-center text-xs">
        Tap once to love it, twice to hate it, again to clear.
      </p>
    </div>
  )
}
