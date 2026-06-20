import { Skeleton } from '#/components/ui/skeleton'

/**
 * AdminSkeletons — the pendingComponents for the five /admin sub-routes (#231),
 * finishing the #226/#229/#230 skeleton-while-loading pattern on admin. Each
 * admin tab's loader runs a server fn (listUsers / getBenchmarkMeta / etc.); on
 * a client-side tab switch or a slow read these hold the tab's real layout so
 * the content does not pop in. The loader still runs on the server and hydrates
 * first paint (SSR untouched) and the tabs cache via useQuery seeded from the
 * loader, so revisits are instant; these skeletons only show on the cold read.
 *
 * They render INSIDE the /admin layout's outlet (route.tsx already owns the
 * ScreenHeader + sub-nav + the `px-4 sm:px-6` container), so each skeleton only
 * mirrors its panel body, not the whole page chrome.
 */

/**
 * A list-picker column placeholder: the master side of the master-detail tabs
 * (Users / Why / Real feedback). A short header line over a stack of rounded
 * row-buttons, each carrying a label + a trailing meta count.
 */
function PickerColumn({
  rows = 6,
  withHeader = true,
  withButton = false,
}: {
  rows?: number
  withHeader?: boolean
  withButton?: boolean
}) {
  return (
    <div className="min-w-0 space-y-2">
      {withButton && <Skeleton className="h-8 w-56 rounded-lg" />}
      {withHeader && <Skeleton className="mb-1 h-3 w-40" />}
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="border-border flex items-center justify-between rounded-lg border px-4 py-3"
        >
          <Skeleton className="h-4 w-2/5" />
          <Skeleton className="ml-3 h-3 w-16 shrink-0" />
        </div>
      ))}
    </div>
  )
}

/**
 * The detail / graph panel placeholder: the bordered right-hand card the
 * master-detail tabs show once a row is picked. A title line, a couple of meta
 * lines, then a few content rows.
 */
function DetailPanel({ className }: { className?: string }) {
  return (
    <div
      className={`border-border min-h-[60vh] min-w-0 rounded-xl border p-5 ${className ?? ''}`}
    >
      <div className="space-y-5">
        <div className="space-y-2">
          <Skeleton className="h-5 w-1/3" />
          <Skeleton className="h-3 w-2/3" />
        </div>
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-6 w-20 rounded-full" />
          ))}
        </div>
        <div className="space-y-1">
          {Array.from({ length: 6 }, (_, i) => (
            <div
              key={i}
              className="flex items-center justify-between border-b py-1.5"
            >
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="ml-2 h-3 w-12 shrink-0" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/**
 * UsersSkeleton — /admin/users pendingComponent. Mirrors UsersPanel: a left list
 * column (the "send push to all" button + user rows) beside the desktop-only
 * data-points detail panel (hidden below lg, exactly as the real panel).
 */
export function UsersSkeleton() {
  return (
    <div
      className="grid gap-6 lg:grid-cols-[1fr_1.4fr]"
      aria-busy="true"
      aria-label="Loading users"
    >
      <PickerColumn withHeader={false} withButton rows={6} />
      <DetailPanel className="hidden lg:block" />
    </div>
  )
}

/**
 * WhySkeleton — /admin/why pendingComponent. Mirrors WhyPanel: a narrow user
 * picker beside the wide explainability graph panel (the three-column graph
 * collapses inside the bordered panel, so the placeholder is the panel shell).
 */
export function WhySkeleton() {
  return (
    <div
      className="grid gap-6 lg:grid-cols-[1fr_2.4fr]"
      aria-busy="true"
      aria-label="Loading the why-these-recipes view"
    >
      <PickerColumn rows={6} />
      <DetailPanel />
    </div>
  )
}

/**
 * BenchmarkSkeleton — /admin/benchmark pendingComponent. Mirrors BenchmarkConsole:
 * a fixed-width controls card on the left (algorithm select, sample-size input,
 * the run button) beside the results area on the right.
 */
export function BenchmarkSkeleton() {
  return (
    <div
      className="grid gap-6 lg:grid-cols-[20rem_1fr]"
      aria-busy="true"
      aria-label="Loading the benchmark console"
    >
      {/* Controls card */}
      <div className="space-y-4">
        <div className="border-border bg-card rounded-xl border p-5">
          <Skeleton className="h-5 w-32" />
          <div className="mt-4 space-y-4">
            <div className="space-y-1.5">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-10 w-full rounded-lg" />
            </div>
            <div className="space-y-1.5">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-10 w-full rounded-lg" />
              <Skeleton className="h-3 w-3/4" />
            </div>
            <Skeleton className="h-10 w-full rounded-lg" />
          </div>
        </div>
      </div>
      {/* Results placeholder */}
      <div className="space-y-4">
        <div className="border-border bg-card rounded-xl border p-5">
          <Skeleton className="h-5 w-40" />
          <div className="mt-4 space-y-2">
            {Array.from({ length: 5 }, (_, i) => (
              <div
                key={i}
                className="flex items-center justify-between border-b py-2"
              >
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="ml-2 h-4 w-16 shrink-0" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * FeedbackSkeleton — /admin/feedback pendingComponent. Mirrors RealFeedbackPanel:
 * a real-households picker beside the with/without-feedback comparison panel.
 */
export function FeedbackSkeleton() {
  return (
    <div
      className="grid gap-6 lg:grid-cols-[1fr_1.6fr]"
      aria-busy="true"
      aria-label="Loading the real-feedback comparison"
    >
      <PickerColumn rows={5} />
      <DetailPanel />
    </div>
  )
}

/**
 * WaitlistSkeleton — /admin/waitlist pendingComponent. Mirrors WaitlistPanel: the
 * per-admin notify toggle card, a count + caption, then the divided list of
 * signup rows (email + timestamp on the left, grant actions on the right).
 */
export function WaitlistSkeleton() {
  return (
    <div
      className="max-w-2xl space-y-4"
      aria-busy="true"
      aria-label="Loading the waitlist"
    >
      {/* Notify toggle */}
      <div className="border-border bg-card flex items-center justify-between rounded-xl border px-4 py-3">
        <div className="flex items-center gap-3">
          <Skeleton className="h-5 w-5 shrink-0 rounded-full" />
          <div className="space-y-1.5">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-3 w-64" />
          </div>
        </div>
        <Skeleton className="h-6 w-11 shrink-0 rounded-full" />
      </div>

      {/* Count + caption */}
      <div className="space-y-1.5">
        <Skeleton className="h-6 w-28" />
        <Skeleton className="h-3 w-3/4" />
      </div>

      {/* Signup rows */}
      <div className="border-border divide-border divide-y rounded-xl border">
        {Array.from({ length: 6 }, (_, i) => (
          <div
            key={i}
            className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
          >
            <div className="min-w-0 flex-1 space-y-1.5">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-3 w-32" />
            </div>
            <div className="flex shrink-0 gap-2">
              <Skeleton className="h-9 w-28 rounded-lg" />
              <Skeleton className="h-9 w-24 rounded-lg" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
