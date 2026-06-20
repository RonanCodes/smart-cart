import { Heart, ThumbsDown } from 'lucide-react'
import { cn } from '#/lib/utils'
import { useOnboardingForm } from '../form-state'

/**
 * CuisineStep — the 'cuisines you like / dislike' screen of the Jow-style
 * onboarding (parent PRD #121, slice #122). This replaces the retired swipe
 * taste signal: instead of swiping a deck, the user marks each cuisine as a
 * LIKE (heart), a DISLIKE (thumbs-down), or leaves it neutral.
 *
 * Each tile cycles through three states on a single tap: neutral -> like ->
 * dislike -> neutral. There is NO hidden double-tap (issue #143): a persistent
 * legend at the top of the step shows the three icon/colour states, the neutral
 * tile carries a faint outline heart so it reads as a multi-state control, and
 * the hint spells out that one tap advances the state. Liked cuisines bias the
 * planner UP; disliked ones are down-weighted. Both lists feed the planner's
 * cuisine net-preference term (see planner.ts softScore); a cuisine never sits
 * in both lists at once.
 *
 * Reads + writes draft.cuisinesLiked / draft.cuisinesDisliked via
 * useOnboardingForm. Labels are stored verbatim; the planner matches them
 * case-insensitively against each recipe's cuisine.
 *
 * Mobile first at 390px: a 2-column tap-grid, big thumb targets, an iOS-style
 * pressed scale, and a colour + icon cue so the state reads at a glance. No
 * hover-only cues and no double-tap (which can trigger iOS zoom).
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

/** Spoken state for screen readers, so each tile announces what a tap did. */
const STATE_LABEL: Record<CuisineState, string> = {
  neutral: 'not set, tap to like',
  like: 'liked, tap to dislike',
  hate: 'disliked, tap to clear',
}

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
    <div className="flex flex-col gap-4" data-testid="cuisine-step">
      <div
        className="bg-muted/40 flex items-center justify-center gap-4 rounded-2xl px-3 py-2.5 text-xs font-medium"
        aria-hidden
      >
        <span className="flex items-center gap-1.5">
          <Heart className="text-primary h-4 w-4 fill-current" />1 tap = like
        </span>
        <span className="text-border">|</span>
        <span className="flex items-center gap-1.5">
          <ThumbsDown className="text-destructive h-4 w-4" />2 taps = dislike
        </span>
      </div>

      <div
        className="grid grid-cols-2 gap-2.5"
        role="group"
        aria-label="Cuisines you like or dislike"
      >
        {CUISINES.map((cuisine) => {
          const state = stateOf(cuisine)
          return (
            <button
              key={cuisine}
              type="button"
              aria-label={`${cuisine}: ${STATE_LABEL[state]}`}
              aria-pressed={state !== 'neutral'}
              data-state={state}
              onClick={() => cycle(cuisine)}
              className={cn(
                'flex h-14 touch-manipulation items-center justify-between rounded-2xl border px-4 text-sm font-medium transition active:scale-95',
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
              {state === 'hate' && (
                <ThumbsDown aria-hidden className="h-4 w-4" />
              )}
              {state === 'neutral' && (
                <Heart
                  aria-hidden
                  className="text-muted-foreground/40 h-4 w-4"
                />
              )}
            </button>
          )
        })}
      </div>

      <p className="text-muted-foreground text-center text-xs">
        Each tap moves a cuisine on: like, then dislike, then back to neutral.
      </p>
    </div>
  )
}
