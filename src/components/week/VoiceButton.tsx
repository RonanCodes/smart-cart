import { useEffect, useRef, useState } from 'react'
// Type-only: the SDK is loaded lazily inside the effect (see below) so a broken
// ESM/CJS default-interop can never `new` at module/mount time and crash the page.
import type Vapi from '@vapi-ai/web'
import { Mic, Square, Loader2 } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { VAPI_PUBLIC_KEY, VAPI_ASSISTANT_ID } from '#/config/vapi'
import { log } from '#/lib/log'

type VapiCtor = new (key: string) => Vapi

/**
 * Resolve the Vapi constructor from the dynamically-imported module, drilling
 * through nested `{ default }` wrappers until we hit the actual function.
 *
 * Why this is needed: `@vapi-ai/web` is CJS (`exports.default = Vapi`,
 * `__esModule: true`). The prod bundler (Rolldown) DOUBLE-wraps it, so the
 * module namespace is `{ default: { default: Vapi, __esModule: true } }`. The
 * obvious `mod.default ?? mod` then yields the inner namespace, not the
 * constructor, and `new` throws "(e.default ?? e) is not a constructor" at
 * mount, crashing the whole week page. Drilling to the first function handles
 * the single-wrap (dev), double-wrap (prod), and bare cases.
 */
function resolveVapiCtor(mod: unknown): VapiCtor | null {
  let c: unknown = mod
  for (let i = 0; i < 5 && c && typeof c !== 'function'; i += 1) {
    c = (c as { default?: unknown }).default
  }
  return typeof c === 'function' ? (c as VapiCtor) : null
}

/** What went wrong, so the button can show a useful message instead of a bare
 * "Try again". */
type ErrorReason = 'init' | 'auth' | 'mic' | 'unknown'

/**
 * Mint a short-lived signed session token via the server route (keeps all
 * server-only modules out of the client bundle). Throws a tagged error so the
 * caller can tell "you're not signed in / onboarded" apart from other failures.
 */
async function mintToken(): Promise<string> {
  const res = await fetch('/api/vapi/token', { method: 'POST' })
  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean
    token?: string
    error?: string
  }
  if (!res.ok || !data.ok || !data.token) {
    const err = new Error(data.error ?? 'token mint failed') as Error & {
      reason?: ErrorReason
    }
    // 401 / "Not signed in" / "No household" => the caller needs to onboard.
    err.reason =
      res.status === 401 || /sign|household|onboard/i.test(data.error ?? '')
        ? 'auth'
        : 'unknown'
    throw err
  }
  return data.token
}

type CallState = 'idle' | 'connecting' | 'live' | 'error'

/**
 * "Talk to Souso", in-app two-way voice via VAPI WebRTC (no phone number).
 *
 * Tap to start: mints a short-lived signed session token (binds the call to the
 * signed-in household), then `vapi.start(assistantId, { metadata: { token } })`.
 * The tool webhook reads that token to act on the right household. Tap again to
 * stop. Mobile-first: tap-to-toggle, no hover-only affordance.
 *
 * The SDK is loaded + constructed lazily (see resolveVapiCtor) so a bad bundler
 * interop degrades to an inert button, never a page crash.
 */
export function VoiceButton({ onActed }: { onActed?: () => void } = {}) {
  const vapi = useRef<Vapi | null>(null)
  const [state, setState] = useState<CallState>('idle')
  const [reason, setReason] = useState<ErrorReason>('unknown')
  // Latest callback, so the effect's long-lived event handlers never go stale.
  const onActedRef = useRef(onActed)
  onActedRef.current = onActed
  // Debounce the "something happened, resync the week" signal: a call emits many
  // messages, but we only need one cheap refetch shortly after.
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scheduleSync = () => {
    if (syncTimer.current) clearTimeout(syncTimer.current)
    syncTimer.current = setTimeout(() => onActedRef.current?.(), 600)
  }

  useEffect(() => {
    if (!VAPI_PUBLIC_KEY) return
    let cancelled = false

    void import('@vapi-ai/web')
      .then((mod) => {
        if (cancelled) return
        const VapiCtor = resolveVapiCtor(mod)
        if (!VapiCtor) {
          // Capture the actual module shape so the interop can be fixed for good.
          log.error('vapi.ctor_unresolved', undefined, {
            modType: typeof mod,
            defaultType: typeof (mod as { default?: unknown }).default,
            nestedType: typeof (
              (mod as { default?: { default?: unknown } }).default ?? {}
            ).default,
          })
          setReason('init')
          setState('error')
          return
        }
        try {
          const v = new VapiCtor(VAPI_PUBLIC_KEY)
          vapi.current = v
          v.on('call-start', () => setState('live'))
          v.on('call-end', () => {
            setState('idle')
            // Final resync once the call ends (catches the last replan).
            onActedRef.current?.()
          })
          v.on('error', (e: unknown) => {
            log.error('vapi.sdk_error', e)
            setReason('unknown')
            setState('error')
          })
          v.on('message', (m: unknown) => {
            log.debug('vapi.message', { m })
            // A tool ran (or the conversation advanced) -> the week may have
            // changed server-side. Debounced refetch + glow on the week page.
            scheduleSync()
          })
        } catch (e) {
          log.error('vapi.init_failed', e)
          setReason('init')
          setState('error')
        }
      })
      .catch((e: unknown) => {
        log.error('vapi.load_failed', e)
        setReason('init')
        setState('error')
      })

    return () => {
      cancelled = true
      vapi.current?.stop()
      vapi.current = null
    }
  }, [])

  async function start() {
    if (!vapi.current) {
      setReason('init')
      setState('error')
      return
    }
    if (!VAPI_ASSISTANT_ID) {
      setReason('unknown')
      setState('error')
      return
    }
    setState('connecting')
    try {
      const token = await mintToken()
      await vapi.current.start(VAPI_ASSISTANT_ID, { metadata: { token } })
    } catch (err) {
      const tagged = (err as { reason?: ErrorReason }).reason
      // A mic-permission rejection from vapi.start surfaces as a DOMException.
      const isMic =
        err instanceof DOMException ||
        /permission|microphone|notallowed/i.test(String(err))
      const resolved: ErrorReason = tagged ?? (isMic ? 'mic' : 'unknown')
      log.error('vapi.start_failed', err, { reason: resolved })
      setReason(resolved)
      setState('error')
    }
  }

  function stop() {
    vapi.current?.stop()
    setState('idle')
  }

  const live = state === 'live'
  const connecting = state === 'connecting'

  const errorLabel =
    reason === 'auth'
      ? 'Sign in first'
      : reason === 'mic'
        ? 'Allow microphone'
        : reason === 'init'
          ? 'Voice unavailable'
          : 'Try again'

  return (
    <div className="space-y-1">
      <Button
        type="button"
        onClick={() => (live ? stop() : start())}
        disabled={connecting}
        variant={live ? 'secondary' : 'default'}
        className="w-full gap-2"
        aria-label={live ? 'Stop talking to Souso' : 'Talk to Souso'}
      >
        {connecting ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : live ? (
          <Square className="h-4 w-4" aria-hidden />
        ) : (
          <Mic className="h-4 w-4" aria-hidden />
        )}
        {connecting
          ? 'Connecting…'
          : live
            ? 'Stop'
            : state === 'error'
              ? errorLabel
              : 'Talk to Souso'}
      </Button>
      {state === 'error' && reason === 'auth' && (
        <p className="text-muted-foreground/80 px-2 text-center text-xs">
          Sign in and set up your week to talk to Souso.
        </p>
      )}
      {state === 'error' && reason === 'mic' && (
        <p className="text-muted-foreground/80 px-2 text-center text-xs">
          Allow microphone access in your browser, then tap again.
        </p>
      )}
    </div>
  )
}
