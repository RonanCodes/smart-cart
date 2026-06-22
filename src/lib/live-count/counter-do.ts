import { DurableObject } from 'cloudflare:workers'
import { nextCount, parseUpdate, serializeCount } from './counter-core'

/**
 * CounterDO: the live "N home cooks planning with Souso" counter.
 *
 * One global instance (idFromName('global')) holds the latest registered-user
 * count and a set of open landing-page WebSockets. It uses the WebSocket
 * Hibernation API (ctx.acceptWebSocket + webSocketMessage/webSocketClose) so the
 * DO can be evicted between events without dropping connections, keeping cost
 * near zero while idle. The count is persisted in durable storage so it survives
 * hibernation and eviction.
 *
 * Lifecycle:
 *  - WS upgrade (GET with `Upgrade: websocket`): accept the socket and
 *    immediately push the current known count so the client renders the live
 *    number on connect. The client may also send `{count}` (its SSR value) to
 *    seed the DO before the first real signup.
 *  - POST (the signup hook, or a client seed): apply the update, persist it,
 *    and broadcast the new count to every open socket.
 *
 * All count maths live in the pure counter-core helpers (unit-tested there); this
 * class is just the Cloudflare plumbing around them. The count is monotonic
 * (never ticks down) by virtue of nextCount.
 */

const COUNT_KEY = 'count'

// `cloudflare:workers` typings for DurableObject<Env> need *some* Env; the
// CounterDO does not read any bindings of its own, so an empty shape is honest.
type CounterEnv = Record<string, never>

export class CounterDO extends DurableObject<CounterEnv> {
  /** In-memory mirror of the stored count; hydrated from storage in the ctor. */
  private count = 0

  constructor(ctx: DurableObjectState, env: CounterEnv) {
    super(ctx, env)
    // Hydrate the cached count from durable storage before any request is
    // handled. blockConcurrencyWhile is the one correct place for this; it only
    // wraps the storage read, never external I/O.
    ctx.blockConcurrencyWhile(async () => {
      const stored = await ctx.storage.get<number>(COUNT_KEY)
      if (typeof stored === 'number' && Number.isFinite(stored)) {
        this.count = stored
      }
    })
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') === 'websocket') {
      const pair = new WebSocketPair()
      const [client, server] = [pair[0], pair[1]]
      // Hibernatable accept: the runtime can evict the DO and still route
      // future messages to webSocketMessage/webSocketClose below.
      this.ctx.acceptWebSocket(server)
      // Push the current count immediately so the landing shows the live value
      // on connect without waiting for the next signup.
      try {
        server.send(serializeCount(this.count))
      } catch {
        // A send failure on a brand-new socket is non-fatal; the client will
        // still get the next broadcast.
      }
      return new Response(null, { status: 101, webSocket: client })
    }

    if (request.method === 'POST') {
      const body = await request.text().catch(() => '')
      const update = parseUpdate(body)
      if (update) await this.applyUpdate(update)
      return Response.json({ count: this.count })
    }

    // A plain GET (no upgrade) returns the current count as JSON, handy for a
    // health check or a polling fallback.
    return Response.json({ count: this.count })
  }

  /** A client may send its known count over the socket to seed the DO. */
  async webSocketMessage(
    _ws: WebSocket,
    message: string | ArrayBuffer,
  ): Promise<void> {
    const raw = typeof message === 'string' ? message : ''
    const update = parseUpdate(raw)
    if (update) await this.applyUpdate(update)
  }

  async webSocketClose(
    ws: WebSocket,
    code: number,
    reason: string,
  ): Promise<void> {
    try {
      ws.close(code, reason)
    } catch {
      // Already closing; nothing to do. The runtime drops it from getWebSockets.
    }
  }

  /**
   * Apply an update with the pure helper, persist FIRST (storage is the source
   * of truth across hibernation), update the in-memory mirror, then broadcast
   * to every open socket. A no-op update (count unchanged) skips the broadcast.
   */
  private async applyUpdate(update: {
    count?: unknown
    delta?: unknown
  }): Promise<void> {
    const next = nextCount(this.count, update)
    if (next === this.count) return
    await this.ctx.storage.put(COUNT_KEY, next)
    this.count = next
    this.broadcast(next)
  }

  /** Fan the count out to every connected (incl. hibernated) socket. */
  private broadcast(count: number): void {
    const payload = serializeCount(count)
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(payload)
      } catch {
        // A dead socket throws on send; ignore it and keep going.
      }
    }
  }
}
