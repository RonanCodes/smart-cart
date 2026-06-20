import { useEffect, useState } from 'react'
import { getDevStatus } from '#/lib/dev-server'
import type { DevStatus } from '#/lib/dev-server'

/**
 * Dev-only warning strip, shown when running under `vite dev`. Tells a
 * collaborator that auth is bypassed (open access as a dev admin) and lists which
 * optional API keys are missing, so they know AI replan / email are stubbed.
 * Renders nothing in the production build (import.meta.env.DEV is false), so
 * souso.app never shows it. Fixed to the bottom so it never shifts the layout.
 */
export function DevBanner() {
  const [status, setStatus] = useState<DevStatus | null>(null)

  useEffect(() => {
    if (!import.meta.env.DEV) return
    let live = true
    getDevStatus()
      .then((s) => {
        if (live) setStatus(s)
      })
      .catch(() => {
        // banner is best-effort; ignore a transient failure
      })
    return () => {
      live = false
    }
  }, [])

  if (!import.meta.env.DEV) return null

  const missing: Array<string> = []
  if (status) {
    if (!status.openai && !status.anthropic) {
      missing.push('OPENAI_API_KEY (AI replan off, using set-maths)')
    }
    if (!status.resend) missing.push('RESEND_API_KEY (email off)')
  }

  return (
    <div
      role="status"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-amber-300 bg-amber-100/95 px-4 py-2 text-center text-xs text-amber-900 shadow-[0_-1px_6px_rgba(0,0,0,0.06)] backdrop-blur"
    >
      <strong>DEV MODE</strong> &middot; login bypassed (signed in as a dev
      admin), all routes open.
      {missing.length > 0 && <> Missing: {missing.join(' / ')}.</>}
    </div>
  )
}
