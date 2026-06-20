import { ChevronLeft } from 'lucide-react'
import { SafeArea } from '#/components/ui/safe-area'
import { Skeleton } from '#/components/ui/skeleton'

/**
 * OnboardingSkeleton — the /onboarding route's pendingComponent (#232, the
 * #229/#230 pattern). It holds the Jow-style step/form shell while the loader
 * resolves the household read, so a cold tap into onboarding shows the form's
 * shape immediately rather than a blank frame. It mirrors {@link OnboardingFlow}'s
 * stepped layout: the top row (a round back arrow, a progress bar, the n/total
 * counter), the big step title + subtitle, a stack of option-row placeholders for
 * the form body, and the bottom pill CTA.
 *
 * The loader still runs on the server and hydrates first paint (SSR untouched);
 * this only shows on client navigations and slow loads. Mobile first at 390px;
 * the same safe-area frame the route supplies so the swap to the real flow is
 * seamless.
 */
export function OnboardingSkeleton() {
  return (
    <SafeArea
      edges={['top', 'bottom', 'left', 'right']}
      className="bg-background mx-auto flex w-full max-w-md flex-col"
    >
      <div
        className="flex flex-1 flex-col"
        aria-busy="true"
        aria-label="Loading onboarding"
      >
        <header className="px-5 pt-4">
          <div className="flex items-center gap-3">
            <span
              aria-hidden
              className="border-border text-muted-foreground flex h-10 w-10 items-center justify-center rounded-full border"
            >
              <ChevronLeft className="h-5 w-5" />
            </span>
            <Skeleton className="h-1.5 flex-1 rounded-full" />
            <Skeleton className="h-4 w-10" />
          </div>
        </header>

        <div className="flex flex-1 flex-col px-5 pt-6">
          <Skeleton className="h-7 w-3/4" />
          <Skeleton className="mt-2 h-4 w-1/2" />
          <div className="mt-6 flex-1 space-y-3">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton
                key={i}
                className="h-14 w-full rounded-[var(--radius-ios)]"
              />
            ))}
          </div>
        </div>

        <div className="px-5 pt-4 pb-8">
          <Skeleton className="h-12 w-full rounded-full" />
        </div>
      </div>
    </SafeArea>
  )
}
