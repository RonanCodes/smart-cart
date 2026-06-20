import { X } from 'lucide-react'
import { SafeArea } from '#/components/ui/safe-area'
import { Skeleton } from '#/components/ui/skeleton'

/**
 * RateSkeleton — the /rate/$planId/$day route's pendingComponent (#229). The
 * rate-meal view is a full-screen modal (not the AppShell tab frame), deep-linked
 * from a push, so a cold tap waits on loadRateMeal resolving the household's
 * dinner. This holds the modal frame (the "Rate this meal" header + close X, the
 * meal card with its image / title / macro line, and the thumbs control) so the
 * jump to the real meal is seamless. The loader still hydrates first paint on a
 * warm navigation; this shows on the cold-push slow load.
 */
export function RateSkeleton() {
  return (
    <SafeArea
      edges={['top', 'bottom', 'left', 'right']}
      className="bg-background ios-scroll flex min-h-dvh flex-col"
    >
      <div
        className="mx-auto flex w-full max-w-md flex-1 flex-col"
        aria-busy="true"
        aria-label="Loading this meal"
      >
        <header className="flex items-center justify-between px-5 pt-4 pb-2">
          <h1 className="text-[1.5rem] leading-tight font-bold tracking-tight">
            Rate this meal
          </h1>
          <span
            aria-hidden
            className="text-muted-foreground bg-secondary inline-flex h-11 w-11 items-center justify-center rounded-full"
          >
            <X className="h-5 w-5" />
          </span>
        </header>

        <div className="flex flex-1 flex-col px-5 pt-2 pb-8">
          <div className="bg-card border-border overflow-hidden rounded-2xl border shadow-sm">
            <Skeleton className="aspect-[4/3] w-full rounded-none" />
            <div className="flex flex-col gap-2 px-4 pt-4 pb-4">
              <div className="flex items-center justify-between">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-5 w-14 rounded-full" />
              </div>
              <Skeleton className="h-6 w-3/4" />
              <div className="flex gap-3 pt-1">
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-4 w-20" />
              </div>
              <div className="mt-2 flex gap-2">
                <Skeleton className="h-11 flex-1 rounded-full" />
                <Skeleton className="h-11 flex-1 rounded-full" />
              </div>
            </div>
          </div>

          <div className="mt-auto pt-6">
            <Skeleton className="h-12 w-full rounded-full" />
          </div>
        </div>
      </div>
    </SafeArea>
  )
}
