import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getUserCount } from '#/lib/landing-server'

/** easeOutCubic, clamped to [0,1]. Pure + testable. */
export function easeOutCubic(t: number): number {
  const c = Math.min(1, Math.max(0, t))
  return 1 - Math.pow(1 - c, 3)
}

/** The integer to show at animation progress `t` (0..1) going from->to. Pure. */
export function countUpValue(from: number, to: number, t: number): number {
  return Math.round(from + (to - from) * easeOutCubic(t))
}

/** Poll cadence + count-up duration. A few seconds is plenty for a counter that
 * changes every few minutes, and is gentle on the public page. */
const REFETCH_MS = 4000
const ANIM_MS = 700

/**
 * Live user count for the landing social-proof line.
 *
 * The real-time Durable Object push approach was reverted (it failed the
 * framework's worker-bundle export at deploy). This polls the public, ungated
 * `getUserCount` server fn every few seconds and animates the number UP when it
 * changes, so a visitor sitting on the page watches it climb as people sign up.
 *
 * Seeds from the SSR value so first paint is correct, and never breaks the page:
 * the query degrades to the seed, and reduced-motion / SSR just jumps to the new
 * value instead of animating.
 */
export function useLiveUserCount(initial: number): number {
  const { data } = useQuery({
    queryKey: ['landing', 'user-count'],
    queryFn: () => getUserCount(),
    initialData: { count: initial },
    refetchInterval: REFETCH_MS,
    refetchOnWindowFocus: true,
  })
  // `data` is always defined here (initialData is set), so read it directly.
  const target = data.count

  const [display, setDisplay] = useState(target)
  // Track the currently-shown value so a new target animates from where we are.
  const displayRef = useRef(display)
  displayRef.current = display

  useEffect(() => {
    const from = displayRef.current
    if (target === from) return

    const reduce =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce || typeof requestAnimationFrame === 'undefined') {
      setDisplay(target)
      return
    }

    let raf = 0
    const start = performance.now()
    const step = (now: number) => {
      const t = (now - start) / ANIM_MS
      if (t >= 1) {
        setDisplay(target)
        return
      }
      setDisplay(countUpValue(from, target, t))
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [target])

  return display
}
