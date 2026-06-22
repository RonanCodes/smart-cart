import { afterEach, describe, expect, it, vi } from 'vitest'
import { streamReplan } from './replan-client'
import type { ReplanWireEvent } from './replan-client'

/**
 * Lifecycle tests for the chat-replan client stream (#386).
 *
 * The Sentry crash "ReadableStreamDefaultController is not in a state where it
 * can be closed" came from the week page's replan stream: when the consumer
 * stops reading early (a `data-done` makes `streamReplan` return, or the user
 * navigates away mid-stream and the fetch aborts), our `TransformStream` could
 * still be handed a chunk and call `controller.enqueue` on an already
 * closed/errored controller, which throws and surfaces as an
 * `unhandledrejection`. These tests lock the lifecycle: a normal stream closes
 * exactly once, and an abort / early-return never throws.
 */

/** Build a single SSE `data:` line for one AI-SDK UI message chunk. */
function sse(chunk: unknown): string {
  return `data: ${JSON.stringify(chunk)}\n\n`
}

/**
 * A mock `fetch` whose body is a ReadableStream we control tick-by-tick. We can
 * keep pushing chunks AFTER the `data-done` (mirroring the real merged text
 * stream that stays open) and assert the consumer's early return never trips the
 * controller.
 */
function streamingFetch(
  lines: Array<string>,
  opts?: { afterDone?: Array<string>; signal?: AbortSignal },
) {
  const enc = new TextEncoder()
  const all = [...lines, ...(opts?.afterDone ?? []), 'data: [DONE]\n\n']
  let i = 0
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      // Mirror real fetch: once the request is aborted, the body errors.
      if (opts?.signal?.aborted) {
        controller.error(new DOMException('aborted', 'AbortError'))
        return
      }
      if (i >= all.length) {
        controller.close()
        return
      }
      controller.enqueue(enc.encode(all[i++]))
    },
  })
  return vi.fn(
    async () => new Response(body, { status: 200 }),
  ) as unknown as typeof fetch
}

async function collect(
  gen: AsyncGenerator<ReplanWireEvent>,
): Promise<Array<ReplanWireEvent>> {
  const out: Array<ReplanWireEvent> = []
  for await (const ev of gen) out.push(ev)
  return out
}

describe('streamReplan lifecycle', () => {
  const realFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = realFetch
    vi.restoreAllMocks()
  })

  it('yields text then done and completes on a normal stream', async () => {
    globalThis.fetch = streamingFetch([
      sse({ type: 'start', messageId: 'm1' }),
      sse({ type: 'text-start', id: 't1' }),
      sse({ type: 'text-delta', id: 't1', delta: 'Hi' }),
      sse({
        type: 'data-done',
        id: 'done',
        data: { message: 'Done', changed: false, planId: 'p1', changes: [] },
      }),
    ])

    const events = await collect(streamReplan('p1', 'no fish'))

    expect(events.some((e) => e.type === 'text')).toBe(true)
    const done = events.find((e) => e.type === 'done')
    expect(done).toMatchObject({ type: 'done', planId: 'p1' })
    // The synthetic trailing error event is only yielded when the loop ends
    // WITHOUT a done; a normal stream must never emit it.
    expect(events.some((e) => e.type === 'error')).toBe(false)
  })

  it('does not throw when the stream keeps producing after data-done', async () => {
    // The real server merges a text stream that can stay open past data-done.
    // streamReplan returns on done; the abandoned transform must not throw an
    // unhandledrejection on the in-flight chunk (this was the #386 crash).
    globalThis.fetch = streamingFetch(
      [
        sse({ type: 'start', messageId: 'm1' }),
        sse({ type: 'text-start', id: 't1' }),
        sse({ type: 'text-delta', id: 't1', delta: 'Hi' }),
        sse({
          type: 'data-done',
          id: 'done',
          data: { message: 'Done', changed: true, planId: 'p2', changes: [] },
        }),
      ],
      {
        afterDone: [
          sse({ type: 'text-delta', id: 't1', delta: ' there' }),
          sse({ type: 'text-delta', id: 't1', delta: ' friend' }),
          sse({ type: 'text-end', id: 't1' }),
          sse({ type: 'finish' }),
        ],
      },
    )

    const rejections: Array<unknown> = []
    const onReject = (e: PromiseRejectionEvent) => {
      e.preventDefault()
      rejections.push(e.reason)
    }
    globalThis.addEventListener('unhandledrejection', onReject)
    try {
      const events = await collect(streamReplan('p2', 'more pasta'))
      // Let any deferred microtasks / abandoned-stream rejections settle.
      await new Promise((r) => setTimeout(r, 10))
      expect(events.find((e) => e.type === 'done')).toMatchObject({
        type: 'done',
        planId: 'p2',
      })
      expect(rejections).toEqual([])
    } finally {
      globalThis.removeEventListener('unhandledrejection', onReject)
    }
  })

  it('does not throw when the consumer aborts mid-stream', async () => {
    const controller = new AbortController()
    globalThis.fetch = streamingFetch(
      [
        sse({ type: 'start', messageId: 'm1' }),
        sse({ type: 'text-start', id: 't1' }),
        sse({ type: 'text-delta', id: 't1', delta: 'Hi' }),
        sse({ type: 'text-delta', id: 't1', delta: ' there' }),
        sse({ type: 'text-delta', id: 't1', delta: ' friend' }),
      ],
      { signal: controller.signal },
    )

    const rejections: Array<unknown> = []
    const onReject = (e: PromiseRejectionEvent) => {
      e.preventDefault()
      rejections.push(e.reason)
    }
    globalThis.addEventListener('unhandledrejection', onReject)
    try {
      const gen = streamReplan('p3', 'stop', { signal: controller.signal })
      // Read the first event, then abort and break (the week page does this when
      // the route unmounts / the user navigates away mid-stream).
      const first = await gen.next()
      expect(first.done).toBe(false)
      controller.abort()
      // Closing the generator runs its return cleanup, which cancels the piped
      // chunk stream — this must not throw.
      await expect(gen.return(undefined)).resolves.toBeDefined()
      await new Promise((r) => setTimeout(r, 10))
      expect(rejections).toEqual([])
    } finally {
      globalThis.removeEventListener('unhandledrejection', onReject)
    }
  })
})
