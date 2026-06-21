import * as React from 'react'
import { cn } from '#/lib/utils'

/**
 * StickyNote — a small hand-written paper note in Schoolbell, on the warm
 * `--note` paper, with a soft shadow + slight tilt. The Souso "personal
 * recipe-book" touch: used sparingly as a playful tag or aside (a keeper meal, a
 * reminder, a bit of warmth), never as primary UI text.
 */
export function StickyNote({
  children,
  className,
  tilt = -3,
}: {
  children: React.ReactNode
  className?: string
  /** Rotation in degrees for the hand-placed feel. */
  tilt?: number
}) {
  return (
    <span
      className={cn(
        'bg-note text-foreground font-handwriting relative inline-block rounded-[5px] px-3 py-1.5 text-[1.05rem] leading-tight shadow-md',
        className,
      )}
      style={{ transform: `rotate(${tilt}deg)` }}
    >
      {children}
    </span>
  )
}
