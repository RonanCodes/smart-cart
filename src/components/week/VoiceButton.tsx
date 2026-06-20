import { useEffect, useRef, useState } from 'react'
import Vapi from '@vapi-ai/web'
import { Mic, Square, Loader2 } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { mintVapiSessionToken } from '#/lib/vapi-server'

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
    const publicKey = import.meta.env.VITE_VAPI_PUBLIC_KEY as string | undefined
    if (!publicKey) return

    const v = new Vapi(publicKey)
    vapi.current = v
    v.on('call-start', () => setState('live'))
    v.on('call-end', () => setState('idle'))
    v.on('error', (e: unknown) => {
      console.error('[vapi]', e)
      setState('error')
    })
    // Transcripts + tool messages. Logged for now; later slices surface them.
    v.on('message', (m: unknown) => console.log('[vapi]', m))

    return () => {
      v.stop()
      vapi.current = null
    }
  }, [])

  async function start() {
    const assistantId = import.meta.env.VITE_VAPI_ASSISTANT_ID as
      | string
      | undefined
    if (!assistantId || !vapi.current) {
      setState('error')
      return
    }
    setState('connecting')
    try {
      const { token } = await mintVapiSessionToken()
      await vapi.current.start(assistantId, { metadata: { token } })
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
