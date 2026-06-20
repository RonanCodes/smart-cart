import * as React from 'react'
import { cn } from '#/lib/utils'

/**
 * Skeleton — a quiet pulsing placeholder block (shadcn-style, #226). Used to hold
 * a page's shape while its data loads so the layout does not jump when content
 * arrives. It is purely presentational; mark the containing region
 * `aria-busy="true"` so assistive tech announces the wait rather than reading a
 * row of empty boxes.
 *
 *   <Skeleton className="h-4 w-32" />
 */
export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden
      className={cn('bg-secondary animate-pulse rounded-md', className)}
      {...props}
    />
  )
}

/**
 * SkeletonCard — a meal-card-shaped placeholder that mirrors the week's DayCard
 * (a day label, a recipe title line, a couple of meta lines, an action row). Uses
 * the same iOS card framing the real card uses so the swap is seamless.
 */
export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'bg-card rounded-[var(--radius-ios)] p-5 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_8px_24px_-12px_rgba(0,0,0,0.12)]',
        className,
      )}
    >
      <Skeleton className="h-3 w-16" />
      <Skeleton className="mt-3 h-5 w-3/4" />
      <Skeleton className="mt-2 h-4 w-1/2" />
      <div className="mt-4 flex gap-2">
        <Skeleton className="h-9 w-24 rounded-full" />
        <Skeleton className="h-9 w-24 rounded-full" />
      </div>
    </div>
  )
}

/**
 * SkeletonRow — a single list-row placeholder (a leading tick/dot, a label, a
 * trailing amount). Mirrors a shopping-list line. Compose several inside a list
 * container for a multi-row loading state.
 */
export function SkeletonRow({ className }: { className?: string }) {
  return (
    <div className={cn('flex items-center gap-3 py-3', className)}>
      <Skeleton className="h-5 w-5 shrink-0 rounded-full" />
      <Skeleton className="h-4 flex-1" />
      <Skeleton className="h-4 w-12 shrink-0" />
    </div>
  )
}

/**
 * SkeletonList — a stack of {@link SkeletonRow}s for a list-shaped loading state.
 */
export function SkeletonList({
  rows = 6,
  className,
}: {
  rows?: number
  className?: string
}) {
  return (
    <div className={cn('divide-border divide-y', className)}>
      {Array.from({ length: rows }, (_, i) => (
        <SkeletonRow key={i} />
      ))}
    </div>
  )
}
