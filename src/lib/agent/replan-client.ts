import {
  parseJsonEventStream,
  readUIMessageStream,
  uiMessageChunkSchema,
} from 'ai'
import type { PlannedWeek } from '../planner/types'
import type { WeekView } from '../week-server'
import type { ReplanUIMessage } from './replan-ui-message'

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
  | { type: 'done'; message: string; changed: boolean; planId: string }
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
  signal?: AbortSignal,
): AsyncGenerator<ReplanWireEvent> {
  const res = await fetch('/api/replan', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ planId, instruction }),
    signal,
  })
  if (!res.ok || !res.body) {
    throw new Error(`replan request failed (${res.status})`)
  }

  let prevText = ''
  let doneEmitted = false

  const chunkStream = parseJsonEventStream({
    stream: res.body,
    schema: uiMessageChunkSchema,
  }).pipeThrough(
    new TransformStream({
      transform(chunk, controller) {
        if (!chunk.success) throw chunk.error
        controller.enqueue(chunk.value)
      },
    }),
  )

  try {
    for await (const message of readUIMessageStream<ReplanUIMessage>({
      stream: chunkStream,
    })) {
      const text = textFromMessage(message)
      if (text.length > prevText.length) {
        yield { type: 'text', delta: text.slice(prevText.length) }
        prevText = text
      }

      for (const part of message.parts) {
        if (part.type === 'data-week') {
          yield { type: 'week', week: part.data.week }
        }
        if (part.type === 'data-done' && !doneEmitted) {
          doneEmitted = true
          yield {
            type: 'done',
            message: part.data.message,
            changed: part.data.changed,
            planId: part.data.planId,
          }
          // The merged text stream may stay open after data-done; stop here so
          // the caller can drop busy state. Do not abort the fetch — that races
          // readUIMessageStream cleanup and throws "Cannot close an errored
          // readable stream".
          return
        }
      }
    }
  } catch (err) {
    if (signal?.aborted) return
    throw err
  }

  if (!doneEmitted) {
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
