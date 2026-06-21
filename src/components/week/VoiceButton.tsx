import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'
// Type-only: the SDK is loaded lazily inside the effect (see below) so a broken
// ESM/CJS default-interop can never `new` at module/mount time and crash the page.
import type Vapi from '@vapi-ai/web'
import { Mic, Square, Loader2, ChevronDown, ChevronUp } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { VAPI_PUBLIC_KEY, VAPI_ASSISTANT_ID } from '#/config/vapi'
import type { PersonaOverrides } from '#/lib/vapi-persona'
import { log } from '#/lib/log'

/** VAPI's assistant-overrides type, recovered from `start`'s 2nd parameter (the
 * package does not re-export `AssistantOverrides` from its root). */
type AssistantOverrides = NonNullable<Parameters<Vapi['start']>[1]>

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

/** What the token route returns: the signed identity token plus Souso's per-call
 * persona overrides (grounded in the open week). */
interface TokenResponse {
  token: string
  assistantOverrides?: PersonaOverrides
}

/**
 * Mint a short-lived signed session token via the server route (keeps all
 * server-only modules out of the client bundle), and receive Souso's per-call
 * assistant overrides grounded in the open week. We send the open `planId` so the
 * persona is built from the exact revision on screen. Throws a tagged error so the
 * caller can tell "you're not signed in / onboarded" apart from other failures.
 */
async function mintToken(planId: string): Promise<TokenResponse> {
  const res = await fetch('/api/vapi/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ planId }),
  })
  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean
    token?: string
    assistantOverrides?: PersonaOverrides
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
  return { token: data.token, assistantOverrides: data.assistantOverrides }
}

type CallState = 'idle' | 'connecting' | 'live' | 'error'

export interface VoiceButtonProps {
  /** The meal_plan revision open in the week view (voice edits this revision). */
  planId: string
  /** Disable starting a call while chat replan is in flight. */
  disabled?: boolean
  /** True while a call is connecting or live (locks the rest of the week UI). */
  onLiveChange?: (live: boolean) => void
  /** Debounced resync after voice tool activity (live grid + glow cue). */
  onActed?: () => void
  /** Runs when the call ends (final resync safety net). */
  onCallEnd?: () => void
  /**
   * Hide the idle "Talk to Souso" trigger. The route mounts ONE VoiceButton at
   * page root (kept alive so the call survives the sheet closing) and drives
   * start() imperatively from the sheet's own trigger, so the root instance only
   * needs to render the live card / pill, not a second idle button.
   */
  hideTrigger?: boolean
}

/** Imperative handle so the sheet's trigger can start a call on the always-mounted
 * root VoiceButton (which keeps the SDK instance alive across the sheet closing). */
export interface VoiceButtonHandle {
  start: () => void
}

/**
 * "Talk to Souso", in-app two-way voice via VAPI WebRTC (no phone number).
 *
 * Tap to start: mints a short-lived signed session token (binds the call to the
 * signed-in household) AND fetches Souso's per-call persona overrides grounded in
 * the open week, then `vapi.start(assistantId, overrides)` where the overrides
 * also carry `metadata: { token, planId }`. The tool webhook reads that token to
 * act on the right household.
 *
 * Keep-open + minimise: a live call does NOT block the week. The control is a
 * small bottom card while live, and a one-tap "minimise" shrinks it to a floating
 * pill so the user can watch the grid update mid-conversation. They never have to
 * press Stop to keep talking — the call stays open until they end it. The whole
 * component stays mounted across minimise/expand, so the SDK call survives.
 *
 * The SDK is loaded + constructed lazily (see resolveVapiCtor) so a bad bundler
 * interop degrades to an inert button, never a page crash.
 */
export const VoiceButton = forwardRef<VoiceButtonHandle, VoiceButtonProps>(
  function VoiceButtonImpl(
    { planId, disabled = false, onLiveChange, onActed, onCallEnd, hideTrigger },
    ref,
  ) {
    const vapi = useRef<Vapi | null>(null)
    const [state, setState] = useState<CallState>('idle')
    const [reason, setReason] = useState<ErrorReason>('unknown')
    /** When live, collapse the control to a floating pill so the week is visible. */
    const [minimized, setMinimized] = useState(false)
    const onActedRef = useRef(onActed)
    onActedRef.current = onActed
    const onCallEndRef = useRef(onCallEnd)
    onCallEndRef.current = onCallEnd
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
            v.on('call-start', () => {
              onLiveChange?.(true)
              setState('live')
            })
            v.on('call-end', () => {
              onLiveChange?.(false)
              setState('idle')
              setMinimized(false)
              onActedRef.current?.()
              onCallEndRef.current?.()
            })
            v.on('error', (e: unknown) => {
              log.error('vapi.sdk_error', e)
              setReason('unknown')
              setState('error')
            })
            v.on('message', (m: unknown) => {
              log.debug('vapi.message', { m })
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
    }, [onLiveChange])

    async function start() {
      if (!vapi.current || disabled) {
        if (disabled) return
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
      onLiveChange?.(true)
      try {
        const { token, assistantOverrides } = await mintToken(planId)
        // Merge the persona overrides (system prompt via model.messages + first
        // message + week vars) with the identity metadata the tool webhook needs.
        // Spread the persona first so `metadata` always carries our token + planId.
        //
        // The cast is deliberate: VAPI's runtime accepts a PARTIAL model override
        // (`{ messages }`) and merges it onto the dashboard model (keeping the
        // dashboard provider + base model), but the SDK's `AssistantOverrides.model`
        // type is a union of FULL model DTOs that each require `provider`, so a
        // partial doesn't typecheck. PersonaOverrides is the shape we actually send.
        const overrides = {
          ...assistantOverrides,
          metadata: { token, planId },
        } as AssistantOverrides
        await vapi.current.start(VAPI_ASSISTANT_ID, overrides)
      } catch (err) {
        onLiveChange?.(false)
        const tagged = (err as { reason?: ErrorReason }).reason
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
      onLiveChange?.(false)
      setState('idle')
      setMinimized(false)
      onCallEndRef.current?.()
    }

    // Keep the latest `start` reachable from the imperative handle without
    // re-creating the handle every render (start closes over fresh props each time).
    const startRef = useRef(start)
    startRef.current = start
    useImperativeHandle(
      ref,
      () => ({
        start: () => void startRef.current(),
      }),
      [],
    )

    const live = state === 'live'
    const connecting = state === 'connecting'
    const inactive = disabled && !live && !connecting

    const errorLabel =
      reason === 'auth'
        ? 'Sign in first'
        : reason === 'mic'
          ? 'Allow microphone'
          : reason === 'init'
            ? 'Voice unavailable'
            : 'Try again'

    // LIVE / CONNECTING — minimised: a small floating pill over the week grid. The
    // call keeps running; tapping it expands the control back. A green dot signals
    // "still listening". Sits above the tab bar, out of the way of the basket CTA.
    if ((live || connecting) && minimized) {
      return (
        <div
          className="fixed left-1/2 z-50 -translate-x-1/2"
          style={{ top: 'calc(var(--safe-top, 0px) + 0.5rem)' }}
        >
          <button
            type="button"
            onClick={() => setMinimized(false)}
            aria-label="Expand Souso voice controls"
            className="bg-card border-border text-foreground flex items-center gap-2 rounded-full border px-4 py-2.5 text-sm font-semibold shadow-lg active:scale-[0.98]"
          >
            {connecting ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <span className="relative flex h-2.5 w-2.5" aria-hidden>
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500/60" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-green-500" />
              </span>
            )}
            {connecting ? 'Connecting…' : 'Souso is listening'}
            <ChevronUp className="text-muted-foreground h-4 w-4" aria-hidden />
          </button>
        </div>
      )
    }

    // LIVE / CONNECTING — expanded: a non-blocking bottom card (NOT a full-screen
    // modal). "Minimise" keeps the call open as a pill so the user can watch the
    // week update mid-conversation; the copy makes clear Stop is not required to
    // keep talking.
    if (live || connecting) {
      return (
        <div className="fixed bottom-[calc(var(--tab-bar-space)+0.75rem)] left-1/2 z-50 w-[calc(100%-2.5rem)] max-w-md -translate-x-1/2">
          <div className="bg-card border-border space-y-2.5 rounded-2xl border p-4 shadow-2xl">
            <div className="flex items-center gap-2 text-sm font-semibold">
              {connecting ? (
                <Loader2
                  className="text-primary h-4 w-4 animate-spin"
                  aria-hidden
                />
              ) : (
                <Mic className="text-primary h-4 w-4" aria-hidden />
              )}
              {connecting ? 'Connecting to Souso…' : 'Souso is listening'}
            </div>
            <p className="text-muted-foreground text-xs">
              Just keep talking — you don&rsquo;t need to press Stop. Minimise
              to watch your week update while you chat.
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="secondary"
                className="flex-1 gap-2"
                onClick={() => setMinimized(true)}
                disabled={connecting}
                aria-label="Minimise — keep talking while you watch the week"
              >
                <ChevronDown className="h-4 w-4" aria-hidden />
                Minimise
              </Button>
              <Button
                type="button"
                variant="default"
                className="flex-1 gap-2"
                onClick={stop}
                disabled={connecting}
                aria-label="Stop talking to Souso"
              >
                <Square className="h-4 w-4" aria-hidden />
                Stop
              </Button>
            </div>
          </div>
        </div>
      )
    }

    // IDLE / ERROR. The root instance hides its trigger (`hideTrigger`): the sheet
    // drives start() imperatively so the call survives the sheet closing. An error
    // is still surfaced so the user knows why nothing happened.
    if (hideTrigger && state !== 'error') return null

    return (
      <div className="space-y-1">
        {!hideTrigger && (
          <Button
            type="button"
            onClick={() => start()}
            disabled={inactive}
            variant="default"
            className="w-full gap-2"
            aria-label="Talk to Souso"
          >
            <Mic className="h-4 w-4" aria-hidden />
            {state === 'error' ? errorLabel : 'Talk to Souso'}
          </Button>
        )}
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
  },
)
