import { useEffect, useState } from 'react'
import {
  Sparkles,
  Loader2,
  ExternalLink,
  Leaf,
  HeartPulse,
  UtensilsCrossed,
  Lightbulb,
  RefreshCw,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { getDiscoverCards, refreshDiscoverCards } from '#/lib/discover-server'
import type { DiscoverCard } from '#/lib/discover-server'

/** Map an angle id to its card icon, mirroring the "Souso knows" sparkle look. */
const ANGLE_ICON: Record<string, LucideIcon> = {
  'in-season': Leaf,
  nutrition: HeartPulse,
  cuisine: UtensilsCrossed,
  'fun-fact': Lightbulb,
}

/**
 * DiscoverFeed — a vertically scrollable stack of source-cited "ideas" cards,
 * tailored to the household's profile and fetched from Cala (cala.ai) via the
 * Discover server fn. Each card mirrors the "Souso knows" RecipeFacts styling:
 * a topic icon, a short title, the cited content, and citation chips that open
 * the real source URLs in a new tab.
 *
 * Lazy + invisible-by-default: it fetches on mount and renders a small skeleton
 * while loading, then NOTHING when the feed is empty (key unconfigured, not
 * onboarded, or Cala had nothing). So the feed never shows an empty box or an
 * error state. Imports only the createServerFns (handler bodies stripped from
 * the client bundle) + the DiscoverCard type, so nothing server-only leaks here.
 */
export function DiscoverFeed() {
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [cards, setCards] = useState<Array<DiscoverCard> | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void getDiscoverCards()
      .then((res) => {
        if (!cancelled) setCards(res)
      })
      .catch(() => {
        // Degrade to hidden: a failed fetch leaves cards empty, feed stays gone.
        if (!cancelled) setCards([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  function handleRefresh() {
    if (refreshing) return
    setRefreshing(true)
    void refreshDiscoverCards()
      .then((res) => setCards(res))
      .catch(() => {
        // Keep the current cards on a failed refresh; just stop the spinner.
      })
      .finally(() => setRefreshing(false))
  }

  // First load: a small skeleton so the section reads as "ideas are coming".
  if (loading && !cards) {
    return (
      <div className="px-5 pt-2">
        <div className="text-muted-foreground flex items-center gap-2 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Souso is finding ideas for you...
        </div>
        <div className="mt-3 space-y-3" aria-hidden>
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="border-border bg-secondary/40 h-28 animate-pulse rounded-2xl border"
            />
          ))}
        </div>
      </div>
    )
  }

  // Nothing to show (unconfigured key, not onboarded, or no facts): render nothing.
  if (!cards || cards.length === 0) return null

  return (
    <section className="px-5 pt-2" aria-label="Ideas for you">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-foreground flex items-center gap-1.5 text-sm font-semibold">
          <Sparkles className="text-primary h-4 w-4" aria-hidden />
          Ideas for you
        </div>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={refreshing}
          className="text-muted-foreground hover:text-foreground active:text-foreground inline-flex items-center gap-1 text-xs transition-colors disabled:opacity-50"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`}
            aria-hidden
          />
          Refresh ideas
        </button>
      </div>

      <div className="space-y-3">
        {cards.map((card) => (
          <DiscoverCardItem key={card.id} card={card} />
        ))}
      </div>
    </section>
  )
}

/** One Discover card: topic icon + title + cited content + citation chips. */
function DiscoverCardItem({ card }: { card: DiscoverCard }) {
  const Icon = ANGLE_ICON[card.id] ?? Sparkles
  return (
    <article className="border-border bg-secondary/40 rounded-2xl border p-4">
      <div className="text-foreground mb-1.5 flex items-center gap-1.5 text-sm font-semibold">
        <Icon className="text-primary h-4 w-4" aria-hidden />
        {card.title}
      </div>
      <p className="text-foreground/90 text-sm leading-snug whitespace-pre-line">
        {card.content}
      </p>

      {card.sources.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {card.sources.map((s) => (
            <a
              key={s.url}
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              className="border-border bg-card text-muted-foreground hover:bg-secondary active:bg-secondary inline-flex max-w-[12rem] items-center gap-1 truncate rounded-full border px-2.5 py-1 text-xs transition-colors"
            >
              <ExternalLink className="h-3 w-3 flex-shrink-0" aria-hidden />
              <span className="truncate">{s.name}</span>
            </a>
          ))}
        </div>
      )}
    </article>
  )
}
