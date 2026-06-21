import { Skeleton } from '#/components/ui/skeleton'

/**
 * DayCardSkeleton — a single day-row placeholder that matches one {@link DayCard}'s
 * footprint (#week-card-loading). Shown IN PLACE of just the card whose dinner is
 * being updated (a swipe-to-swap, a similar / alternative pick, a day cleared, or
 * a day the streaming replan is touching), while every other card stays live. It
 * mirrors the real row exactly — the same dashed divider + vertical padding, a
 * 32x32 dish block on the left, and a day label / title / meta stack on the right
 * — so swapping it in for the live content never shifts the list. The full
 * {@link WeekSkeleton} stays for the cold week load only; this is the per-card
 * shimmer for single-recipe updates.
 */
export function DayCardSkeleton({ day }: { day: string }) {
  return (
    <div
      className="border-hairline relative border-b border-dashed py-5 last:border-b-0"
      aria-busy="true"
      aria-label={`Updating ${day}`}
    >
      <div className="flex items-center gap-4">
        {/* Left: the dish, same 32x32 footprint as the real sticker. */}
        <Skeleton className="h-32 w-32 shrink-0 rounded-2xl" />

        {/* Right: day label, title, meta line, action row. */}
        <div className="min-w-0 flex-1">
          <Skeleton className="h-2.5 w-16" />
          <Skeleton className="mt-2 h-5 w-3/4" />
          <Skeleton className="mt-2 h-3.5 w-1/2" />
          <div className="mt-3 flex items-center gap-2">
            <Skeleton className="h-[1.95rem] w-12 rounded-full" />
            <Skeleton className="h-[1.95rem] w-[1.95rem] rounded-full" />
          </div>
        </div>
      </div>
    </div>
  )
}
