import { Heart, X, UtensilsCrossed, Clock } from 'lucide-react'
import type { DeckCard } from '#/lib/recsys-data'
import { Badge } from '#/components/ui/badge'

/**
 * SwipeDeck — the recipe swipe card plus its like / pass controls.
 *
 * One shared presentational component for both the anonymous opener (index route)
 * and the signed-in onboarding deck, so the card looks and behaves identically
 * either side of sign-in. It renders the top card of the queue (image, cuisine,
 * prep time, key ingredients) and the two big circular tap targets. All state
 * (queue, swipe accounting, batch loading) lives in the parent; this component is
 * stateless and just reports a swipe via `onSwipe`.
 *
 * iOS-native: big 4rem tap targets, rounded card with a soft shadow, image-first.
 */
export function SwipeDeck({
  card,
  ready,
  disabled,
  onSwipe,
}: {
  /** The card to show, or undefined while a batch loads / the deck is empty. */
  card: DeckCard | undefined
  /** True once the first batch has resolved (controls the empty-state copy). */
  ready: boolean
  /** Disable the controls (e.g. while finishing / persisting). */
  disabled?: boolean
  onSwipe: (card: DeckCard, like: boolean) => void
}) {
  return (
    <div className="flex flex-1 flex-col">
      <div className="relative flex-1">
        {card ? (
          <div className="bg-card border-border overflow-hidden rounded-[var(--radius-ios)] border shadow-[0_1px_3px_rgba(0,0,0,0.06),0_8px_24px_-12px_rgba(0,0,0,0.12)]">
            <div className="bg-secondary flex aspect-[4/3] w-full items-center justify-center">
              {card.imageUrl ? (
                <img
                  src={card.imageUrl}
                  alt={card.title}
                  className={
                    card.imageUrl.includes('/stickers/recipes/')
                      ? 'souso-sticker max-h-[85%] max-w-[85%] object-contain'
                      : 'h-full w-full object-cover'
                  }
                />
              ) : (
                <div className="text-muted-foreground flex h-full items-center justify-center">
                  <UtensilsCrossed className="h-10 w-10" />
                </div>
              )}
            </div>
            <div className="space-y-2 p-5">
              <div className="flex flex-wrap items-center gap-2">
                {card.cuisine && <Badge>{card.cuisine}</Badge>}
                {card.prepMinutes != null && (
                  <span className="text-muted-foreground inline-flex items-center gap-1 text-sm">
                    <Clock className="h-3.5 w-3.5" />
                    {card.prepMinutes} min
                  </span>
                )}
              </div>
              <h2 className="text-xl leading-tight font-semibold">
                {card.title}
              </h2>
              {card.ingredients.length > 0 && (
                <p className="text-muted-foreground text-sm leading-snug">
                  {card.ingredients.join(' · ')}
                </p>
              )}
            </div>
          </div>
        ) : (
          <div className="text-muted-foreground flex h-full items-center justify-center">
            {ready ? 'Loading more…' : 'Finding recipes…'}
          </div>
        )}
      </div>

      <div className="mt-6 flex items-center justify-center gap-6">
        <button
          aria-label="Not for me"
          disabled={!card || disabled}
          onClick={() => card && onSwipe(card, false)}
          className="border-border flex h-16 w-16 items-center justify-center rounded-full border bg-white text-red-500 shadow-sm transition active:scale-95 disabled:opacity-40"
        >
          <X className="h-7 w-7" />
        </button>
        <button
          aria-label="Love it"
          disabled={!card || disabled}
          onClick={() => card && onSwipe(card, true)}
          className="bg-primary text-primary-foreground flex h-16 w-16 items-center justify-center rounded-full shadow-sm transition active:scale-95 disabled:opacity-40"
        >
          <Heart className="h-7 w-7" />
        </button>
      </div>
    </div>
  )
}
