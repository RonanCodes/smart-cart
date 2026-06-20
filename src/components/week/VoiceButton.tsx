import { useEffect, useRef, useState } from 'react'
// Type-only: the SDK is loaded lazily inside the effect (see below) so a broken
// ESM/CJS default-interop can never `new` at module/mount time and crash the page.
import type Vapi from '@vapi-ai/web'
import { Mic, Square, Loader2 } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { VAPI_PUBLIC_KEY, VAPI_ASSISTANT_ID } from '#/config/vapi'
/** Mint a short-lived signed session token via the server route (keeps all
 * server-only modules out of the client bundle). */
async function mintToken(): Promise<string> {
  const res = await fetch('/api/vapi/token', { method: 'POST' })
  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean
    token?: string
    error?: string
  }
  if (!res.ok || !data.ok || !data.token) {
    throw new Error(data.error ?? 'Could not start voice (token mint failed)')
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
 * The Vapi instance is created once (useRef); events are bound in an effect and
 * the call is stopped on unmount. The public key + assistant id are the only
 * VAPI values safe in the browser bundle, so both come from VITE_-prefixed env.
 */
export function VoiceButton() {
  const vapi = useRef<Vapi | null>(null)
  const [state, setState] = useState<CallState>('idle')

  useEffect(() => {
    if (!VAPI_PUBLIC_KEY) return
    let cancelled = false

    // Lazy-load the SDK + construct defensively. The prod build's interop made
    // `new Vapi(...)` resolve to `new mod.default(...)` where .default was not a
    // constructor, which threw at mount and crashed the whole week page. Loading
    // it dynamically + resolving the constructor (.default ?? module) + wrapping
    // in try/catch means a VAPI failure degrades to an inert button, never a
    // page crash.
    void import('@vapi-ai/web')
      .then((mod) => {
        if (cancelled) return
        try {
          const VapiCtor = ((mod as { default?: unknown }).default ??
            mod) as new (key: string) => Vapi
          const v = new VapiCtor(VAPI_PUBLIC_KEY)
          vapi.current = v
          v.on('call-start', () => setState('live'))
          v.on('call-end', () => setState('idle'))
          v.on('error', (e: unknown) => {
            console.error('[vapi]', e)
            setState('error')
          })
          // Transcripts + tool messages. Logged for now; later slices surface them.
          v.on('message', (m: unknown) => console.log('[vapi]', m))
        } catch (e) {
          console.error('[vapi] init failed', e)
          setState('error')
        }
      })
      .catch((e) => {
        console.error('[vapi] load failed', e)
        setState('error')
      })

    return () => {
      cancelled = true
      vapi.current?.stop()
      vapi.current = null
    }
  }, [])

  async function start() {
    if (!VAPI_ASSISTANT_ID || !vapi.current) {
      setState('error')
      return
    }
    setState('connecting')
    try {
      const token = await mintToken()
      await vapi.current.start(VAPI_ASSISTANT_ID, { metadata: { token } })
    } catch (err) {
      console.error('[vapi] start failed', err)
      setState('error')
    }
  }

  function stop() {
    vapi.current?.stop()
    setState('idle')
  }

  const live = state === 'live'
  const connecting = state === 'connecting'

  return (
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
            ? 'Try again'
            : 'Talk to Souso'}
    </Button>
  )
}
