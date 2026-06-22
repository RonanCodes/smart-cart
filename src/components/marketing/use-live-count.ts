import { useEffect, useRef, useState } from 'react'

/**
 * CLIENT-ONLY hook for the live landing user-counter. Opens a WebSocket to
 * `/api/live-count` (routed to the global CounterDO by src/server.ts), seeds the
 * DO with the SSR count on connect, and returns the latest count to display.
 *
 * Pure browser APIs only (WebSocket / window) — NO server imports — so it is
 * safe in the client bundle. Degrades gracefully: if there is no window (SSR) or
 * the socket fails, it just returns the static `initial` count and never throws,
 * so the landing can never be broken by the counter.
 *
 * The DO count is monotonic, so seeding it with our SSR value on connect can
 * only ever correct it upward to the real total; it can't drag a higher live
 * number down.
 */
export function useLiveCount(initial: number): number {
  const [count, setCount] = useState(initial)
  // Keep the latest SSR value available to the connect handler without making
  // the socket effect re-run when the prop changes.
  const initialRef = useRef(initial)
  initialRef.current = initial

  useEffect(() => {
    if (typeof window === 'undefined' || typeof WebSocket === 'undefined') {
      return
    }

    let ws: WebSocket
    try {
      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
      ws = new WebSocket(`${proto}://${window.location.host}/api/live-count`)
    } catch {
      // WebSocket construction failed (blocked, offline): keep the static count.
      return
    }

    ws.addEventListener('open', () => {
      // Seed the DO with our SSR count so the live number is correct before the
      // first signup. Monotonic on the DO side, so this is safe to send.
      try {
        ws.send(JSON.stringify({ count: initialRef.current }))
      } catch {
        // Non-fatal: the DO will still broadcast on the next signup.
      }
    })

    ws.addEventListener('message', (event) => {
      try {
        const data = JSON.parse(String(event.data)) as { count?: unknown }
        if (typeof data.count === 'number' && Number.isFinite(data.count)) {
          // Only ever move the displayed number up (matches the DO's monotonic
          // contract and avoids a flicker on a stale frame).
          const incoming = data.count
          setCount((prev) => Math.max(prev, incoming))
        }
      } catch {
        // Ignore malformed frames.
      }
    })

    return () => {
      try {
        ws.close()
      } catch {
        // Already closing; nothing to do.
      }
    }
  }, [])

  return count
}

/**
 * Ease a displayed integer toward a target whenever the target changes, so a
 * live bump animates as a short count-up instead of snapping. Returns the
 * current animated value (an integer). Respects prefers-reduced-motion and SSR
 * by snapping straight to the target in those cases.
 */
export function useCountUp(target: number, durationMs = 600): number {
  const [display, setDisplay] = useState(target)
  const fromRef = useRef(target)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      typeof requestAnimationFrame === 'undefined' ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      setDisplay(target)
      return
    }

    const from = fromRef.current
    if (from === target) return
    const start = performance.now()

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs)
      // easeOutCubic for a soft landing.
      const eased = 1 - Math.pow(1 - t, 3)
      const value = Math.round(from + (target - from) * eased)
      setDisplay(value)
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick)
      } else {
        fromRef.current = target
      }
    }
    rafRef.current = requestAnimationFrame(tick)

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      fromRef.current = target
    }
  }, [target, durationMs])

  return display
}
