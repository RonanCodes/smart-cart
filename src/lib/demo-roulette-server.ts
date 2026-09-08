/**
 * Server-only glue for the live-pitch roulette demo. NEVER statically imported
 * by client code — the API routes reach it via `await import()` so the
 * `cloudflare:workers` DO binding never enters the client graph.
 *
 * Privacy contract (see DemoRouletteRoom): phone numbers live only in the DO's
 * memory. This module returns counts and masked labels to callers; the one place
 * a raw number is read (`spinAndCall`) hands it straight to VAPI and forgets it.
 */
import type { DemoRouletteRoom } from './demo-roulette-do'

/**
 * Is the current request from an admin? Gates the presenter-only endpoints
 * (count / spin / clear). Mirrors the /admin gate (dev open-access + env admins
 * + always-included owner) using the same primitives, but lives in THIS
 * server-only module — never the client-imported admin-server — so it doesn't
 * drag the server-only admin chain into the client bundle. The public join
 * endpoint does NOT use this (anyone can enter the draw).
 */
export async function isDemoAdmin(): Promise<boolean> {
  try {
    const { getSessionUser } = await import('./server-auth')
    const u = await getSessionUser()
    if (!u) return false
    // Local dev: any signed-in session is an admin (dead code in prod).
    if (import.meta.env.DEV) return true
    const { readEnv } = await import('./env')
    const { parseApprovedList, isAdminWith, grantMapFrom, ADMIN_EMAIL } =
      await import('./access-rules')
    const envAdmins = parseApprovedList(await readEnv('ADMIN_EMAILS'))
    envAdmins.add(ADMIN_EMAIL)
    for (const e of parseApprovedList(await readEnv('SUPER_ADMIN_EMAILS'))) {
      envAdmins.add(e)
    }
    // Env-config admins are enough to run the demo; no DB-grant lookup needed.
    return isAdminWith(u.email, envAdmins, grantMapFrom([]))
  } catch {
    return false
  }
}

/** The one global room — every entrant lands in the same draw. */
const ROOM_NAME = 'live'

type RouletteStub = DurableObjectStub<DemoRouletteRoom>

/** Resolve the (single) roulette Durable Object stub from the Worker env. */
async function getRoom(): Promise<RouletteStub> {
  const { env } = await import('cloudflare:workers')
  const ns = (
    env as { DEMO_ROULETTE?: DurableObjectNamespace<DemoRouletteRoom> }
  ).DEMO_ROULETTE
  if (!ns) {
    throw new Error(
      'Durable Object binding `DEMO_ROULETTE` not found. Check wrangler.jsonc durable_objects.',
    )
  }
  return ns.get(ns.idFromName(ROOM_NAME))
}

/** Add a (normalised) entrant. Returns the new count, never the numbers. */
export async function addEntrant(normalised: string): Promise<number> {
  const room = await getRoom()
  return room.add(normalised)
}

/** Current entrant count — the only number a client ever sees. */
export async function entrantCount(): Promise<number> {
  const room = await getRoom()
  return room.count()
}

/** Wipe the draw. */
export async function clearEntrants(): Promise<number> {
  const room = await getRoom()
  return room.clear()
}

export type SpinResult =
  | {
      ok: true
      masked: string
      total: number
      called: boolean
      callError?: string
    }
  | { ok: false; reason: 'empty' }

/**
 * Pick one random entrant and place the outbound Souso voice call. Returns a
 * MASKED label for the on-stage animation plus whether the call dispatched. The
 * raw number is read from the DO and passed to VAPI here and nowhere else; it is
 * never returned to the caller.
 */
export async function spinAndCall(): Promise<SpinResult> {
  const room = await getRoom()
  const picked = await room.spin()
  if (!picked) return { ok: false, reason: 'empty' }

  const { maskPhone } = await import('./demo-phone')
  const masked = maskPhone(picked.phone)

  const { placeOutboundCall } = await import('./vapi-outbound')
  const call = await placeOutboundCall(picked.phone)

  return {
    ok: true,
    masked,
    total: picked.total,
    called: call.ok,
    callError: call.ok ? undefined : call.error,
  }
}
