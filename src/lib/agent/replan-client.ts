import {
  parseJsonEventStream,
  readUIMessageStream,
  uiMessageChunkSchema,
} from 'ai'
import type { PlannedWeek } from '../planner/types'
import type { WeekView } from '../week-server'
import type { ReplanUIMessage } from './replan-ui-message'
import type { PlanDayChange } from '../replan/diff'

/** One prior turn in the chat-replan thread, sent so a follow-up has context. */
export interface ReplanHistoryTurn {
  role: 'user' | 'assistant'
  text: string
}

/**
 * Client-side helpers for the chat replan (`POST /api/replan`).
 *
 * Consumes the AI SDK UI message stream via `readUIMessageStream` and yields a
 * small event union the week view can handle without pulling in `@ai-sdk/react`.
 * See https://ai-sdk.dev/docs/ai-sdk-ui/reading-ui-message-streams
 */

/** Events derived from the UI message stream for the week view. */
export type ReplanWireEvent =
  | { type: 'text'; delta: string }
  | { type: 'week'; week: PlannedWeek }
  | {
      type: 'done'
      message: string
      changed: boolean
      planId: string
      changes: Array<PlanDayChange>
    }
  | { type: 'error'; message: string }

function textFromMessage(message: ReplanUIMessage): string {
  return message.parts
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('')
}

/**
 * POST the instruction and yield replan events as the UI message stream arrives.
 * Text deltas are computed from successive message snapshots (the stream sends the
 * full accumulated text each tick).
 */
export async function* streamReplan(
  planId: string,
  instruction: string,
  options?: { history?: Array<ReplanHistoryTurn>; signal?: AbortSignal },
): AsyncGenerator<ReplanWireEvent> {
  const res = await fetch('/api/replan', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      planId,
      instruction,
      history: options?.history ?? [],
    }),
    signal: options?.signal,
  })
  if (!res.ok || !res.body) {
    throw new Error(`replan request failed (${res.status})`)
  }

  let prevText = ''

  // Hold the transform controller so we can ERROR the stream the SDK reads when
  // we stop early. See the lifecycle note below. Only `.error()` is used, so a
  // minimal structural type keeps this independent of the chunk element type.
  type ErrController = { error: (reason?: unknown) => void }
  // Held in an object (not a bare `let`) so TS keeps the declared type across the
  // `start` callback assignment instead of narrowing the read site to `never`.
  const src: { controller: ErrController | null } = { controller: null }
  const source = parseJsonEventStream({
    stream: res.body,
    schema: uiMessageChunkSchema,
  }).pipeThrough(
    new TransformStream({
      start(controller) {
        src.controller = controller as ErrController
      },
      transform(chunk, controller) {
        if (!chunk.success) throw chunk.error
        controller.enqueue(chunk.value)
      },
    }),
  )

  // `readUIMessageStream` returns an async-iterable backed by its own
  // ReadableStream whose controller it closes from a FLOATING (unawaited)
  // `consumeStream(...).finally(() => controller.close())`. If we abandon a
  // `for await` over it early (a `return`/`break` on data-done, or the route
  // unmounting mid-stream), the for-await cleanup cancels that stream and then
  // the still-pending floating `close()` lands on an already-closed controller,
  // throwing "ReadableStreamDefaultController is not in a state where it can be
  // closed" as an unhandled rejection (#386, iOS Safari /week). The floating
  // close is inside the SDK and we can't guard it, so we make the stream close
  // EXACTLY ONCE by controlling its end state ourselves:
  //
  //  - Happy path: once we've emitted `done`, DRAIN the iterator to its natural
  //    end (the server always terminates the SSE with finish/[DONE]) instead of
  //    bailing, so the SDK closes its controller once, the normal way.
  //  - Early exit (caller breaks / route unmounts): in `finally` we `error()`
  //    the source stream the SDK is reading. That makes the SDK's own
  //    `handleError` flip its internal `hasErrored` flag, so the floating
  //    `close()` is SKIPPED — no double-close, no rejection.
  //  - Abort: the fetch body errors, `reader.next` rejects, the SDK again sets
  //    `hasErrored`; we swallow the rejection and return quietly.
  const reader = readUIMessageStream<ReplanUIMessage>({
    stream: source,
  })[Symbol.asyncIterator]()

  let doneEvent: Extract<ReplanWireEvent, { type: 'done' }> | null = null
  let drained = false

  try {
    for (;;) {
      let step: IteratorResult<ReplanUIMessage>
      try {
        step = await reader.next()
      } catch {
        // Abort / network error / parse error: the SDK has already flagged its
        // own stream as errored, so the floating close is a no-op. Stop quietly.
        return
      }
      if (step.done) {
        drained = true
        break
      }
      const message = step.value

      // Once `done` is captured we keep reading (to let the SDK close its own
      // stream cleanly) but stop emitting — late text/finish chunks are ignored.
      if (doneEvent) continue

      const text = textFromMessage(message)
      if (text.length > prevText.length) {
        yield { type: 'text', delta: text.slice(prevText.length) }
        prevText = text
      }

      for (const part of message.parts) {
        if (part.type === 'data-week') {
          yield { type: 'week', week: part.data.week }
        }
        if (part.type === 'data-done') {
          doneEvent = {
            type: 'done',
            message: part.data.message,
            changed: part.data.changed,
            planId: part.data.planId,
            changes: part.data.changes,
          }
          yield doneEvent
          break
        }
      }
    }
  } finally {
    // If we did NOT read to the natural end (caller closed the generator early,
    // e.g. the route unmounted mid-stream), error the source so the SDK skips
    // its floating close. Guarded so this can never itself throw into the void.
    if (!drained) {
      try {
        src.controller?.error(new DOMException('aborted', 'AbortError'))
      } catch {
        // controller may already be closed/errored — nothing to do
      }
    }
  }

  // The source closed without ever emitting data-done.
  if (!doneEvent) {
    yield {
      type: 'error',
      message: 'Could not adjust the week.',
    }
  }
}

/**
 * Optimistically apply a streamed planner week onto the current rich view, so the
 * grid reflows the instant a tool fires. Detail (image, cuisine, prep) for a newly
 * picked recipe is looked up from the view's own day picks and their alternatives
 * (which carry full detail); a pick outside that set shows its title until the
 * authoritative `loadWeek` reconcile on `done`. Day-level alternatives are kept as
 * is so the edit sheet still works mid-stream.
 */
export function applyStreamedWeek(
  view: WeekView,
  streamed: PlannedWeek,
): WeekView {
  type Detail = {
    meal: string
    cuisine: string | null
    prepMinutes: number | null
    calories: number | null
    protein: number | null
    imageUrl: string | null
  }
  const detail = new Map<string, Detail>()
  const remember = (d: {
    recipeRef: string
    meal: string
    cuisine: string | null
    prepMinutes: number | null
    calories: number | null
    protein: number | null
    imageUrl: string | null
  }) => {
    if (d.recipeRef) {
      detail.set(d.recipeRef, {
        meal: d.meal,
        cuisine: d.cuisine,
        prepMinutes: d.prepMinutes,
        calories: d.calories,
        protein: d.protein,
        imageUrl: d.imageUrl,
      })
    }
  }
  for (const d of view.days) {
    remember(d)
    for (const a of d.alternatives) remember(a)
  }

  const byDay = new Map(streamed.days.map((d) => [d.day, d]))
  const days = view.days.map((d) => {
    const s = byDay.get(d.day)
    if (!s) return d
    if (!s.recipeRef) {
      return {
        ...d,
        meal: '',
        recipeRef: '',
        cuisine: null,
        prepMinutes: null,
        calories: null,
        protein: null,
        imageUrl: null,
      }
    }
    if (s.recipeRef === d.recipeRef) return d
    const det = detail.get(s.recipeRef)
    return {
      ...d,
      recipeRef: s.recipeRef,
      meal: det?.meal ?? s.meal,
      cuisine: det?.cuisine ?? null,
      prepMinutes: det?.prepMinutes ?? null,
      calories: det?.calories ?? null,
      protein: det?.protein ?? null,
      imageUrl: det?.imageUrl ?? null,
    }
  })
  return { ...view, days }
}
