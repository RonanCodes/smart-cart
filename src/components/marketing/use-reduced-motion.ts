import { useEffect, useState } from 'react'

/**
 * True when the user (or their OS) asks for reduced motion. SSR-safe: starts
 * `false` on the server and first client render, then syncs to the real media
 * query after mount and stays in sync if the setting changes. Components use it
 * to fall back to a static, animation-free presentation.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)

  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      typeof window.matchMedia !== 'function'
    ) {
      return
    }
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setReduced(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  return reduced
}
